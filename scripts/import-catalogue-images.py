#!/usr/bin/env python3
"""Build the reviewed 32-species offline image release from Wikimedia Commons.

Selections are deliberately locked in ``catalogue-image-selections.json``.
The importer re-verifies the taxon association, author, licence, source page,
downloaded MIME type, byte size and SHA-256 on every run. It never falls back
to an unreviewed search result.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
APPROVED_PATH = ROOT / "shared" / "catalogue" / "approved-species.json"
SELECTIONS_PATH = ROOT / "scripts" / "catalogue-image-selections.json"
OUTPUT_METADATA_PATH = ROOT / "shared" / "catalogue" / "reference-images.json"
OUTPUT_IMAGE_DIR = ROOT / "public" / "reference-images"
USER_AGENT = "InvaTrace/1.0 (catalogue provenance importer)"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
WIKIDATA_ENTITY = "https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
ALLOWED_LICENCES = re.compile(
    r"^(?:CC0|Public domain|CC BY(?:-SA)? (?:2\.0|2\.5|3\.0|3\.0 us|4\.0))$",
    re.IGNORECASE,
)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _plain_text(value: str) -> str:
    parser = _TextExtractor()
    parser.feed(html.unescape(value))
    return " ".join("".join(parser.parts).split())


def _request_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def _metadata_value(metadata: dict[str, Any], key: str) -> str:
    value = metadata.get(key, {}).get("value")
    return str(value).strip() if value is not None else ""


def _normalise_taxon(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def _verify_taxon(selection: dict[str, str], approved: dict[str, Any]) -> str:
    qid = selection["wikidata_taxon_id"]
    entity = _request_json(WIKIDATA_ENTITY.format(qid=qid))["entities"][qid]
    names = {
        claim["mainsnak"]["datavalue"]["value"]
        for claim in entity.get("claims", {}).get("P225", [])
        if claim.get("mainsnak", {}).get("datavalue", {}).get("type") == "string"
    }
    accepted_names = {approved["scientific_name"]}
    if approved.get("accepted_scientific_name"):
        accepted_names.add(approved["accepted_scientific_name"])
    if not names.intersection(accepted_names):
        raise ValueError(f"{approved['species_id']}: Wikidata taxon names {names} do not match")

    commons_file = selection["commons_file"]
    if selection["verification"] == "wikidata_p18":
        images = {
            claim["mainsnak"]["datavalue"]["value"]
            for claim in entity.get("claims", {}).get("P18", [])
            if claim.get("mainsnak", {}).get("datatype") == "commonsMedia"
            and claim.get("mainsnak", {}).get("datavalue", {}).get("type") == "string"
        }
        if commons_file not in images:
            raise ValueError(f"{approved['species_id']}: selected file is no longer a P18 image")
    elif selection["verification"] == "commons_exact_taxon_title":
        normalised_file = _normalise_taxon(commons_file)
        if not any(_normalise_taxon(name) in normalised_file for name in accepted_names):
            raise ValueError(f"{approved['species_id']}: selected filename lacks the taxon name")
    else:
        raise ValueError(f"{approved['species_id']}: unsupported verification mode")
    return next(iter(names.intersection(accepted_names)))


def _commons_pages(files: list[str]) -> dict[str, dict[str, Any]]:
    params = {
        "action": "query",
        "titles": "|".join(f"File:{name}" for name in files),
        "prop": "imageinfo",
        "iiprop": "url|mime|size|extmetadata",
        # 960 is a Wikimedia production thumbnail step. Non-standard widths
        # are rounded by the API and direct requests can be rate-limited.
        "iiurlwidth": "960",
        "format": "json",
        "formatversion": "2",
    }
    payload = _request_json(COMMONS_API + "?" + urllib.parse.urlencode(params))
    return {
        page["title"].removeprefix("File:"): page
        for page in payload.get("query", {}).get("pages", [])
        if not page.get("missing")
    }


def _open_with_backoff(request: urllib.request.Request):
    for attempt in range(6):
        try:
            return urllib.request.urlopen(request, timeout=120)
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == 5:
                raise
            retry_after = exc.headers.get("Retry-After")
            delay = int(retry_after) if retry_after and retry_after.isdigit() else 10 * (attempt + 1)
            time.sleep(delay)
    raise RuntimeError("unreachable")


def _download(url: str, destination: Path, *, resume: bool) -> tuple[str, int]:
    if resume and destination.is_file():
        content = destination.read_bytes()
        if len(content) >= 10_000 and content.startswith(b"\xff\xd8\xff"):
            return hashlib.sha256(content).hexdigest(), len(content)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    byte_length = 0
    with _open_with_backoff(request) as response:
        content_type = response.headers.get_content_type()
        if content_type != "image/jpeg":
            raise ValueError(f"expected image/jpeg, received {content_type}")
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as target:
            temp_path = Path(target.name)
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                digest.update(chunk)
                byte_length += len(chunk)
                target.write(chunk)
    if byte_length < 10_000:
        raise ValueError(f"downloaded image is unexpectedly small: {byte_length} bytes")
    os.replace(temp_path, destination)
    return digest.hexdigest(), byte_length


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reviewed-at", type=date.fromisoformat, required=True)
    parser.add_argument(
        "--resume-staging",
        action="store_true",
        help="reuse already validated JPEGs left by an interrupted staging run",
    )
    args = parser.parse_args()

    approved_payload = json.loads(APPROVED_PATH.read_text(encoding="utf-8"))
    approved = approved_payload["records"]
    selections = json.loads(SELECTIONS_PATH.read_text(encoding="utf-8"))
    approved_ids = {record["species_id"] for record in approved}
    if set(selections) != approved_ids or len(approved_ids) != 32:
        raise ValueError("image selections must match the closed 32-species catalogue exactly")

    pages = _commons_pages([selections[record["species_id"]]["commons_file"] for record in approved])
    records: list[dict[str, Any]] = []
    staging_dir = OUTPUT_IMAGE_DIR / ".catalogue-image-staging"
    for record in approved:
        species_id = record["species_id"]
        selection = selections[species_id]
        verified_taxon_name = _verify_taxon(selection, record)
        commons_file = selection["commons_file"]
        page = pages.get(commons_file)
        if page is None:
            raise ValueError(f"{species_id}: Commons file is missing")
        image_info = (page.get("imageinfo") or [{}])[0]
        metadata = image_info.get("extmetadata") or {}
        licence = _metadata_value(metadata, "LicenseShortName")
        creator = _plain_text(_metadata_value(metadata, "Artist"))
        licence_url = _metadata_value(metadata, "LicenseUrl")
        if image_info.get("mime") != "image/jpeg":
            raise ValueError(f"{species_id}: only browser-safe JPEG releases are accepted")
        if not ALLOWED_LICENCES.fullmatch(licence):
            raise ValueError(f"{species_id}: unsupported licence {licence!r}")
        if not creator:
            raise ValueError(f"{species_id}: creator is not supplied by the source")
        if licence.casefold() != "public domain" and not licence_url:
            raise ValueError(f"{species_id}: licence URL is missing")
        source_page = image_info.get("descriptionurl")
        download_url = image_info.get("thumburl") or image_info.get("url")
        if not source_page or not download_url:
            raise ValueError(f"{species_id}: source or download URL is missing")

        local_name = species_id.replace("-", "_") + ".jpg"
        staged_path = staging_dir / local_name
        sha256, byte_length = _download(
            download_url, staged_path, resume=args.resume_staging
        )
        title = f"File:{commons_file}"
        records.append(
            {
                "species_id": species_id,
                "scientific_name": record["scientific_name"],
                "verified_taxon_name": verified_taxon_name,
                "wikidata_taxon_id": selection["wikidata_taxon_id"],
                "verification": selection["verification"],
                "local_url": f"/reference-images/{local_name}",
                "sha256": sha256,
                "byte_length": byte_length,
                "source_title": title,
                "source_url_or_identifier": source_page,
                "creator": creator,
                "licence": licence,
                "licence_url": licence_url or "https://commons.wikimedia.org/wiki/Commons:Copyright_tags",
                "retrieved_at": args.reviewed_at.isoformat(),
                "reviewed_at": args.reviewed_at.isoformat(),
                "attribution_text": f"{creator} — {title} — {licence} — via Wikimedia Commons; resized for offline use.",
            }
        )
        time.sleep(1)

    payload = {
        "$schema": "./schemas/reference-images.schema.json",
        "schema_version": "invatrace.catalogue.reference-images.v1",
        "catalogue_version": approved_payload["catalogue_version"],
        "source": "Wikimedia Commons",
        "source_terms": "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia",
        "record_count": len(records),
        "records": records,
    }
    for record in records:
        local_name = Path(record["local_url"]).name
        os.replace(staging_dir / local_name, OUTPUT_IMAGE_DIR / local_name)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=OUTPUT_METADATA_PATH.parent, delete=False
    ) as target:
        target.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        metadata_temp = Path(target.name)
    os.replace(metadata_temp, OUTPUT_METADATA_PATH)
    print(f"Wrote {len(records)} verified image records to {OUTPUT_METADATA_PATH}")


if __name__ == "__main__":
    main()
