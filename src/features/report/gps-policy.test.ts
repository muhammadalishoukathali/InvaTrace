import { describe, it, expect } from 'vitest'
import {
  LOCATION_ACCURACY_MAX_M,
  LOCATION_ACCURACY_INSUFFICIENT_MESSAGE,
} from './gps-policy'

// AC Iteration 1 P7 - the client's warning threshold and error copy must
// stay pinned to the same 300 m number the server enforces at
// backend/app/config.py::screening_location_accuracy_max_m. A silent drift
// here would let a user submit at 350 m without ever seeing the warning
// that predicts the server-side rescan they are about to receive.

describe('GPS accuracy policy', () => {
  it('locks the single threshold at 250 m', () => {
    expect(LOCATION_ACCURACY_MAX_M).toBe(250)
  })

  it('embeds the threshold in the rescan message so client and server copy match', () => {
    expect(LOCATION_ACCURACY_INSUFFICIENT_MESSAGE).toBe(
      'Location accuracy must be within 250 metres.',
    )
  })
})
