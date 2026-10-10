"""Package the complete application source, excluding local tooling and caches.

Uses Git's tracked/non-ignored file inventory, including uncommitted changes.
It never stages, commits, pushes, or includes credentials from ignored .env files.
The 500 MB ceiling is decimal bytes and applies to both unpacked source and ZIP.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 500_000_000


def main() -> None:
    inventory = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
    ).decode("utf-8").split("\0")
    files = sorted({name for name in inventory if name and (ROOT / name).is_file()})
    unpacked_bytes = sum((ROOT / name).stat().st_size for name in files)
    if unpacked_bytes >= LIMIT:
        raise SystemExit(f"Application source exceeds the 500 MB limit: {unpacked_bytes} bytes")
    destination = ROOT / "outputs"
    destination.mkdir(exist_ok=True)
    archive = destination / "InvaTrace-Epic8-source.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=6) as bundle:
        for name in files:
            bundle.write(ROOT / name, "InvaTrace/" + name)
    archive_bytes = archive.stat().st_size
    if archive_bytes >= LIMIT:
        raise SystemExit(f"ZIP exceeds the 500 MB limit: {archive_bytes} bytes")
    manifest = {
        "limit_bytes": LIMIT,
        "unpacked_app_source_bytes": unpacked_bytes,
        "zip_bytes": archive_bytes,
        "file_count": len(files),
        "baseline_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "excluded": ["Git history", "node_modules", ".venv", "work", "dist", "ignored .env files", "outputs"],
        "note": "Source includes runtime assets and build scripts. Docker installs dependencies outside the checkout. Docker image sizes have not been measured.",
    }
    (destination / "app-size.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
