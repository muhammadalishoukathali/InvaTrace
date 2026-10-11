/**
 * The one GPS accuracy number the whole app agrees on. The client only uses it
 * for a soft warning on the report location step; the backend enforces it as a
 * hard `needs_rescan` (`screening_location_accuracy_max_m` in
 * `backend/app/config.py`). If it changes here it has to change there too, or a
 * user gets rescanned for a threshold the UI never warned them about.
 */
export const LOCATION_ACCURACY_MAX_M = 350

/* Word-for-word the same sentence the server sends back for
 * `location_accuracy_insufficient`, so the warning and the rejection read the
 * same. */
export const LOCATION_ACCURACY_INSUFFICIENT_MESSAGE =
  `Location accuracy must be within ${LOCATION_ACCURACY_MAX_M} metres.`

/** Protected-area location context (AC 3.3.4): a fix worse than this is
 *  "Boundary unavailable or uncertain". Its own limit, not the report one above.
 *  Mirrors `location_context_accuracy_max_m` in `backend/app/config.py`. */
export const LOCATION_CONTEXT_ACCURACY_MAX_M = 250

/** Removal reports: max GPS accuracy and max distance from the marker. Mirrors REMOVAL_MAX_M in backend reports.py. */
export const REMOVAL_MAX_M = 350
