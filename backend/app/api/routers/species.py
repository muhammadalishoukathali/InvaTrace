from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.schemas import (
    MalaysiaStatus,
    SeasonalActionGuide,
    SpeciesDetail,
    SpeciesListResponse,
    SpeciesSummary,
)
from app.config import get_settings
from app.core.errors import ApiProblem
from app.db.base import get_session
from app.db.models import Species
from app.domain.action_guidance import (
    _observe_and_report_fallback,
    current_action_guide,
)

"""Species catalogue and on-device model config — mostly reference data.

Backs the species browser/detail screens and the "what am I allowed to
report" logic. Also exposes the acceptance threshold and supported model
versions so the app's on-device classifier knows what the server currently
expects (see model_acceptance_threshold usage in reports.py).
"""

router = APIRouter(prefix="/api/v1/species", tags=["species"])
model_config_router = APIRouter(prefix="/api/v1/model-config", tags=["model"])


# AC 1.1.3 — the versioned server model configuration is authoritative for
# the product acceptance threshold. The app fetches this on startup, caches
# it, and produces an uncertain result if it cannot be obtained safely so
# the client never guesses with stale numbers.
@model_config_router.get("")
def model_config() -> dict[str, object]:
    settings = get_settings()
    # `configVersion` lets the client cache-bust when the threshold changes;
    # `modelVersion` is the current preferred version so a client can warn
    # if it is on an older but still supported build.
    supported = list(settings.e1_model_versions)
    return {
        "modelVersion": supported[0] if supported else None,
        "supportedVersions": supported,
        "acceptanceThreshold": settings.model_acceptance_threshold,
        "thresholdVersion": f"{supported[0] if supported else 'unknown'}"
        f"@{settings.model_acceptance_threshold:.4f}",
        "configVersion": f"{supported[0] if supported else 'unknown'}"
        f"@{settings.model_acceptance_threshold:.4f}",
    }


# The DB tracks Malaysia's official invasive-status categories in more
# detail than the UI needs — this collapses them down to the three states
# the frontend actually renders differently (invasive / info-only / uncertain).
_STATUS_TO_UI: dict[str, MalaysiaStatus] = {
    "invasive": "invasive",
    "alien_not_marked_invasive": "information_only",
    "common_cultivated_status_not_inferred": "information_only",
    "introduced": "information_only",
    # AC 1.2.1 — parity with frontend malaysia-status.ts; both native and
    # naturalised must resolve to information_only server-side too, otherwise
    # the fail-safe drop to status_uncertain hides valid catalogue values.
    "native": "information_only",
    "naturalised": "information_only",
    "status_requires_expert_review": "status_uncertain",
    "cryptogenic_uncertain": "status_uncertain",
    "watchlist_not_present": "status_uncertain",
}


# AC 1.2.3 — short, canonical do-not-act message shown alongside every
# accepted supported label. Kept in one place so info-only / uncertain
# results say the same thing across scan-result, guidance panel, tests.
_SAFETY_MESSAGE: dict[MalaysiaStatus, str] = {
    "invasive": (
        "Reviewed as invasive in Malaysia. Follow the reviewed guidance"
        " below before taking any action."
    ),
    "information_only": (
        "Information only. Observe, do not remove or disturb. This plant"
        " is not on the reportable list."
    ),
    "status_uncertain": (
        "Malaysian status is uncertain. Do not remove or report this plant"
        " as invasive; observe and photograph if useful."
    ),
}


def _ui_malaysia_status(item: Species) -> MalaysiaStatus:
    raw = (item.malaysia_status or "").strip()
    if raw in _STATUS_TO_UI:
        return _STATUS_TO_UI[raw]
    # AC 1.2.1: absent or failed lookup must return Status uncertain.
    return "status_uncertain"


# Species picker list — used e.g. when the user browses/searches species
# outside of a scan result. Kept lightweight (SpeciesSummary, not the full
# detail record) since this can return the whole catalogue at once.
@router.get("", response_model=SpeciesListResponse)
def list_species(session: Session = Depends(get_session)) -> SpeciesListResponse:
    species = session.scalars(select(Species).order_by(Species.name)).all()
    return SpeciesListResponse(
        items=[
            SpeciesSummary(
                id=item.id,
                name=item.name,
                latin_name=item.latin_name,
                is_invasive=item.is_invasive,
            )
            for item in species
        ]
    )


# Species detail screen — traits, removal steps, native look-alike, and
# whether the user is even allowed to report/act on this species right now.
@router.get("/{species_id}", response_model=SpeciesDetail)
def species_detail(species_id: str, session: Session = Depends(get_session)) -> SpeciesDetail:
    item = session.get(Species, species_id)
    if not item:
        raise ApiProblem(404, "species_not_found", "Not found")
    ui_status = _ui_malaysia_status(item)
    guide = current_action_guide(item)
    # AC 1.2.3: information-only / uncertain MUST have action_eligible=false and report_eligible=false
    # current_action_guide already handles seasonality; "report_only" mode
    # means there's no active removal guidance right now, so don't let the UI
    # offer a removal action even if the species record itself is flagged eligible.
    has_active_guide = guide is not None and guide.guidance_mode != "report_only"
    action_eligible = bool(item.action_eligible) and ui_status == "invasive" and has_active_guide
    report_eligible = bool(item.reportable) and ui_status == "invasive"
    # AC 1.2.3 — tell the client, per status, exactly what it is and is not
    # allowed to offer. Kept short and neutral so it renders in the scan
    # result "About this plant" strip without extra styling.
    safety_message = _SAFETY_MESSAGE.get(ui_status)
    return SpeciesDetail(
        id=item.id,
        name=item.name,
        latin_name=item.latin_name,
        common_names=item.common_names,
        is_invasive=item.is_invasive,
        risk=item.risk or "watch",
        traits=item.traits,
        native_twin=item.native_twin,
        removal_steps=item.removal_steps,
        do_not_do=item.do_not_do,
        reportable=item.reportable,
        action_guide=guide,
        malaysia_status=ui_status,
        status_source_id=item.status_source,
        status_reviewed_at=item.status_reviewed_at,
        general_information=item.general_information,
        safety_message=safety_message,
        action_eligible=action_eligible,
        report_eligible=report_eligible,
    )


# AC 3.1.1 — canonical versioned guidance endpoint. The frontend
# PlantGuidancePanel used to read a bundled JSON copy that could drift from
# the seed dataset; this endpoint returns the same SeasonalActionGuide record
# the report-screening path uses, and falls back to an observe-and-report-only
# response when the requested species has no reviewed record. Never builds
# improvised removal steps.
@router.get("/{species_id}/guidance", response_model=SeasonalActionGuide)
def species_guidance(
    species_id: str,
    observed_at: datetime | None = Query(default=None, alias="observedAt"),
    session: Session = Depends(get_session),
) -> SeasonalActionGuide:
    item = session.get(Species, species_id)
    if not item:
        raise ApiProblem(404, "species_not_found", "Not found")
    ui_status = _ui_malaysia_status(item)
    # Info-only / uncertain / non-reportable → hard fallback so the client
    # cannot render active removal steps for a plant we do not authorise.
    if ui_status != "invasive" or not item.reportable:
        return _observe_and_report_fallback(item)
    when = observed_at or datetime.now(UTC)
    guide = current_action_guide(item, observed_at=when)
    return guide or _observe_and_report_fallback(item)
