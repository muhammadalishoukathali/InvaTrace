"""Validation helpers for auditable external-data releases."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class DataRelease:
    dataset_id: str
    source: str
    source_url: str
    upstream_version: str
    retrieved_at: str
    licence: str
    licence_url: str
    sha256: str
    byte_length: int
    metadata: dict[str, Any]


def validate_data_release(
    manifest_path: Path,
    data_path: Path,
    *,
    expected_dataset_id: str | None = None,
) -> DataRelease:
    """Verify required provenance and bind the manifest to the exact input bytes."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema_version") != "invatrace.data-release.v1":
        raise ValueError("data release must use invatrace.data-release.v1")
    required = (
        "dataset_id",
        "source",
        "source_url",
        "upstream_version",
        "retrieved_at",
        "licence",
        "licence_url",
        "file",
        "sha256",
        "byte_length",
    )
    missing = [key for key in required if not manifest.get(key)]
    if missing:
        raise ValueError(f"data release metadata is incomplete: {', '.join(missing)}")
    if expected_dataset_id and manifest["dataset_id"] != expected_dataset_id:
        raise ValueError(
            f"expected dataset {expected_dataset_id!r}, got {manifest['dataset_id']!r}"
        )
    if manifest["file"] != data_path.name:
        raise ValueError("data release filename does not match the supplied data file")
    digest = hashlib.sha256()
    actual_byte_length = 0
    with data_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
            actual_byte_length += len(chunk)
    actual_sha256 = digest.hexdigest()
    if actual_sha256 != manifest["sha256"]:
        raise ValueError(
            f"data release SHA-256 mismatch: expected {manifest['sha256']}, got {actual_sha256}"
        )
    if actual_byte_length != int(manifest["byte_length"]):
        raise ValueError("data release byte length does not match the supplied data file")
    return DataRelease(
        dataset_id=manifest["dataset_id"],
        source=manifest["source"],
        source_url=manifest["source_url"],
        upstream_version=manifest["upstream_version"],
        retrieved_at=manifest["retrieved_at"],
        licence=manifest["licence"],
        licence_url=manifest["licence_url"],
        sha256=actual_sha256,
        byte_length=actual_byte_length,
        metadata=manifest,
    )
