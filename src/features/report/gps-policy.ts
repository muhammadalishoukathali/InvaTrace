/**
 * This is the one GPS accuracy number the whole app agrees on. On the
 * client we only use it for a soft warning during the report location step
 * — we never block the user with it. On the backend though it's enforced
 * as a hard `needs_rescan` in `backend/app/domain/validation.py`
 * (`screening_location_accuracy_max_m`). These two values have to stay in
 * sync, otherwise a user could submit thinking their fix was fine and then
 * get rescanned for a threshold the UI never even warned them about.
 *
 * If this number ever changes here, it needs to change in
 * `backend/app/config.py::Settings.screening_location_accuracy_max_m` too —
 * not the cleanest setup, would be nicer to share this from one place, but
 * keeping the two files in sync manually works fine for now.
 */
export const LOCATION_ACCURACY_MAX_M = 250

/* Same message the server uses for the `location_accuracy_insufficient`
 * reason code and the one shown in the client's soft-warning banner. Kept
 * word-for-word identical on purpose — if a user ignores our warning and
 * then gets rescanned by the server, they should read the same sentence
 * both times, not two different-sounding explanations for the same thing. */
export const LOCATION_ACCURACY_INSUFFICIENT_MESSAGE =
  `Location accuracy must be within ${LOCATION_ACCURACY_MAX_M} metres.`
