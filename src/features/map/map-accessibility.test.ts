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
    expect(threatMap).toContain("id: 'place-points-fallback'")
    expect(threatMap).toContain("id: 'place-points'")
    // Browser-decode the locally bundled SVGs before handing them to
    // MapLibre; its URL loader does not guarantee SVG support.
    expect(threatMap).toContain('loadSvgImage(spec.svg)')
    expect(threatMap).not.toContain('.loadImage(svgDataUrl')
    // The symbol layer provides distinct icons and the circle layer provides
    // a visible/clickable fallback if icon decoding fails.
    expect(threatMap).toContain("type: 'symbol'")
    expect(threatMap).toContain("type: 'circle'")
    expect(threatMap).toContain("'icon-image': ['match', ['get', 'placeType']")
    expect(threatMap).toContain('PLACE_ICONS.park.id')
    expect(threatMap).toContain('PLACE_ICONS.forest.id')
    expect(threatMap).toContain('PLACE_ICONS.wood.id')
    expect(threatMap).toContain('PLACE_ICONS.trail.id')
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

// AC 4.2.3 - species filter and accessible fallback. When one or more
// supported species are selected, both markers AND the accompanying report
// list must show only matching reports, and the active filter + result
// count must be exposed. Every marker must have a keyboard-accessible list
// item.
describe('AC 4.2.3 species filter and accessible fallback', () => {
  it('drives markers and the accessible list from the same filtered array', () => {
    // Both call sites must consume `filtered` (or an equivalent expression
    // derived from it), so a change to filter state affects markers and
    // list in lock-step rather than filtering one but not the other.
    expect(threatMap).toMatch(/items=\{filtered\}/)
    // The marker-rebuild effect iterates the same array the accessible
    // list receives - regression against filtering one but not the other.
    const markerEffect = threatMap.split('markers.current')[1] ?? ''
    expect(markerEffect.length).toBeGreaterThan(0)
    expect(threatMap).toMatch(/filtered\.forEach|for \(const [a-zA-Z_]+ of filtered\)/)
  })

  it('exposes the active filter and result count via a live region', () => {
    // The visible chip must be a live region so screen readers hear the
    // new count when a filter toggles, not just when the page loads.
    expect(threatMap).toContain('id="map-live-count"')
    // The live region attributes sit next to each other in the JSX; the
    // aria-describedby on the map canvas points to this same id.
    const liveBlock = threatMap.split('id="map-live-count"')[1]?.split('</div>')[0] ?? ''
    expect(liveBlock).toContain('role="status"')
    expect(liveBlock).toContain('aria-live="polite"')
    // The result count and the active-filter count must both appear,
    // so a mentor running the acceptance test sees "Showing N reports · M
    // filters active" rather than one number without context.
    expect(threatMap).toMatch(/Showing \$\{filtered\.length\}/)
    // The "N filters active" suffix must render whenever any filter is
    // engaged; text-only check tolerates future whitespace tweaks.
    expect(threatMap).toContain('{filtersActive}')
    expect(threatMap).toContain("filter{filtersActive === 1 ? '' : 's'} active")
    expect(threatMap).toContain('filtersActive > 0')
  })

  it('the sr-only list restates the current filtered count for AT users', () => {
    const body = threatMap.split('function AccessibleSightingList(')[1]
      ?.split('\n}\n')[0] ?? ''
    // Same wording the mentor's acceptance script looks for; either the
    // "N reports match" plural or the singular / empty state.
    expect(body).toMatch(/\$\{items\.length\} community report/)
    expect(body).toContain('No community reports match the current filters')
  })

  it('offers a keyboard-visible Clear affordance the moment any filter is active', () => {
    // Regression against removing the clear button in a redesign - without
    // it, a keyboard-only user who applied a species filter cannot reset
    // it in one step and the acceptance script fails.
    expect(filters).toMatch(/\{active > 0 && \(/)
    expect(filters).toContain('onClick={clearFilters}')
    expect(filters).toMatch(/Clear \(\{active\}\)/)
  })

  it('MapFilters state contract carries the multi-select species array', () => {
    // The store field must be an array so the URL/query builder can emit
    // `?species=a&species=b` (AC 4.2.3 API contract), not a single value.
    const store = readFileSync(
      fileURLToPath(new URL('./map-view-store.ts', import.meta.url)),
      'utf8',
    )
    expect(store).toMatch(/species: string\[\]/)
    expect(store).toContain('toggleSpecies')
    expect(filters).toContain('toggleSpecies')
    // The filter clusters accept the array without collapsing to a scalar.
    expect(filters).toContain('species.includes(s.id)')
  })
})
