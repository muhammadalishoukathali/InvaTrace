[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$PbfPath,

    [Parameter(Mandatory = $false)]
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    throw "DATABASE_URL must be set in the environment. It is never read from or written to a repository file."
}

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backend = Join-Path $repo "backend"
$dataRoot = Join-Path $repo "data\production"
$localRoot = Join-Path $repo ".local-data\osm"
$placesManifest = Join-Path $dataRoot "osm-places\release.json"
$boundary = Join-Path $dataRoot "malaysia-boundary\geoBoundaries-MYS-ADM0.geojson"
$boundaryManifest = Join-Path $dataRoot "malaysia-boundary\release.json"
$occurrenceManifest = Join-Path $dataRoot "gbif-occurrences\release.json"
$occurrenceData = Join-Path $dataRoot "gbif-occurrences\gbif-malaysia-occurrences-2026-09-13.json"
$prepare = Join-Path $repo "scripts\prepare-osm-release.py"

foreach ($required in @($backend, $prepare, $boundary, $boundaryManifest, $occurrenceManifest, $occurrenceData)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required file is missing: $required"
    }
}

& $Python -c "import alembic, osmium, psycopg, shapely, sqlalchemy"
if ($LASTEXITCODE -ne 0) {
    throw "The selected Python environment is missing production import dependencies. From the repository root run: $Python -m pip install -e .\backend"
}

New-Item -ItemType Directory -Path $localRoot -Force | Out-Null

$prepareArgs = @(
    $prepare,
    "--places-manifest", $placesManifest,
    "--boundary-manifest", $boundaryManifest
)
if ([string]::IsNullOrWhiteSpace($PbfPath)) {
    $prepareArgs += "--download-latest"
} else {
    $resolvedPbf = (Resolve-Path -LiteralPath $PbfPath).Path
    $prepareArgs += @("--pbf", $resolvedPbf)
}
$preparedJson = & $Python @prepareArgs
if ($LASTEXITCODE -ne 0) { throw "OSM release preparation failed." }
$prepared = $preparedJson | ConvertFrom-Json
$resolvedPbf = (Resolve-Path -LiteralPath ([string]$prepared.pbf)).Path
$placesRelease = Get-Content -LiteralPath $placesManifest -Raw | ConvertFrom-Json
$timestamp = [DateTimeOffset]::Parse([string]$placesRelease.source_timestamp)
$releaseDate = $timestamp.UtcDateTime.ToString("yyyy-MM-dd")
$protectedData = Join-Path $dataRoot "osm-protected-areas\osm-malaysia-protected-areas-$releaseDate.geojson"
$protectedManifest = Join-Path $dataRoot "osm-protected-areas\release.json"
$waterwayData = Join-Path $dataRoot "osm-waterways\osm-waterway-evidence-$releaseDate.json"
$waterwayManifest = Join-Path $dataRoot "osm-waterways\release.json"

$env:PYTHONPATH = $backend
Push-Location $backend
try {
    & $Python -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw "Database migration failed." }

    & $Python -m app.cli load-reference-data
    if ($LASTEXITCODE -ne 0) { throw "Reference catalogue import failed." }

    & $Python -m app.cli import-occurrences $occurrenceData `
        --source "GBIF" `
        --processed-data-version "GBIF API snapshot retrieved 2026-09-13" `
        --release-manifest $occurrenceManifest `
        --country-boundary $boundary `
        --country-boundary-manifest $boundaryManifest
    if ($LASTEXITCODE -ne 0) { throw "Occurrence import failed." }

    & $Python -m app.cli import-osm $resolvedPbf `
        --source-date $timestamp.ToString("o") `
        --release-manifest $placesManifest `
        --country-boundary $boundary `
        --country-boundary-manifest $boundaryManifest
    if ($LASTEXITCODE -ne 0) { throw "OSM place import failed." }

    & $Python -m app.cli extract-osm-protected-areas $resolvedPbf `
        --output $protectedData `
        --release-manifest $placesManifest `
        --country-boundary $boundary `
        --country-boundary-manifest $boundaryManifest
    if ($LASTEXITCODE -ne 0) { throw "Protected-area extraction failed. Record this as a blocker; do not fabricate boundaries." }

    Write-Host "Preprocessing directed waterways. Exact geography snapping can take several minutes or longer against a remote database and prints its summary only when complete."
    & $Python -m app.cli preprocess-osm-waterways $resolvedPbf `
        --release-manifest $placesManifest `
        --country-boundary $boundary `
        --country-boundary-manifest $boundaryManifest `
        --evidence-output $waterwayData
    if ($LASTEXITCODE -ne 0) { throw "Directed-waterway preprocessing failed." }

    & $Python $prepare `
        --pbf $resolvedPbf `
        --places-manifest $placesManifest `
        --boundary-manifest $boundaryManifest `
        --protected-geojson $protectedData `
        --protected-manifest $protectedManifest `
        --waterway-evidence $waterwayData `
        --waterway-manifest $waterwayManifest
    if ($LASTEXITCODE -ne 0) { throw "Derived release manifest generation failed." }

    $protectedRelease = Get-Content -LiteralPath $protectedManifest -Raw | ConvertFrom-Json
    & $Python -m app.cli import-protected-areas $protectedData `
        --source ([string]$protectedRelease.source) `
        --version ([string]$protectedRelease.upstream_version) `
        --updated-at $timestamp.ToString("o") `
        --coverage-note "Reviewed Malaysia national boundary; mapped context is not removal permission" `
        --coverage-geojson $boundary `
        --release-manifest $protectedManifest `
        --coverage-release-manifest $boundaryManifest
    if ($LASTEXITCODE -ne 0) { throw "Protected-area import failed." }

    & $Python -m app.cli production-data-status
    if ($LASTEXITCODE -ne 0) { throw "Required production geospatial data is incomplete." }
}
finally {
    Pop-Location
}
