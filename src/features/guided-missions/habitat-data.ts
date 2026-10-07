// Epic 7 habitat overlays: loading the pre-generated static data and the
// set-intersection rule that decides which habitat polygons a mission shows.
// There is deliberately no scoring, ranking or probability anywhere in here -
// a polygon is either a compatible habitat for a watchlist plant or it is not.
import { useQuery } from '@tanstack/react-query'

/**
 * Versioned data root. When the overlays are rebuilt, publish them under a new
 * folder and change this constant - never overwrite files under the same path,
 * because the service worker caches them by URL.
 */
export const HABITAT_DATASET_VERSION = 'osm-2026-09-14-habitat-v1'
export const HABITAT_DATA_ROOT = `/data/habitat-zones/${HABITAT_DATASET_VERSION}`

export type HabitatCategory =
  | 'forest_edge_opening' | 'open_grassland' | 'disturbed_built_edge' | 'cropland'
  | 'permanent_water' | 'seasonal_water_wetland' | 'water_edge' | 'mangrove' | 'forest_interior'

/** UI colours per category. They identify a category; they are not severity levels. */
export const HABITAT_COLOURS: Record<HabitatCategory, string> = {
  forest_edge_opening: '#49A64B',
  open_grassland: '#D8C44B',
  disturbed_built_edge: '#E67E22',
  cropland: '#9A6B37',
  permanent_water: '#1769AA',
  seasonal_water_wetland: '#48B8B0',
  water_edge: '#4BA3E3',
  mangrove: '#7B4F9D',
  forest_interior: '#174D2B',
}
export const isHabitatCategory = (value: unknown): value is HabitatCategory =>
  typeof value === 'string' && Object.hasOwn(HABITAT_COLOURS, value)

export interface HabitatPlaceEntry {
  place_id: string
  name: string
  place_type: string
  protection_context: string
  bbox: [number, number, number, number]
  area_km2: number
  available_habitats: string[]
  overlay_url: string
  resolution_m: number
}
interface HabitatIndex { dataset_version: string; interpretation: string; places: HabitatPlaceEntry[] }
interface PlantLookup { plants: Array<{ species_id: string; scientific_name: string; habitat_categories: string[] }> }
export interface HabitatRelease {
  created_utc: string
  environmental_sources: string[]
  habitat_categories: Record<string, string>
  limitations: string[]
  osm_release?: { source_timestamp: string; licence: string; licence_url: string }
}
export interface HabitatFeatureProperties { place_id: string; habitat: HabitatCategory; habitat_label: string; resolution_m: number }
export type HabitatOverlay = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, HabitatFeatureProperties>

/**
 * The habitat lookup uses underscore ids (`mikania_micrantha`) while the app's
 * catalogue uses hyphenated ids (`mikania-micrantha`) for the same 32 species.
 * This is a fixed id-format difference, not a name match, so normalise once
 * here and join on species id everywhere else.
 */
