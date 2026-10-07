// Build-time validation of the shipped Epic 7 habitat package (handover 15.1).
// Fails CI if an overlay is missing or structurally invalid rather than
// deploying a partially broken manifest.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { approvedSpeciesDataset } from '@shared/catalogue'
import { HABITAT_DATASET_VERSION, isHabitatCategory, resolveHabitatEntry, toAppSpeciesId, type HabitatPlaceEntry } from './habitat-data'

const root = join(process.cwd(), 'public', 'data', 'habitat-zones', HABITAT_DATASET_VERSION)
const read = <T,>(name: string) => JSON.parse(readFileSync(join(root, name), 'utf8')) as T

/** RFC 4122 uuid5 in the URL namespace - the backend's OSM place id formula (app/osm_import.py). */
function osmPlaceId(osmReference: string) {
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex')
  const hash = createHash('sha1').update(namespace).update(`https://www.openstreetmap.org/${osmReference}`).digest().subarray(0, 16)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
type Ring = Array<[number, number]>

describe('habitat dataset package', () => {
  const index = read<{ dataset_version: string; places: Array<{ place_id: string; osm_reference: string; overlay_url: string; bbox: number[]; available_habitats: string[] }> }>('index.json')
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

  it('keys every place by the backend OSM place id (uuid5 of the OSM URL)', () => {
    for (const place of index.places) expect(place.place_id, place.osm_reference).toBe(osmPlaceId(place.osm_reference))
  })

  it('has structurally valid overlays whose categories match the index and stay inside the bbox', () => {
    const tolerance = 1e-4
    for (const place of index.places) {
      const overlay = read<{ metadata: { place_id: string }; features: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> }>(place.overlay_url)
      expect(overlay.metadata.place_id).toBe(place.place_id)
      expect(overlay.features.length, place.place_id).toBeGreaterThan(0)
      const present = new Set<string>()
      for (const feature of overlay.features) {
        expect(['Polygon', 'MultiPolygon']).toContain(feature.geometry.type)
        expect(feature.properties.place_id).toBe(place.place_id)
        expect(isHabitatCategory(feature.properties.habitat)).toBe(true)
        expect(feature.properties.habitat_label).toBe(release.habitat_categories[feature.properties.habitat as string])
        present.add(feature.properties.habitat as string)
        const polygons = (feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates) as Ring[][]
        const [minLon, minLat, maxLon, maxLat] = place.bbox
        for (const ring of polygons.flat()) {
          expect(ring.length, place.place_id).toBeGreaterThanOrEqual(4)
          const inside = ring.every(([lon, lat]) => lon >= minLon - tolerance && lon <= maxLon + tolerance && lat >= minLat - tolerance && lat <= maxLat + tolerance)
          expect(inside, place.place_id).toBe(true)
        }
      }
      expect([...present].sort(), place.place_id).toEqual([...place.available_habitats].sort())
    }
  })
})

describe('featured places resolve to their OSM overlay', () => {
  // Curated rows from backend/app/featured_places_seed.py: random ids, ~250 m boxes.
  const byId = new Map(read<{ places: HabitatPlaceEntry[] }>('index.json').places.map((place) => [place.place_id, place]))
  const box = (lon: number, lat: number): GeoJSON.Polygon => ({
    type: 'Polygon',
    coordinates: [[[lon - 0.00125, lat - 0.00125], [lon + 0.00125, lat - 0.00125], [lon + 0.00125, lat + 0.00125], [lon - 0.00125, lat + 0.00125], [lon - 0.00125, lat - 0.00125]]],
  })
  it.each([
    ['KLCC Park', 101.7135, 3.1573],
    ['Taman Tasik Titiwangsa', 101.7076, 3.1783],
    ['Taman Tugu', 101.6822, 3.1497],
    ['Bukit Kiara Federal Park', 101.6438, 3.1442],
    ['Taman Tasik Permaisuri', 101.7133, 3.0925],
  ])('%s', (name, lon, lat) => {
    const entry = resolveHabitatEntry(byId, 'featured-random-id', { displayName: name, geometry: box(lon, lat) })
    expect(entry?.name).toBe(name)
  })
  it('does not match a same-named place elsewhere or an unknown name', () => {
    expect(resolveHabitatEntry(byId, 'x', { displayName: 'KLCC Park', geometry: box(100.3, 5.4) })).toBeNull()
    expect(resolveHabitatEntry(byId, 'x', { displayName: 'FRIM Kepong', geometry: box(101.6349, 3.2364) })).toBeNull()
    expect(resolveHabitatEntry(byId, 'x', null)).toBeNull()
  })
})
