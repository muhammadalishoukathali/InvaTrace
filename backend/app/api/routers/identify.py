"""PlantNet verification endpoint.

Second-opinion identifier for scans the on-device model was not confident
about. The frontend calls this only when Student33 returns `uncertain`
(top core-target probability under the calibrated Unknown threshold). The
API key never leaves the server.

Product-level labelling that the UI applies to a scan result:

- The on-device model matches one of the 32 InvaTrace-catalogue invasives
  → shown as "Invasive". No PlantNet call needed for that path.
- The on-device model returns `uncertain` and PlantNet identifies the plant
  → shown as "Native Species".
- Both fail (or PlantNet is disabled / unreachable) → shown as
  "Not Sure / Unable to verify".

Any HTTP-level failure - PlantNet down, quota exhausted, image rejected -
degrades to `not_sure` so the UI can render a real answer to the user
instead of blocking on a broken external dependency.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.core.errors import ApiProblem
from app.core.security import AuthContext, require_auth
from app.services.plantnet import PlantNetVerification, verify_image

router = APIRouter(prefix="/api/v1/identify", tags=["identify"])


class VerificationSpeciesResponse(BaseModel):
    scientific_name: str = Field(alias="scientificName")
    common_names: list[str] = Field(default_factory=list, alias="commonNames")
    family: str | None = None
    score: float

    model_config = {"populate_by_name": True}


class VerificationResponse(BaseModel):
    label: str = Field(description="Product-level label: native | not_sure")
    status: str = Field(description="Raw PlantNet-side status: native, not_sure, disabled, error")
    species: VerificationSpeciesResponse | None = None
    reason: str | None = None
    provider: str = "plantnet"


_ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_BYTES = 6 * 1024 * 1024
# Bytes the file actually starts with (magic numbers), so the server does not
# trust the client-supplied Content-Type header for a file it forwards to a
# third party. WebP is `RIFF????WEBP` where ???? is the size, so we match on
# the RIFF+WEBP framing rather than the size bytes in between.
_MAGIC_JPEG = b"\xff\xd8\xff"
_MAGIC_PNG = b"\x89PNG\r\n\x1a\n"


def _looks_like_supported_image(payload: bytes) -> bool:
    if payload.startswith(_MAGIC_JPEG):
        return True
    if payload.startswith(_MAGIC_PNG):
        return True
    if len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP":
        return True
    return False


def _shape(verification: PlantNetVerification) -> VerificationResponse:
    # An `error` on the PlantNet side is not an error the caller should
    # retry - PlantNet is a best-effort second opinion, so downgrade it to
    # a not-sure result so the UI does not have to distinguish transient
    # PlantNet outages from a genuine "we cannot identify this" answer.
    ui_label = "native" if verification.status == "native" else "not_sure"
    species = (
        VerificationSpeciesResponse(
            scientificName=verification.species.scientific_name,
            commonNames=list(verification.species.common_names),
            family=verification.species.family,
            score=verification.species.score,
        )
        if verification.species
        else None
    )
    return VerificationResponse(
        label=ui_label,
        status=verification.status,
        species=species,
        reason=verification.reason,
    )


@router.post("/plantnet-verify", response_model=VerificationResponse)
async def plantnet_verify(
    image: Annotated[UploadFile, File()],
    organ: Annotated[str, Form()] = "auto",
    _auth: AuthContext = Depends(require_auth),
    settings: Settings = Depends(get_settings),
) -> VerificationResponse:
    content_type = (image.content_type or "").lower()
    if content_type not in _ALLOWED_TYPES:
        raise ApiProblem(
            415,
            "verification_unsupported_type",
            "PlantNet verification accepts JPEG, PNG or WebP images.",
        )
    # Read in bounded chunks so a malicious huge upload is rejected before
    # the whole body reaches memory. `_MAX_BYTES + 1` triggers the size
    # branch as soon as one more byte lands past the limit.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await image.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > _MAX_BYTES:
            raise ApiProblem(
                413,
                "verification_image_too_large",
                "Verification image exceeds the 6 MB limit.",
            )
        chunks.append(chunk)
    payload = b"".join(chunks)
    if not payload:
        raise ApiProblem(422, "verification_empty_image", "Verification image is empty.")
    # Magic-byte sniff: the header can be spoofed, so a JPEG-labelled payload
    # that does not start with the JPEG marker never reaches PlantNet.
    if not _looks_like_supported_image(payload):
        raise ApiProblem(
            415,
            "verification_unsupported_type",
            "PlantNet verification accepts JPEG, PNG or WebP images.",
        )
    verification = await verify_image(
        image_bytes=payload,
        filename=image.filename or "scan.jpg",
        content_type=content_type,
        settings=settings,
        organs=(organ or "auto",),
    )
    return _shape(verification)
