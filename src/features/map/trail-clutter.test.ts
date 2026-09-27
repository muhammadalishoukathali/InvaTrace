import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { PUBLIC_PLACE_TYPES } from './place-icons'

// Presentation-safe patch: generic OSM paths/footways/tracks (place-type
// `trail`) must stop appearing as selectable places on the public map and in
// Browse Places, while existing trail rows, detail URLs and adoptions keep
// working untouched. See the handover doc for the full requirement set.

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

describe('public place types', () => {
  it('excludes trail from the publicly selectable place types', () => {
    expect(PUBLIC_PLACE_TYPES).toEqual(['park', 'forest', 'wood'])
    expect(PUBLIC_PLACE_TYPES).not.toContain('trail')
  })
})

describe('map request contains exactly the public place types', () => {
  const threatMap = source('./ThreatMapPage.tsx')

  it('appends a place_type param per public place type when requesting /places/map', () => {
    expect(threatMap).toContain("PUBLIC_PLACE_TYPES.forEach((placeType) => params.append('place_type', placeType))")
  })

  it('filters returned features defensively so a stale API or mock cannot leak a trail', () => {
    const block = threatMap.split('void api<PlaceMapResponse>')[1]?.split('.catch(')[0] ?? ''
    expect(block).toContain('features: response.features.filter((feature) => (')
    expect(block).toContain('PUBLIC_PLACE_TYPES')
    expect(block).toContain('feature.properties.placeType')
  })

  it('does not request place_type=trail', () => {
    expect(threatMap).not.toContain("place_type=trail")
  })
})

describe('legend lists Park, Forest and Woodland but not Trail', () => {
  const legend = source('./MapLegend.tsx')

  it('renders the place rows from PUBLIC_PLACE_TYPES, not the full PLACE_TYPES list', () => {
    expect(legend).toContain('PUBLIC_PLACE_TYPES.map((placeType) =>')
    expect(legend).not.toMatch(/\bPLACE_TYPES\.map/)
  })
})
