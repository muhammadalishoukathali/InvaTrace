/**
 * AC Iteration 1 P7 — single 300 m GPS accuracy policy for the whole app.
 *
 * The client uses this value for a soft warning during the report location
 * step; the server enforces it as a hard `needs_rescan` in
 * `backend/app/domain/validation.py`
 * (`screening_location_accuracy_max_m`). The two MUST stay aligned so a
 * user is never surprised by a rescan after submitting inside a threshold
 * the UI never mentioned.
 *
 * If this number changes here it must also change in
 * `backend/app/config.py::Settings.screening_location_accuracy_max_m`.
 */
export const LOCATION_ACCURACY_MAX_M = 250

/** Copy used by the server (`location_accuracy_insufficient` reason code)
 *  and by the client's soft-warning banner. Kept identical so a user who
 *  ignores the warning and then triggers the server rescan reads the same
 *  sentence twice, not two different thresholds. */
export const LOCATION_ACCURACY_INSUFFICIENT_MESSAGE =
  `Location accuracy must be within ${LOCATION_ACCURACY_MAX_M} metres.`
