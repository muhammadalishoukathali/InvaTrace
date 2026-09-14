import { describe, it, expect } from 'vitest'
import { NAV, isEnabled, visibleNav } from './nav'

describe('navigation gating', () => {
  it('enables only destinations available in the current release', () => {
    const enabled = NAV.filter((i) => isEnabled(i, 'Volunteer')).map((i) => i.id)
    expect(enabled).toEqual(['map', 'places', 'catalogue', 'reports', 'areas'])
  })

  it('shows Iteration 2 destinations to every field role', () => {
    for (const role of ['Detector', 'Volunteer'] as const) {
      const ids = visibleNav(role).map((i) => i.id)
      expect(ids).toEqual(['map', 'places', 'catalogue', 'reports', 'areas'])
      expect(NAV.filter((i) => i.iteration <= 2).every((i) => isEnabled(i, role))).toBe(true)
    }
  })
})
