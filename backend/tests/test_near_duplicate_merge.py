"""Regression tests for the near-duplicate merge query in verification.

AC 2.3.2 + AC Iteration 1 P5 — merges must be scoped to the same anonymous
profile, use PostGIS `ST_DWithin` at exactly 25 m (no GPS-accuracy expansion),
anchor the 10-minute window on the report's observation time rather than
`datetime.now()`, and pick the closest candidate by geodesic distance.

Runs against the source text so it does not depend on the backend Python
environment or a live PostGIS. Its job is to fail loudly if a future edit
silently relaxes any of these invariants.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _merge_target_body() -> str:
    source = (REPO_ROOT / "app/workers/verification.py").read_text()
    marker = "def _find_merge_target("
    assert marker in source, "_find_merge_target helper missing."
    return source.split(marker, 1)[1].split("\ndef ", 1)[0]


def test_merge_target_is_scoped_to_same_profile() -> None:
    body = _merge_target_body()
    assert "Sighting.source_profile_id == report.profile_id" in body, (
        "Near-duplicate merges must stay within a single anonymous identity."
        " Cross-owner near-coincidences publish as their own pins."
    )


def test_merge_target_uses_exact_radius_no_accuracy_expansion() -> None:
    body = _merge_target_body()
    assert "settings.screening_duplicate_radius_max_m" in body, (
        "Merge radius must come from screening_duplicate_radius_max_m — hard"
        " coded values or accuracy-based expansion would let cross-user reports"
        " inside the GPS fuzz zone get silently merged."
    )
    assert "location_accuracy_m" not in body, (
        "The 25 m radius is intentionally independent of GPS accuracy;"
        " referencing location_accuracy_m in this helper would re-introduce"
        " the accuracy-expansion regression called out in AC 2.3.2."
    )


def test_merge_target_uses_st_dwithin_and_orders_by_distance() -> None:
    body = _merge_target_body()
    assert "func.ST_DWithin(Sighting.location, report.location, radius_m)" in body, (
        "Filter must use ST_DWithin on the stored geography column so PostGIS"
        " computes geodesic (meters) distance, not planar."
    )
    assert "order_by(func.ST_Distance(Sighting.location, report.location))" in body, (
        "Order by geodesic distance so the closest candidate wins when several"
        " sightings sit inside the 25 m radius."
    )


def test_merge_window_is_anchored_on_observation_time_not_now() -> None:
    body = _merge_target_body()
    assert "report.observed_at" in body, (
        "10-minute merge window must anchor on the report's observation time"
        " so a late-arriving submission is not compared against sightings that"
        " are only 'recent' relative to submission time."
    )
    assert "cutoff = datetime.now(UTC) - timedelta" not in body, (
        "Using datetime.now() as the window anchor lets a queued or replayed"
        " report merge into sightings observed hours after it — regression."
    )
