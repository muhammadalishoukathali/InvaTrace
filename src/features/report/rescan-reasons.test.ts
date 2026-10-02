import { describe, expect, it } from 'vitest'
import { LOCATION_ACCURACY_INSUFFICIENT_MESSAGE } from './gps-policy'
import { humanizeReason, onlyLocationFailed } from './rescan-reasons'

describe('rescan reasons', () => {
  it('uses the shared GPS policy copy for location failures', () => {
    expect(humanizeReason('location_accuracy_insufficient')).toBe(LOCATION_ACCURACY_INSUFFICIENT_MESSAGE)
  })

  it('falls back to a readable sentence for unknown codes', () => {
    expect(humanizeReason('some_new_code')).toBe('Some new code.')
  })

  it('detects GPS-only failures', () => {
    expect(onlyLocationFailed(['location_accuracy_insufficient'])).toBe(true)
    expect(onlyLocationFailed(['location_accuracy_insufficient', 'image_too_dark'])).toBe(false)
    expect(onlyLocationFailed([])).toBe(false)
  })
})
