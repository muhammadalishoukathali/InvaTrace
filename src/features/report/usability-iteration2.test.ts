import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { resolveNames, locationLabel } from './MyReportsPage'

// Usability testing iteration 2 - locks the behaviour of fixes that cannot be
// clicked through in the sandboxed preview (no backend, and MSW's service
// worker will not register there). Pure logic is unit-tested; UI-structure
// invariants are asserted against source in the same style as
// map-accessibility.test.ts.

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

describe('UT-09 My Records name + location + ordering', () => {
  it('resolves both common and scientific names from the catalogue', () => {
    const names = resolveNames('acacia-auriculiformis')
    expect(names.common).toBe('Earleaf acacia')
    expect(names.scientific).toBe('Acacia auriculiformis')
  })

  it('falls back to captured names, then the title-cased id', () => {
    expect(resolveNames('not-a-real-species', 'My common', 'My scientific'))
      .toEqual({ common: 'My common', scientific: 'My scientific' })
    expect(resolveNames('mystery-weed')).toEqual({ common: 'Mystery Weed', scientific: null })
    expect(resolveNames(null)).toEqual({ common: 'Uncertain species', scientific: null })
  })

  it('formats a short hemisphere-aware coordinate location label', () => {
    expect(locationLabel({ lat: 3.139, lng: 101.687 })).toBe('3.139°N, 101.687°E')
    expect(locationLabel({ lat: -1.2, lng: -0.5 })).toBe('1.200°S, 0.500°W')
    expect(locationLabel(null)).toBeNull()
  })

  it('sorts the merged report list newest-first', () => {
    const page = source('./MyReportsPage.tsx')
    expect(page).toContain('new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()')
  })
})

describe('UT-03 safety guidance leads with the action, collapses the rest', () => {
  const panel = source('../scan/PlantGuidancePanel.tsx')

  it('demotes passive reading into collapsible DetailsBlock disclosures', () => {
    expect(panel).toContain('function DetailsBlock(')
    expect(panel).toContain('<DetailsBlock title="About this plant"')
    expect(panel).toContain('<DetailsBlock title="Check the match"')
    expect(panel).toContain('<DetailsBlock title="Things to watch for"')
  })

  it('keeps the interactive safety gates inline, never inside a disclosure', () => {
    // PermissionGate/StopConditionsGate must remain their own components, not be
    // wrapped in a DetailsBlock that could hide a stop condition by default.
    expect(panel).not.toMatch(/<DetailsBlock[^>]*>\s*<PermissionGate/)
    expect(panel).toContain('<PermissionGate')
  })
})

describe('UT-04 recovery kit explains why the code matters', () => {
  it('keeps a "when you will need this" reassurance line on the recovery kit page', () => {
    const page = source('../private-access/pages/RecoveryKitSetupPage.tsx')
    // Redesigned aggressively for less clutter: the single-notice
    // explanation was collapsed to one short prose line, but the
    // acceptance criterion (tell the user WHEN they will need this)
    // still holds.
    expect(page).toMatch(/moving devices or restoring access/i)
  })
})

describe('UT-07 native look-alike honest empty state', () => {
  it('shows an uncertainty note when the twin has no reviewed image', () => {
    const result = source('../scan/ScanResultPage.tsx')
    expect(result).toContain('!detail.nativeTwin.referenceImageUrl')
    expect(result).toContain('No reviewed reference photo of the native look-alike is available yet')
  })
})

describe('UT-10 withdrawal keeps published evidence', () => {
  it('the tracking page requests withdrawal for a published report', () => {
    const page = source('./ReportTrackingPage.tsx')
    expect(page).toContain('/withdrawal')
    expect(page).toContain('Request withdrawal')
    // Only offered for published reports.
    expect(page).toMatch(/report\.status === 'screened' \|\| report\.status === 'merged'/)
  })

  it('the mock flags the sighting withdrawn and drops it from the public map', () => {
    const handlers = source('../../mocks/handlers.ts')
    expect(handlers).toContain("reports/:id/withdrawal")
    expect(handlers).toContain("s.status !== 'withdrawn'")
  })
})
