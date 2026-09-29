import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { describe, it, expect } from 'vitest'

import { PUBLIC_PLACE_TYPES, PLACE_TYPES } from './place-icons'

// Presentation-safe trail-clutter patch. The public map, Browse Places page,
// map legend, and adoption prompt must not surface trails as selectable
// public places. Trails still exist in the type system and stored data
// (report labels, existing adoptions) — only the public surfaces are
// trimmed. These tests pin the contract so a future refactor cannot
// silently reintroduce trail clutter without breaking them.

const threatMap = readFileSync(
  fileURLToPath(new URL('./ThreatMapPage.tsx', import.meta.url)),
  'utf8',
)
const legend = readFileSync(
  fileURLToPath(new URL('./MapLegend.tsx', import.meta.url)),
  'utf8',
)
const placesPage = readFileSync(
  fileURLToPath(new URL('../places/PlacesPage.tsx', import.meta.url)),
  'utf8',
)
const reportTracking = readFileSync(
  fileURLToPath(new URL('../report/ReportTrackingPage.tsx', import.meta.url)),
  'utf8',
)

describe('trail-clutter presentation-safe patch', () => {
  it('PUBLIC_PLACE_TYPES lists park, forest, and wood but not trail', () => {
    expect(PUBLIC_PLACE_TYPES).toEqual(['park', 'forest', 'wood'])
    expect(PUBLIC_PLACE_TYPES).not.toContain('trail')
    // The full PLACE_TYPES contract still carries trail for backward
    // compatibility (sighting labels, existing adoptions).
    expect(PLACE_TYPES).toContain('trail')
  })

  it('the map request appends place_type for exactly the public types', () => {
    expect(threatMap).toContain(
      "for (const placeType of PUBLIC_PLACE_TYPES) params.append('place_type', placeType)",
    )
    // The request must not hard-code trail.
    expect(threatMap).not.toMatch(/params\.append\(['"]place_type['"],\s*['"]trail['"]\)/)
  })

  it('the map defensively filters trail features before rendering', () => {
    expect(threatMap).toContain('const publicSet = new Set<string>(PUBLIC_PLACE_TYPES)')
    expect(threatMap).toContain('publicSet.has(feature.properties.placeType)')
  })

  it('the map legend iterates PUBLIC_PLACE_TYPES rather than PLACE_TYPES', () => {
    expect(legend).toContain('PUBLIC_PLACE_TYPES.map((placeType)')
    // Word-boundary match keeps this from firing on the PUBLIC_ prefix.
    expect(legend).not.toMatch(/(?<!PUBLIC_)PLACE_TYPES\.map\(\(placeType\)/)
  })

  it('Browse Places filters out trail rows before search is applied', () => {
    expect(placesPage).toContain("place.placeType !== 'trail'")
    // The filtered list is what feeds the "no supported places" empty
    // state, so a dataset that only contains trails shows that state
    // instead of a broken list.
    expect(placesPage).toContain('!publicItems.length')
  })

  it('Browse Places copy describes parks, forests and woodlands only', () => {
    expect(placesPage).toContain('Select a named park, forest or woodland')
    expect(placesPage).toContain('Search park, forest or woodland')
    expect(placesPage).not.toMatch(/Select a named park, forest or trail/)
    expect(placesPage).not.toMatch(/Search park, forest or trail/)
  })

  it('the empty mapped-places message names woodlands rather than trails', () => {
    expect(threatMap).toContain('parks, forests and woodlands')
    expect(threatMap).not.toContain('nearby parks, forests and trails')
  })

  it('the report adoption prompt is gated on placeType !== "trail"', () => {
    expect(reportTracking).toContain(
      "adoptionPlace.data.place.placeType !== 'trail'",
    )
  })
})
