import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// AC Iteration 1 P9 - the visual map is inert for non-sighted / keyboard-only
// users. These tests pin the accessible-fallback contract with the ThreatMapPage
// and MapFilters source so a future refactor cannot silently remove the
// role="application" label, the always-rendered sr-only mirror list, or the
// semantic filter groupings.

const threatMap = readFileSync(
  fileURLToPath(new URL('./ThreatMapPage.tsx', import.meta.url)),
  'utf8',
)
const filters = readFileSync(
  fileURLToPath(new URL('./MapFilters.tsx', import.meta.url)),
  'utf8',
)

describe('map accessibility fallback', () => {
  it('the map canvas exposes role=application with a describing label', () => {
    expect(threatMap).toContain('role="application"')
    expect(threatMap).toContain('aria-label="Interactive community reports and mapped places. Parallel accessible lists are available below the map."')
    expect(threatMap).toContain('aria-describedby="map-live-count"')
    expect(threatMap).toContain('id="map-live-count"')
  })

  it('the accessible list renders in loading, error, and empty states', () => {
    // Extracting the component body isolates the state-branch invariants.
    const body = threatMap.split('function AccessibleSightingList(')[1]
      ?.split('\n}\n')[0]
    expect(body, 'AccessibleSightingList missing').toBeTruthy()
    expect(body).toContain('isLoading')
    expect(body).toContain('isError')
    expect(body).toContain('onRetry')
    expect(body).toMatch(/No community reports match the current filters/)
    expect(body).toMatch(/Loading community reports/)
    expect(body).toMatch(/Community reports could not load/)
  })

  it('the accessible list is always rendered, not gated on data', () => {
    // The JSX call site must not guard the fallback on `data`, `isLoading`,
    // or `!isError` - otherwise SR users lose the mirror in exactly the
    // states where the visual map is least usable.
    // Match the JSX with attributes; the leading `\n` skips the comment
    // that mentions <AccessibleSightingList/> as a self-closing token.
    const callSite = threatMap.match(/<AccessibleSightingList\s[\s\S]*?\n\s*\/>/)?.[0]
    expect(callSite, 'AccessibleSightingList call site missing').toBeTruthy()
    // Sanity: the call site passes through the state flags rather than being
    // wrapped in a `data && …` conditional.
    expect(callSite).toContain('isLoading={isLoading}')
    expect(callSite).toContain('isError={isError}')
  })

  it('desktop filter chip clusters are semantically grouped for screen readers', () => {
    expect(filters).toContain('role="group" aria-label="Species filters"')
    expect(filters).toContain('role="group" aria-label="Risk filters"')
    expect(filters).toContain('role="group" aria-label="Status filters"')
  })

  it('adds a clustered GeoJSON place source only after the map style loads', () => {
    const styleLoad = threatMap.indexOf("m.once('style.load'")
    const source = threatMap.indexOf('m.addSource(PLACE_SOURCE_ID')
    expect(styleLoad).toBeGreaterThan(-1)
    expect(source).toBeGreaterThan(styleLoad)
    expect(threatMap).toContain('cluster: true')
    expect(threatMap).toContain("id: 'place-clusters'")
    expect(threatMap).toContain("id: 'place-points'")
    expect(threatMap).toContain("'circle-color': ['match', ['get', 'placeType']")
  })

  it('debounces viewport requests and provides an independent places toggle', () => {
    expect(threatMap).toContain("m.on('moveend', schedulePlaces)")
    expect(threatMap).toContain('}, 300)')
    expect(threatMap).toContain('/api/v1/places/map?')
    expect(threatMap).toContain('aria-pressed={showPlaces}')
    expect(threatMap).toContain("{showPlaces ? 'Hide places' : 'Show places'}")
  })

  it('provides an accessible place list and canonical preview action', () => {
    expect(threatMap).toContain('function AccessiblePlaceList(')
    expect(threatMap).toContain('aria-label="Mapped places in current view"')
    expect(threatMap).toContain('role="dialog"')
    expect(threatMap).toContain('aria-label="Close place preview"')
    expect(threatMap).toContain('View plants recorded nearby')
    expect(threatMap).toContain('to={`/places/${selectedPlace.placeId}`}')
  })
})
