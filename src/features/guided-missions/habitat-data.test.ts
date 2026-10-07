import { describe, expect, it } from 'vitest'
import {
  bboxToBounds, compatibleHabitats, habitatsForPlants, legendFor, plantsForHabitat, sanitiseOverlay,
  toAppSpeciesId, visibleFeatures, type HabitatCategory, type HabitatOverlay,
} from './habitat-data'

const lookup = new Map<string, HabitatCategory[]>([
  ['mikania-micrantha', ['forest_edge_opening', 'water_edge', 'disturbed_built_edge']],
  ['eichhornia-crassipes', ['permanent_water', 'water_edge']],
  ['chromolaena-odorata', ['open_grassland']],
])
const feature = (habitat: string, label = habitat): HabitatOverlay['features'][number] => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[101.70, 3.17], [101.71, 3.17], [101.71, 3.18], [101.70, 3.17]]] },
  properties: { place_id: 'p', habitat: habitat as HabitatCategory, habitat_label: label, resolution_m: 50 },
})
const overlay: HabitatOverlay = {
  type: 'FeatureCollection',
  features: [feature('water_edge', 'Water edge'), feature('water_edge', 'Water edge'), feature('permanent_water', 'Permanent water'), feature('forest_interior', 'Forest interior')],
}

describe('habitat matching (Epic 7, handover section 8)', () => {
  it('normalises lookup ids to the app catalogue format', () => {
    expect(toAppSpeciesId('mikania_micrantha')).toBe('mikania-micrantha')
    expect(toAppSpeciesId(' Eichhornia_Crassipes ')).toBe('eichhornia-crassipes')
  })

  it('unions plant habitats and intersects them with the place', () => {
    expect(habitatsForPlants(['mikania-micrantha', 'eichhornia-crassipes'], lookup))
      .toEqual(new Set(['forest_edge_opening', 'water_edge', 'disturbed_built_edge', 'permanent_water']))
    const result = compatibleHabitats(['mikania-micrantha', 'eichhornia-crassipes'], lookup, ['water_edge', 'permanent_water', 'forest_interior', 'cropland'])
    expect([...result].sort()).toEqual(['permanent_water', 'water_edge'])
  })

  it('narrows to one plant and restores on clear', () => {
    const place = ['water_edge', 'permanent_water', 'open_grassland']
    expect([...compatibleHabitats(['eichhornia-crassipes'], lookup, place)].sort()).toEqual(['permanent_water', 'water_edge'])
    expect([...compatibleHabitats(['chromolaena-odorata'], lookup, place)]).toEqual(['open_grassland'])
    expect(compatibleHabitats([...lookup.keys()], lookup, place).size).toBe(3)
  })

  it('treats a plant without a habitat profile as unavailable for filtering', () => {
    expect(compatibleHabitats(['unknown-plant'], lookup, ['water_edge']).size).toBe(0)
  })

  it('keeps every polygon of a visible category, never merging them', () => {
    const shown = visibleFeatures(overlay, new Set<HabitatCategory>(['water_edge']))
    expect(shown.features).toHaveLength(2)
  })

  it('builds the legend only from categories currently visible', () => {
    const shown = visibleFeatures(overlay, new Set<HabitatCategory>(['water_edge', 'permanent_water']))
    expect(legendFor(shown).map((item) => item.label)).toEqual(['Permanent water', 'Water edge'])
  })

  it('lists the watchlist plants that match a selected habitat', () => {
    expect(plantsForHabitat('water_edge', [...lookup.keys()], lookup)).toEqual(['mikania-micrantha', 'eichhornia-crassipes'])
    expect(plantsForHabitat('open_grassland', ['mikania-micrantha'], lookup)).toEqual([])
  })

  it('drops unknown categories instead of failing the overlay', () => {
    const dirty = { ...overlay, features: [...overlay.features, feature('lava_field')] }
    expect(sanitiseOverlay(dirty).features).toHaveLength(4)
  })

  it('drops features with missing geometry, non-polygon geometry, missing properties or prototype-key categories', () => {
    const polygon = feature('water_edge').geometry
    const junk = [
      { type: 'Feature', geometry: null, properties: feature('water_edge').properties },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [101.7, 3.17] }, properties: feature('water_edge').properties },
      { type: 'Feature', geometry: polygon, properties: null },
      feature('toString'),
      feature('constructor'),
    ] as unknown as HabitatOverlay['features']
    expect(sanitiseOverlay({ ...overlay, features: [...junk, feature('water_edge')] }).features).toHaveLength(1)
    expect(sanitiseOverlay({ type: 'FeatureCollection' } as HabitatOverlay).features).toEqual([])
  })

  it('ignores unknown or prototype-key categories listed for a place', () => {
    expect([...compatibleHabitats([...lookup.keys()], lookup, ['lava_field', 'constructor', 'water_edge'])]).toEqual(['water_edge'])
  })

  it('keeps bbox order as [minLon, minLat, maxLon, maxLat] and rejects swapped values', () => {
    expect(bboxToBounds([101.70, 3.17, 101.71, 3.18])).toEqual([[101.70, 3.17], [101.71, 3.18]])
    expect(bboxToBounds([3.17, 101.70, 3.18, 101.71])).toBeNull()
  })
})
