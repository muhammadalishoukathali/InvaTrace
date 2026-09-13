"""Regression tests for the single 250 m GPS accuracy policy.

AC Iteration 1 P7 - the whole pipeline shares one threshold. This test
asserts:
  1. The backend setting defaults to 250 m.
  2. The validation policy actually uses the setting's default when a
     caller omits the threshold field.
  3. The frontend policy file (gps-policy.ts) hard-codes the same number
     so a drift on either side is caught here at test time.

Runs as a source-text / dataclass-default check so it does not depend on
the backend Python environment or the frontend build.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (REPO_ROOT / rel).read_text()


def test_backend_setting_defaults_to_300_metres() -> None:
    source = _read("app/config.py")
    match = re.search(
        r"screening_location_accuracy_max_m\s*:\s*int\s*=\s*Field\(\s*default=(\d+)",
        source,
    )
    assert match, "screening_location_accuracy_max_m must be declared with a Field default."
    assert match.group(1) == "250", (
        f"Backend accuracy policy drifted from 250 m - found {match.group(1)}."
        " Update the frontend gps-policy.ts constant to match."
    )


def test_validation_default_threshold_is_300_metres() -> None:
    source = _read("app/domain/validation.py")
    assert "DEFAULT_LOCATION_ACCURACY_MAX_M = 250" in source, (
        "Validation module must expose 250 m as its default threshold so a"
        " caller that omits the field still gets the canonical policy."
    )
    assert "location_accuracy_threshold_m: int = DEFAULT_LOCATION_ACCURACY_MAX_M" in source, (
        "ValidationInput must default the threshold to the canonical constant, not a raw literal."
    )
    assert "input.location_accuracy_m > input.location_accuracy_threshold_m" in source, (
        "The rescan check must compare against the input threshold, not a hard-coded value."
    )


def test_frontend_gps_policy_pins_the_same_threshold() -> None:
    frontend = REPO_ROOT.parent / "src/features/report/gps-policy.ts"
    text = frontend.read_text(encoding="utf-8")
    assert "LOCATION_ACCURACY_MAX_M = 250" in text, (
        "Frontend gps-policy.ts must pin the threshold at 250 m to match the"
        " backend screening_location_accuracy_max_m default."
    )
    assert "within ${LOCATION_ACCURACY_MAX_M} metres" in text, (
        "The insufficient-accuracy message must interpolate the shared constant, not a literal."
    )