export const toAppSpeciesId = (id: string) => id.trim().toLowerCase().replace(/_/g, '-')

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${HABITAT_DATA_ROOT}/${path}`)
  if (!response.ok) throw new Error(`Habitat data ${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

const FOREVER = { staleTime: Infinity, gcTime: 24 * 60 * 60 * 1000, retry: 1 } as const

/** Small manifest: which places have an overlay. Loaded once and cached. */
export function useHabitatIndex() {
  return useQuery({
    queryKey: ['habitat-index', HABITAT_DATASET_VERSION],
    queryFn: async () => {
      const index = await fetchJson<HabitatIndex>('index.json')
      return { ...index, byId: new Map(index.places.map((place) => [place.place_id, place])) }
    },
    ...FOREVER,
  })
}

/** species id (app format) -> compatible habitat categories. */
export function useHabitatLookup() {
  return useQuery({
    queryKey: ['habitat-lookup', HABITAT_DATASET_VERSION],
    queryFn: async () => {
      const lookup = await fetchJson<PlantLookup>('plant_habitat_lookup.json')
      return new Map(lookup.plants.map((plant) => [
        toAppSpeciesId(plant.species_id),
        plant.habitat_categories.filter(isHabitatCategory),
      ]))
    },
    ...FOREVER,
  })
}

export function useHabitatRelease(enabled: boolean) {
  return useQuery({ queryKey: ['habitat-release', HABITAT_DATASET_VERSION], queryFn: () => fetchJson<HabitatRelease>('habitat_overlay_release.json'), enabled, ...FOREVER })
}

/** One place's overlay, fetched only when that mission opens. */
export function useHabitatOverlay(entry: HabitatPlaceEntry | null | undefined) {
  return useQuery({
    queryKey: ['habitat-overlay', HABITAT_DATASET_VERSION, entry?.place_id],
    enabled: Boolean(entry),
    queryFn: async () => sanitiseOverlay(await fetchJson<HabitatOverlay>(entry!.overlay_url)),
    ...FOREVER,
  })
}

/** Drop features with an unknown category or no geometry rather than failing the whole map. */
export function sanitiseOverlay(overlay: HabitatOverlay): HabitatOverlay {
  const features = (overlay.features ?? []).filter((feature) => {
    const ok = feature?.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')
      && isHabitatCategory(feature.properties?.habitat)
    if (!ok && import.meta.env.DEV) console.warn('Ignoring habitat feature with unknown category or geometry', feature?.properties)
    return ok
  })
  return { ...overlay, features }
}

// --- Matching (handover section 8) --------------------------------------

/** Union of the habitat categories of the given watchlist plants. */
export function habitatsForPlants(speciesIds: string[], lookup: Map<string, HabitatCategory[]>): Set<HabitatCategory> {
  return new Set(speciesIds.flatMap((id) => lookup.get(id) ?? []))
}

/** Categories that are both in the place and compatible with the plants. */
export function compatibleHabitats(
  speciesIds: string[],
  lookup: Map<string, HabitatCategory[]>,
  placeHabitats: string[],
): Set<HabitatCategory> {
  const wanted = habitatsForPlants(speciesIds, lookup)
  return new Set(placeHabitats.filter((habitat): habitat is HabitatCategory => isHabitatCategory(habitat) && wanted.has(habitat)))
}

/** Features to draw: every polygon whose category is in the compatible set. Never merged or reduced. */
export function visibleFeatures(overlay: HabitatOverlay, habitats: Set<HabitatCategory>): HabitatOverlay {
  return { ...overlay, features: overlay.features.filter((feature) => habitats.has(feature.properties.habitat)) }
}

/** Watchlist plants whose habitat profile includes the selected category. */
export function plantsForHabitat(habitat: HabitatCategory, speciesIds: string[], lookup: Map<string, HabitatCategory[]>) {
  return speciesIds.filter((id) => lookup.get(id)?.includes(habitat))
}

/** Legend entries for the categories actually present in the visible features, in a stable order. */
export function legendFor(overlay: HabitatOverlay): Array<{ habitat: HabitatCategory; label: string; colour: string }> {
  const seen = new Map<HabitatCategory, string>()
  overlay.features.forEach((feature) => { if (!seen.has(feature.properties.habitat)) seen.set(feature.properties.habitat, feature.properties.habitat_label) })
  return (Object.keys(HABITAT_COLOURS) as HabitatCategory[])
    .filter((habitat) => seen.has(habitat))
    .map((habitat) => ({ habitat, label: seen.get(habitat)!, colour: HABITAT_COLOURS[habitat] }))
}

const normaliseName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function geometryCentre(geometry: GeoJSON.Geometry): [number, number] | null {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') {
      minLon = Math.min(minLon, value[0]); maxLon = Math.max(maxLon, value[0])
      minLat = Math.min(minLat, value[1]); maxLat = Math.max(maxLat, value[1])
      return
    }
    value.forEach(visit)
  }
  if (geometry.type === 'GeometryCollection') geometry.geometries.forEach((part) => visit('coordinates' in part ? part.coordinates : null))
  else visit(geometry.coordinates)
  return Number.isFinite(minLon) ? [(minLon + maxLon) / 2, (minLat + maxLat) / 2] : null
}

/**
 * The overlay entry for a place. Overlays are keyed by the OSM-derived place
 * id; curated featured places carry their own ids, so they fall back to the
 * OSM place with the same name whose bbox contains the featured centre.
 */
export function resolveHabitatEntry(
  byId: Map<string, HabitatPlaceEntry>,
  placeId: string,
  place?: { displayName: string; geometry: GeoJSON.Geometry } | null,
): HabitatPlaceEntry | null {
  const direct = byId.get(placeId)
  if (direct || !place?.geometry) return direct ?? null
  const centre = geometryCentre(place.geometry)
  if (!centre) return null
  const name = normaliseName(place.displayName)
  const pad = 0.005 // about 500 m, as curated centres are approximate
  for (const entry of byId.values()) {
    if (normaliseName(entry.name) !== name) continue
    const [minLon, minLat, maxLon, maxLat] = entry.bbox
    if (centre[0] >= minLon - pad && centre[0] <= maxLon + pad && centre[1] >= minLat - pad && centre[1] <= maxLat + pad) return entry
  }
  return null
}

/** MapLibre bounds from an index bbox. The bbox is [minLon, minLat, maxLon, maxLat]; never swap it. */
export function bboxToBounds(bbox: HabitatPlaceEntry['bbox']): [[number, number], [number, number]] | null {
  const [minLon, minLat, maxLon, maxLat] = bbox
  const valid = [minLon, maxLon].every((value) => Number.isFinite(value) && value >= -180 && value <= 180)
    && [minLat, maxLat].every((value) => Number.isFinite(value) && value >= -90 && value <= 90)
    && minLon <= maxLon && minLat <= maxLat
  return valid ? [[minLon, minLat], [maxLon, maxLat]] : null
}
