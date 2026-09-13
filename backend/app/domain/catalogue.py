"""Backend-side loader for the shared plant catalogue JSON files.

The app has one source of truth for plant status/safety info under
shared/catalogue/, and both the phone side (shared/catalogue/index.ts) and
the backend read from it. I wanted only one place in Python that opens
those files so if the on-disk version ever drifts from what the phone
bundled, we catch it here instead of noticing later from a weird bug.

Who uses what in here:
 - app.seed pulls load_status_records() to fill the species table on first
   boot.
 - the reports router calls assert_client_catalogue_matches() so a phone
   running an older bundle can't submit a report against stale data (it can
   still ID plants and read guidance offline though, that side keeps working)
 - app.main exposes catalogue_health_snapshot() on the health endpoint so I
   can eyeball drift during pilot without leaking any secrets
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

CATALOGUE_ROOT = Path(__file__).resolve().parents[3] / "shared" / "catalogue"
PLANT_STATUS_PATH = CATALOGUE_ROOT / "plant-status.json"
PLANT_GUIDANCE_PATH = CATALOGUE_ROOT / "plant-guidance.json"
MANIFEST_PATH = CATALOGUE_ROOT / "catalogue-manifest.json"
APPROVED_SPECIES_PATH = CATALOGUE_ROOT / "approved-species.json"

VALID_UI_STATES = frozenset({"invasive", "information_only", "status_uncertain"})


class CatalogueError(RuntimeError):
    """Raised when the on-disk catalogue is missing, malformed, or drifted."""


@dataclass(frozen=True)
class PlantStatusRecord:
    species_id: str
    model_label: str
    class_index: int
    scientific_name: str
    common_name: str | None
    ui_state: str
    general_information: str
    safety_message: str
    status_source_ids: tuple[str, ...]
    status_reviewed_at: date
    report_eligible: bool

    @property
    def is_invasive(self) -> bool:
        return self.ui_state == "invasive"


@dataclass(frozen=True)
class ApprovedSpeciesRecord:
    species_id: str
    scientific_name: str
    accepted_scientific_name: str | None
    common_names: tuple[str, ...]
    evidence_source_ids: tuple[str, ...]
    evidence_summary: str
    habitats: tuple[str, ...]
    water_dispersed: bool
    status_reviewed_at: date


@dataclass(frozen=True)
class CatalogueManifest:
    catalogue_version: str
    content_version: str
    model_version: str
    last_reviewed: date
    plant_status_sha256: str
    plant_status_byte_length: int
    plant_guidance_sha256: str
    plant_guidance_byte_length: int
    approved_species_sha256: str
    approved_species_byte_length: int


@dataclass(frozen=True)
class ApprovedCatalogueImage:
    url: str
    creator: str
    licence: str
    source_title: str
    source_url_or_identifier: str
    reviewed_at: date


def _read_json(path: Path) -> Any:
    if not path.is_file():
        raise CatalogueError(f"Catalogue file missing: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CatalogueError(f"Catalogue file is not valid JSON: {path}") from exc


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@lru_cache(maxsize=1)
def load_manifest() -> CatalogueManifest:
    manifest = _read_json(MANIFEST_PATH)
    try:
        files = manifest["files"]
        return CatalogueManifest(
            catalogue_version=manifest["catalogue_version"],
            content_version=manifest["content_version"],
            model_version=manifest["model_version"],
            last_reviewed=date.fromisoformat(manifest["last_reviewed"]),
            plant_status_sha256=files["plant-status.json"]["sha256"],
            plant_status_byte_length=int(files["plant-status.json"]["byte_length"]),
            plant_guidance_sha256=files["plant-guidance.json"]["sha256"],
            plant_guidance_byte_length=int(files["plant-guidance.json"]["byte_length"]),
            approved_species_sha256=files["approved-species.json"]["sha256"],
            approved_species_byte_length=int(files["approved-species.json"]["byte_length"]),
        )
    except (KeyError, ValueError) as exc:
        raise CatalogueError(f"Catalogue manifest is malformed: {exc}") from exc


@lru_cache(maxsize=1)
def approved_catalogue_images() -> dict[str, ApprovedCatalogueImage]:
    """Return only image assets with complete, reviewed provenance metadata."""
    manifest = _read_json(MANIFEST_PATH)
    images: dict[str, ApprovedCatalogueImage] = {}
    for asset in manifest.get("assets", []):
        if asset.get("review_status") != "approved":
            continue
        required = (
            "url",
            "creator",
            "licence",
            "source_title",
            "source_url_or_identifier",
            "reviewed_at",
        )
        if not all(isinstance(asset.get(field), str) and asset[field].strip() for field in required):
            raise CatalogueError("An approved catalogue image has incomplete provenance metadata.")
        try:
            image = ApprovedCatalogueImage(
                url=asset["url"],
                creator=asset["creator"],
                licence=asset["licence"],
                source_title=asset["source_title"],
                source_url_or_identifier=asset["source_url_or_identifier"],
                reviewed_at=date.fromisoformat(asset["reviewed_at"]),
            )
        except ValueError as exc:
            raise CatalogueError("An approved catalogue image has an invalid review date.") from exc
        images[image.url] = image
    return images


def approved_catalogue_image(url: str | None) -> ApprovedCatalogueImage | None:
    if not url:
        return None
    return approved_catalogue_images().get(url)


@lru_cache(maxsize=1)
def load_status_records() -> tuple[PlantStatusRecord, ...]:
    data = _read_json(PLANT_STATUS_PATH)
    records: list[PlantStatusRecord] = []
    for raw in data.get("records", []):
        ui_state = raw.get("ui_state")
        if ui_state not in VALID_UI_STATES:
            raise CatalogueError(f"Invalid ui_state {ui_state!r} for {raw.get('species_id')!r}")
        report_eligible = bool(raw.get("report_eligible", False))
        if ui_state != "invasive" and report_eligible:
            raise CatalogueError(
                "report_eligible must be false for non-invasive records "
                f"({raw.get('species_id')!r})"
            )
        records.append(
            PlantStatusRecord(
                species_id=raw["species_id"],
                model_label=raw["model_label"],
                class_index=int(raw["class_index"]),
                scientific_name=raw["scientific_name"],
                common_name=raw.get("common_name"),
                ui_state=ui_state,
                general_information=raw["general_information"],
                safety_message=raw["safety_message"],
                status_source_ids=tuple(raw.get("status_source_ids", [])),
                status_reviewed_at=date.fromisoformat(raw["status_reviewed_at"]),
                report_eligible=report_eligible,
            )
        )
    if len(records) != int(data.get("class_count", -1)):
        raise CatalogueError(
            "class_count in plant-status.json does not match the number of records "
            f"({data.get('class_count')} declared, {len(records)} present)"
        )
    return tuple(records)


@lru_cache(maxsize=1)
def load_approved_species() -> tuple[ApprovedSpeciesRecord, ...]:
    """Load the closed Iteration 2 business allowlist.

    The shipped classifier catalogue is deliberately separate: while the new
    32-class model is being trained, old model labels may still exist locally,
    but reporting, occurrence association, and public catalogue APIs may only
    use records returned here.
    """
    data = _read_json(APPROVED_SPECIES_PATH)
    raw_records = data.get("records", [])
    if data.get("record_count") != 32 or len(raw_records) != 32:
        raise CatalogueError("approved-species.json must contain exactly 32 records")
    source_ids = {source.get("source_id") for source in data.get("sources", [])}
    records: list[ApprovedSpeciesRecord] = []
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for raw in raw_records:
        species_id = raw["species_id"]
        scientific_name = raw["scientific_name"]
        normalized_name = scientific_name.casefold().strip()
        if species_id in seen_ids or normalized_name in seen_names:
            raise CatalogueError(f"Duplicate approved species: {species_id}")
        missing_sources = set(raw["evidence_source_ids"]) - source_ids
        if missing_sources:
            raise CatalogueError(
                f"Unknown evidence source(s) for {species_id}: {sorted(missing_sources)}"
            )
        if raw.get("malaysia_status") != "Present":
            raise CatalogueError(f"Approved species must be Present: {species_id}")
        seen_ids.add(species_id)
        seen_names.add(normalized_name)
        records.append(
            ApprovedSpeciesRecord(
                species_id=species_id,
                scientific_name=scientific_name,
                accepted_scientific_name=raw.get("accepted_scientific_name"),
                common_names=tuple(raw["common_names"]),
                evidence_source_ids=tuple(raw["evidence_source_ids"]),
                evidence_summary=raw["evidence_summary"],
                habitats=tuple(raw["habitats"]),
                water_dispersed=bool(raw["water_dispersed"]),
                status_reviewed_at=date.fromisoformat(raw["status_reviewed_at"]),
            )
        )
    return tuple(records)


def approved_species_record(species_id: str) -> ApprovedSpeciesRecord | None:
    normalized = species_id.strip().lower().replace("_", "-")
    return next(
        (record for record in load_approved_species() if record.species_id == normalized),
        None,
    )


def is_approved_species(species_id: str | None) -> bool:
    return species_id is not None and approved_species_record(species_id) is not None


@lru_cache(maxsize=1)
def load_approved_dataset() -> dict[str, Any]:
    return _read_json(APPROVED_SPECIES_PATH)


@lru_cache(maxsize=1)
def load_guidance_dataset() -> dict[str, Any]:
    return _read_json(PLANT_GUIDANCE_PATH)


def status_record_for_species(species_id: str) -> PlantStatusRecord | None:
    normalized = species_id.strip().lower().replace("_", "-")
    for record in load_status_records():
        if record.species_id == normalized:
            return record
    return None


def status_record_for_model_label(model_label: str) -> PlantStatusRecord | None:
    normalized = model_label.strip().lower()
    for record in load_status_records():
        if record.model_label == normalized:
            return record
    return None


def verify_disk_checksums() -> None:
    """Checks the two catalogue JSON files on disk still match the sha256s
    listed in catalogue-manifest.json. I call this once at startup from the
    readiness check - the idea is if somebody edited plant-status.json by
    hand and forgot to regenerate the manifest, we should fail loud instead
    of silently serving mismatched data to the app.
    """
    manifest = load_manifest()
    actual_status = _sha256(PLANT_STATUS_PATH)
    if actual_status != manifest.plant_status_sha256:
        raise CatalogueError(
            "plant-status.json checksum drift: "
            f"expected {manifest.plant_status_sha256}, got {actual_status}"
        )
    actual_guidance = _sha256(PLANT_GUIDANCE_PATH)
    if actual_guidance != manifest.plant_guidance_sha256:
        raise CatalogueError(
            "plant-guidance.json checksum drift: "
            f"expected {manifest.plant_guidance_sha256}, got {actual_guidance}"
        )
    actual_approved = _sha256(APPROVED_SPECIES_PATH)
    if actual_approved != manifest.approved_species_sha256:
        raise CatalogueError(
            "approved-species.json checksum drift: "
            f"expected {manifest.approved_species_sha256}, got {actual_approved}"
        )


def assert_client_catalogue_matches(
    client_catalogue_version: str | None,
    client_plant_status_sha256: str | None,
) -> None:
    """Blocks a report submission when the phone's bundled catalogue is out
    of sync with what the server has. Either field is optional on the request
    (older builds only sent the version string, newer ones send the sha too)
    so we check whichever ones were provided, but if any of them disagree we
    bail out - the phone needs to grab the new bundle before it can report.
    """
    manifest = load_manifest()
    if (
        client_catalogue_version is not None
        and client_catalogue_version != manifest.catalogue_version
    ):
        raise CatalogueError(
            "Catalogue version mismatch: "
            f"client={client_catalogue_version} server={manifest.catalogue_version}"
        )
    if (
        client_plant_status_sha256 is not None
        and client_plant_status_sha256 != manifest.plant_status_sha256
    ):
        raise CatalogueError(
            "Catalogue plant-status.json checksum mismatch - the app must "
            "reload before submitting reports."
        )


def catalogue_health_snapshot() -> dict[str, Any]:
    manifest = load_manifest()
    return {
        "catalogue_version": manifest.catalogue_version,
        "content_version": manifest.content_version,
        "model_version": manifest.model_version,
        "last_reviewed": manifest.last_reviewed.isoformat(),
        "plant_status_sha256": manifest.plant_status_sha256,
        "plant_status_record_count": len(load_status_records()),
    }
