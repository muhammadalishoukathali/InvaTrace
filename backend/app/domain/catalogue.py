"""InvaTrace Iteration 1 authoritative catalogue loader (backend side).

Both the frontend (`shared/catalogue/index.ts`) and the backend read from
``shared/catalogue/`` for Malaysian plant status and safe guidance. This
module is the ONLY sanctioned way for backend code to load either file, so
version and checksum drift can be detected in one place.

Callers:

* :mod:`app.seed` uses :func:`load_status_records` to seed the ``species``
  table.
* :mod:`app.api.routers.reports` uses :func:`assert_client_catalogue_matches`
  to reject report submissions whose bundled catalogue disagrees with the
  server's — identification and offline guidance keep working in that case.
* :mod:`app.main` exposes :func:`catalogue_health_snapshot` through the
  health/readiness endpoint so operators can detect drift without exposing
  secrets.
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
class CatalogueManifest:
    catalogue_version: str
    content_version: str
    model_version: str
    last_reviewed: date
    plant_status_sha256: str
    plant_status_byte_length: int
    plant_guidance_sha256: str
    plant_guidance_byte_length: int


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
        )
    except (KeyError, ValueError) as exc:
        raise CatalogueError(f"Catalogue manifest is malformed: {exc}") from exc


@lru_cache(maxsize=1)
def load_status_records() -> tuple[PlantStatusRecord, ...]:
    data = _read_json(PLANT_STATUS_PATH)
    records: list[PlantStatusRecord] = []
    for raw in data.get("records", []):
        ui_state = raw.get("ui_state")
        if ui_state not in VALID_UI_STATES:
            raise CatalogueError(
                f"Invalid ui_state {ui_state!r} for {raw.get('species_id')!r}"
            )
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
    """Raise if plant-status.json / plant-guidance.json bytes on disk drift
    from the checksums recorded in ``catalogue-manifest.json``. Intended to
    be called once during backend startup (health/readiness check)."""
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


def assert_client_catalogue_matches(
    client_catalogue_version: str | None,
    client_plant_status_sha256: str | None,
) -> None:
    """Raise :class:`CatalogueError` when the client's bundled catalogue does
    not match the server's. Both fields are optional in the request, but at
    least one must match to proceed with a report submission."""
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
            "Catalogue plant-status.json checksum mismatch — the app must "
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
