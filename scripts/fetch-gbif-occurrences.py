#!/usr/bin/env python3
"""Build a reviewed Malaysia occurrence release from the public GBIF API.

The release is intentionally limited to the closed 32-species catalogue and
record licences compatible with redistribution. The backend importer performs
the final country-polygon, Present, uncertainty and duplicate validation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
APPROVED_PATH = ROOT / "shared" / "catalogue" / "approved-species.json"
API_ROOT = "https://api.gbif.org/v1"
USER_AGENT = "InvaTrace/1.0 (Malaysia occurrence release builder)"
PAGE_SIZE = 300
ALLOWED_LICENCE_MARKERS = (
    "creativecommons.org/publicdomain/zero/",
    "creativecommons.org/licenses/by/",
)


def _get_json(path: str, params: dict[str, Any]) -> dict[str, Any]:
    url = f"{API_ROOT}/{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def _canonical(value: str) -> str:
    return " ".join(value.casefold().split())


def _taxon_key(record: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    requested = record.get("accepted_scientific_name") or record["scientific_name"]
    match = _get_json("species/match", {"name": requested})
    expected = {_canonical(record["scientific_name"]), _canonical(requested)}
    matched_names = {
        _canonical(str(match.get("canonicalName") or "")),
        _canonical(str(match.get("species") or "")),
    }
    if (
        match.get("rank") != "SPECIES"
        or match.get("matchType") != "EXACT"
        or not expected.intersection(matched_names)
        or not isinstance(match.get("usageKey"), int)
    ):
        raise ValueError(f"{record['species_id']}: unverified GBIF taxon match {match}")
    return match["usageKey"], match


def _licence_allowed(value: Any) -> bool:
    normalised = str(value or "").casefold()
    return any(marker in normalised for marker in ALLOWED_LICENCE_MARKERS)


def _minimal_record(raw: dict[str, Any], species_id: str) -> dict[str, Any]:
    return {
        "speciesId": species_id,
        "scientificName": raw.get("scientificName"),
        "sourceOccurrenceId": str(raw.get("key") or raw.get("occurrenceID") or ""),
        "countryCode": raw.get("countryCode"),
        "occurrenceStatus": raw.get("occurrenceStatus"),
        "decimalLatitude": raw.get("decimalLatitude"),
        "decimalLongitude": raw.get("decimalLongitude"),
        "coordinateUncertaintyInMeters": raw.get("coordinateUncertaintyInMeters"),
        "eventDate": raw.get("eventDate"),
        "year": raw.get("year"),
        "datasetKey": raw.get("datasetKey"),
        "datasetTitle": raw.get("datasetTitle"),
        "publishingOrgKey": raw.get("publishingOrgKey"),
        "license": raw.get("license"),
        "references": raw.get("references") or f"https://www.gbif.org/occurrence/{raw.get('key')}",
        "basisOfRecord": raw.get("basisOfRecord"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--retrieved-at", type=date.fromisoformat, required=True)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=ROOT / "data" / "production" / "gbif-occurrences",
    )
    args = parser.parse_args()

    catalogue = json.loads(APPROVED_PATH.read_text(encoding="utf-8"))
    if catalogue.get("record_count") != 32 or len(catalogue.get("records", [])) != 32:
        raise ValueError("GBIF release builder requires the closed 32-species catalogue")

    records: list[dict[str, Any]] = []
    taxon_matches: dict[str, Any] = {}
    counts: Counter[str] = Counter()
    for species in catalogue["records"]:
        species_id = species["species_id"]
        key, match = _taxon_key(species)
        taxon_matches[species_id] = {
            "taxon_key": key,
            "canonical_name": match.get("canonicalName"),
            "match_type": match.get("matchType"),
            "confidence": match.get("confidence"),
        }
        offset = 0
        while True:
            page = _get_json(
                "occurrence/search",
                {
                    "taxon_key": key,
                    "country": "MY",
                    "occurrence_status": "PRESENT",
                    "has_coordinate": "true",
                    "limit": PAGE_SIZE,
                    "offset": offset,
                },
            )
            results = page.get("results")
            if not isinstance(results, list):
                raise ValueError(f"{species_id}: malformed GBIF occurrence response")
            for raw in results:
                counts["fetched"] += 1
                if not isinstance(raw, dict) or not _licence_allowed(raw.get("license")):
                    counts["licence_excluded"] += 1
                    continue
                records.append(_minimal_record(raw, species_id))
                counts["licence_accepted"] += 1
            if page.get("endOfRecords") or not results:
                break
            offset += len(results)
            if offset >= 100_000:
                raise ValueError(f"{species_id}: GBIF search result exceeds the 100,000 API cap")

    records.sort(key=lambda item: (item["speciesId"], item["sourceOccurrenceId"]))
    payload = {
        "schema_version": "invatrace.gbif-occurrences.v1",
        "retrieved_at": args.retrieved_at.isoformat(),
        "source": "GBIF Occurrence Search API",
        "source_url": "https://api.gbif.org/v1/occurrence/search",
        "query": {
            "country": "MY",
            "occurrence_status": "PRESENT",
            "has_coordinate": True,
            "taxa": taxon_matches,
        },
        "licence_policy": {
            "accepted": ["CC0", "CC BY"],
            "rejected": ["CC BY-NC", "unknown or missing"],
            "record_licence_preserved": True,
        },
        "record_count": len(records),
        "fetch_summary": dict(sorted(counts.items())),
        "records": records,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    data_name = f"gbif-malaysia-occurrences-{args.retrieved_at.isoformat()}.json"
    data_path = args.output_dir / data_name
    content = (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode()
    with tempfile.NamedTemporaryFile(dir=args.output_dir, delete=False) as target:
        target.write(content)
        temp_path = Path(target.name)
    temp_path.replace(data_path)

    manifest = {
        "schema_version": "invatrace.data-release.v1",
        "dataset_id": "gbif-malaysia-occurrences",
        "jurisdiction": "Malaysia",
        "scope": "Public GBIF records for the closed 32-species catalogue; backend validation remains authoritative",
        "source": "GBIF Occurrence Search API",
        "source_url": "https://techdocs.gbif.org/en/openapi/v1/occurrence",
        "query_url": "https://api.gbif.org/v1/occurrence/search",
        "upstream_version": f"GBIF API snapshot retrieved {args.retrieved_at.isoformat()}",
        "retrieved_at": args.retrieved_at.isoformat(),
        "licence": "Mixed CC0/CC BY record licences; preserved per record",
        "licence_url": "https://www.gbif.org/terms",
        "file": data_name,
        "sha256": hashlib.sha256(content).hexdigest(),
        "byte_length": len(content),
        "record_count": len(records),
        "fetch_summary": dict(sorted(counts.items())),
        "citation_note": "This API-built release is traceable by GBIF occurrence key and dataset key but has no GBIF download DOI.",
    }
    manifest_path = args.output_dir / "release.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps({"data": str(data_path), "manifest": str(manifest_path), **counts}))


if __name__ == "__main__":
    main()
