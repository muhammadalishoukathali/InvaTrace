"""Versioned, read-only catalogue pack metadata and reviewed JSON files."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Response

from app.core.errors import ApiProblem
from app.domain.catalogue import CATALOGUE_ROOT, MANIFEST_PATH

router = APIRouter(prefix="/api/v1/offline-pack", tags=["offline-pack"])

PACK_FILES = frozenset(
    {
        "approved-species.json",
        "catalogue-details.json",
        "plant-guidance.json",
        "plant-status.json",
        "reference-images.json",
    }
)


def _manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def _json_response(path: Path) -> Response:
    return Response(
        content=path.read_bytes(),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/latest")
def latest_offline_pack() -> Response:
    """Return the current integrity manifest without allowing stale caching."""
    return _json_response(MANIFEST_PATH)


@router.get("/{version}/{file_name}")
def offline_pack_file(version: str, file_name: str) -> Response:
    """Serve only the allow-listed reviewed JSON payloads for the active version."""
    manifest = _manifest()
    if version != manifest.get("catalogue_version"):
        raise ApiProblem(404, "offline_pack_version_not_found", "Offline pack version not found.")
    if file_name not in PACK_FILES or file_name not in manifest.get("files", {}):
        raise ApiProblem(404, "offline_pack_file_not_found", "Offline pack file not found.")
    path = CATALOGUE_ROOT / file_name
    if not path.is_file():
        raise ApiProblem(503, "offline_pack_unavailable", "Offline pack is temporarily unavailable.")
    return _json_response(path)
