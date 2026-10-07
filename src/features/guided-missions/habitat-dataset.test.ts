// Build-time validation of the shipped Epic 7 habitat package (handover 15.1).
// Fails CI if an overlay is missing or structurally invalid rather than
// deploying a partially broken manifest.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { approvedSpeciesDataset } from '@shared/catalogue'
import { HABITAT_DATASET_VERSION, isHabitatCategory, toAppSpeciesId } from './habitat-data'

const root = join(process.cwd(), 'public', 'data', 'habitat-zones', HABITAT_DATASET_VERSION)
const read = <T,>(name: string) => JSON.parse(readFileSync(join(root, name), 'utf8')) as T

describe('habitat dataset package', () => {
  const index = read<{ dataset_version: string; places: Array<{ place_id: string; overlay_url: string; bbox: number[]; available_habitats: string[] }> }>('index.json')
  const lookup = read<{ plants: Array<{ species_id: string; habitat_categories: string[] }> }>('plant_habitat_lookup.json')
  const release = read<{ habitat_categories: Record<string, string> }>('habitat_overlay_release.json')

  it('matches the versioned folder', () => {
    expect(index.dataset_version).toBe(HABITAT_DATASET_VERSION)
  })

  it('maps all 32 plants to known categories and to catalogue species ids', () => {
    const ids = lookup.plants.map((plant) => plant.species_id)
    expect(new Set(ids).size).toBe(32)
    const catalogue = new Set(approvedSpeciesDataset.records.map((record) => record.species_id))
    for (const plant of lookup.plants) {
      expect(catalogue.has(toAppSpeciesId(plant.species_id)), plant.species_id).toBe(true)
      for (const category of plant.habitat_categories) {
        expect(Object.hasOwn(release.habitat_categories, category), category).toBe(true)
        expect(isHabitatCategory(category), category).toBe(true)
      }
    }
  })

  it('indexes unique places whose overlays exist with valid bboxes', () => {
    const ids = index.places.map((place) => place.place_id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(1869)
    for (const place of index.places) {
      expect(existsSync(join(root, place.overlay_url)), place.overlay_url).toBe(true)
      const [minLon, minLat, maxLon, maxLat] = place.bbox
      expect(minLon <= maxLon && minLat <= maxLat && minLon >= 99 && maxLon <= 120 && minLat >= 0 && maxLat <= 8, place.place_id).toBe(true)
    }
    expect(readdirSync(join(root, 'places')).length).toBe(ids.length)
  })

  it('has structurally valid overlay features (sampled)', () => {
    for (const place of index.places.filter((_, i) => i % 75 === 0)) {
      const overlay = read<{ metadata: { place_id: string }; features: Array<{ geometry: { type: string }; properties: Record<string, unknown> }> }>(place.overlay_url)
      expect(overlay.metadata.place_id).toBe(place.place_id)
      for (const feature of overlay.features) {
        expect(['Polygon', 'MultiPolygon']).toContain(feature.geometry.type)
        expect(feature.properties.place_id).toBe(place.place_id)
        expect(isHabitatCategory(feature.properties.habitat)).toBe(true)
        expect(typeof feature.properties.habitat_label).toBe('string')
      }
    }
  })
})
