"""Download/verify a Geofabrik PBF and bind every derived release to its bytes."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

LATEST_URL = "https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf"
SOURCE_PAGE = "https://download.geofabrik.de/asia/malaysia-singapore-brunei.html"
SOURCE = "OpenStreetMap contributors via Geofabrik GmbH"
LICENCE = "Open Data Commons Open Database License 1.0"
LICENCE_URL = "https://www.openstreetmap.org/copyright"


def digest(path: Path) -> tuple[str, int]:
    sha256 = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            sha256.update(chunk)
            size += len(chunk)
    return sha256.hexdigest(), size


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as target:
            json.dump(payload, target, ensure_ascii=False, indent=2)
            target.write("\n")
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def fetch(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "InvaTrace-data-release/1.0"})
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with urllib.request.urlopen(request, timeout=120) as response, os.fdopen(fd, "wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        os.replace(temporary, target)
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        Path(temporary).unlink(missing_ok=True)
        raise


def pbf_metadata(path: Path) -> tuple[str, str | None]:
    try:
        import osmium
    except ImportError as exc:
        raise SystemExit("pyosmium is required to read the PBF replication metadata") from exc
    reader = osmium.io.Reader(str(path), osmium.osm.osm_entity_bits.NOTHING)
    try:
        header = reader.header()
        timestamp = header.get("osmosis_replication_timestamp")
        sequence = header.get("osmosis_replication_sequence_number") or None
    finally:
        reader.close()
    if not timestamp:
        raise SystemExit("PBF has no osmosis_replication_timestamp; refusing to invent one")
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise SystemExit("PBF replication timestamp has no timezone")
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z"), sequence


def verify_upstream_md5(path: Path, url: str) -> str:
    request = urllib.request.Request(f"{url}.md5", headers={"User-Agent": "InvaTrace-data-release/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read().decode("ascii", errors="strict")
    match = re.search(r"\b([0-9a-fA-F]{32})\b", body)
    if not match:
        raise SystemExit("Geofabrik MD5 response did not contain a digest")
    expected = match.group(1).lower()
    checksum = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(chunk)
    actual = checksum.hexdigest()
    if actual != expected:
        raise SystemExit(f"Geofabrik MD5 mismatch: expected {expected}, got {actual}")
    return expected


def place_manifest(pbf: Path, boundary_manifest: dict, *, downloaded: bool) -> dict:
    sha256, byte_length = digest(pbf)
    timestamp, sequence = pbf_metadata(pbf)
    upstream_md5 = verify_upstream_md5(pbf, LATEST_URL) if downloaded else None
    retrieved = datetime.now(UTC).date().isoformat()
    version = f"Geofabrik replication sequence {sequence}" if sequence else f"Geofabrik extract {timestamp}"
    return {
        "schema_version": "invatrace.data-release.v1",
        "dataset_id": "osm-malaysia-places",
        "jurisdiction": "Malaysia",
        "scope": "Named Malaysian parks, forests and public trails selected from the Malaysia-Singapore-Brunei regional extract using the reviewed national boundary",
        "source": SOURCE,
        "source_url": SOURCE_PAGE,
        "download_url": LATEST_URL,
        "upstream_version": version,
        "source_timestamp": timestamp,
        "retrieved_at": retrieved,
        "licence": LICENCE,
        "licence_url": LICENCE_URL,
        "file": pbf.name,
        "upstream_md5": upstream_md5,
        "sha256": sha256,
        "byte_length": byte_length,
        "country_boundary_release": "../malaysia-boundary/release.json",
        "country_boundary_sha256": boundary_manifest["sha256"],
        "included_area_tags": ["leisure=park", "leisure=nature_reserve", "boundary=national_park", "boundary=protected_area", "landuse=forest", "natural=wood"],
        "included_trail_highways": ["path", "footway", "track"],
        "notes": "The PBF is intentionally not committed. Importers verify these exact bytes and filter retained geometry against the reviewed Malaysia boundary.",
    }


def derived_manifest(path: Path, places: dict, dataset_id: str) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    sha256, byte_length = digest(path)
    if dataset_id == "osm-malaysia-protected-areas":
        features = payload.get("features")
        if not isinstance(features, list) or not features:
            raise SystemExit("protected-area extraction is empty; refusing to publish it")
        named = sum(bool((f.get("properties") or {}).get("name") or (f.get("properties") or {}).get("official_name")) for f in features)
        exclusions = (payload.get("metadata") or {}).get("exclusion_reasons") or {}
        return {
            "schema_version": "invatrace.data-release.v1", "dataset_id": dataset_id,
            "jurisdiction": "Malaysia", "scope": "OSM areas wholly within the reviewed Malaysia boundary and explicitly tagged as protected areas, national parks, or nature reserves",
            "source": SOURCE, "source_url": SOURCE_PAGE,
            "upstream_version": f"{places['upstream_version']}; derived protected-area release {places['source_timestamp']}",
            "source_timestamp": places["source_timestamp"], "retrieved_at": places["retrieved_at"],
            "licence": LICENCE, "licence_url": LICENCE_URL, "file": path.name,
            "sha256": sha256, "byte_length": byte_length, "feature_count": len(features),
            "named_feature_count": named, "unnamed_feature_count": len(features) - named,
            "approved_tag_allowlist": ["boundary=protected_area", "boundary=national_park", "leisure=nature_reserve"],
            "source_pbf_sha256": places["sha256"], "country_boundary_sha256": places["country_boundary_sha256"],
            "outside_or_cross_border_excluded": int(
                exclusions.get("outside_or_cross_border_malaysia", 0)
            ),
            "notes": "Mapped context is not a legally exhaustive register; no intersection does not establish access or removal permission.",
        }
    records = payload.get("records")
    if not isinstance(records, list):
        raise SystemExit("waterway evidence has no records array")
    return {
        "schema_version": "invatrace.data-release.v1", "dataset_id": dataset_id,
        "jurisdiction": "Malaysia", "scope": "Directed OSM river, stream, canal and drain topology used only for conservative upstream occurrence evidence",
        "source": SOURCE, "source_url": SOURCE_PAGE, "upstream_version": payload["dataVersion"],
        "source_timestamp": places["source_timestamp"], "retrieved_at": places["retrieved_at"],
        "licence": LICENCE, "licence_url": LICENCE_URL, "file": path.name,
        "sha256": sha256, "byte_length": byte_length, "record_count": len(records),
        "source_pbf_sha256": places["sha256"], "country_boundary_sha256": places["country_boundary_sha256"],
        "included_waterways": payload.get("includedWaterways", []),
        "direction_policy": payload.get("directionPolicy"), "graph_qa": payload.get("graphQa", {}),
        "notes": "Zero qualifying upstream associations is a valid fail-closed result and is not evidence of biological absence.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pbf", type=Path)
    parser.add_argument("--download-latest", action="store_true")
    parser.add_argument("--places-manifest", type=Path, required=True)
    parser.add_argument("--boundary-manifest", type=Path, required=True)
    parser.add_argument("--protected-geojson", type=Path)
    parser.add_argument("--protected-manifest", type=Path)
    parser.add_argument("--waterway-evidence", type=Path)
    parser.add_argument("--waterway-manifest", type=Path)
    args = parser.parse_args()
    if bool(args.pbf) == args.download_latest:
        parser.error("choose exactly one of --pbf or --download-latest")
    pbf = args.pbf.resolve() if args.pbf else Path(".local-data/osm/malaysia-singapore-brunei-latest.osm.pbf").resolve()
    downloaded = args.download_latest
    if downloaded:
        fetch(LATEST_URL, pbf)
    if not pbf.is_file():
        raise SystemExit(f"PBF not found: {pbf}")
    boundary = json.loads(args.boundary_manifest.read_text(encoding="utf-8"))
    if args.pbf and args.places_manifest.is_file():
        places = json.loads(args.places_manifest.read_text(encoding="utf-8"))
        if places.get("file") != pbf.name:
            raise SystemExit("existing places manifest filename does not match the supplied PBF")
        actual_sha256, actual_size = digest(pbf)
        if places.get("sha256") != actual_sha256 or places.get("byte_length") != actual_size:
            raise SystemExit("existing places manifest does not match the supplied PBF")
        if places.get("country_boundary_sha256") != boundary.get("sha256"):
            raise SystemExit("existing places manifest does not match the reviewed boundary")
    else:
        places = place_manifest(pbf, boundary, downloaded=downloaded)
        write_json(args.places_manifest, places)
    if args.protected_geojson or args.protected_manifest:
        if not args.protected_geojson or not args.protected_manifest:
            parser.error("--protected-geojson and --protected-manifest must be supplied together")
        write_json(args.protected_manifest, derived_manifest(args.protected_geojson, places, "osm-malaysia-protected-areas"))
    if args.waterway_evidence or args.waterway_manifest:
        if not args.waterway_evidence or not args.waterway_manifest:
            parser.error("--waterway-evidence and --waterway-manifest must be supplied together")
        write_json(args.waterway_manifest, derived_manifest(args.waterway_evidence, places, "osm-malaysia-waterway-evidence"))
    print(json.dumps({"pbf": str(pbf), "sha256": places["sha256"], "byteLength": places["byte_length"], "sourceTimestamp": places["source_timestamp"]}, sort_keys=True))


if __name__ == "__main__":
    main()
