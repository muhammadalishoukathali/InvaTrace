/**
 * Looks for the nearest named OSM feature within 5km of a point. Hits the
 * public Overpass API for paths/footways/tracks, parks, forests, and woods
 * (checked in that priority order) and returns whichever tagged feature is
 * closest, with a readable name and the geodesic distance.
 *
 * I made failure soft on purpose - if the network drops, it times out, or
 * there's just nothing nearby, the caller just gets null back and the UI
 * falls back to "No named trail, park or forest found nearby" instead of
 * an error. This location context is nice-to-have, not essential, so it
 * should never block someone from saving or publishing a report.
 */

export interface OsmNearestFeature {
  featureType:
    | 'highway_path' | 'highway_footway' | 'highway_track'
    | 'leisure_park' | 'landuse_forest' | 'natural_wood'
  featureName: string
  distanceM: number
  osmId: string
}

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'
const DEFAULT_TIMEOUT_MS = 6_000
const RADIUS_M = 5_000

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

interface OverpassResponse {
  elements: OverpassElement[]
}

function buildQuery(lat: number, lon: number): string {
  // doing this as one combined Overpass query instead of separate requests
  // per tag group - cheaper on the API, and I just sort by priority client-side after
  const around = `around:${RADIUS_M},${lat},${lon}`
  return `
    [out:json][timeout:5];
    (
      way[highway~"^(path|footway|track)$"][name](${around});
      way[leisure=park][name](${around});
      way[landuse=forest][name](${around});
      way[natural=wood][name](${around});
      relation[leisure=park][name](${around});
      relation[landuse=forest][name](${around});
      relation[natural=wood][name](${around});
    );
    out center tags 40;
  `.trim()
}

/** Haversine formula for great-circle distance between two WGS84 points, in metres. */
export function haversineMetres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLon / 2)
  const c = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(c)))
}

function classify(tags: Record<string, string> | undefined): OsmNearestFeature['featureType'] | null {
  if (!tags) return null
  const highway = tags.highway
  if (highway === 'path') return 'highway_path'
  if (highway === 'footway') return 'highway_footway'
  if (highway === 'track') return 'highway_track'
  if (tags.leisure === 'park') return 'leisure_park'
  if (tags.landuse === 'forest') return 'landuse_forest'
  if (tags.natural === 'wood') return 'natural_wood'
  return null
}

// ranked named paths highest since if you're on a trail you probably care
// about the trail's name specifically, then falls back to whatever park,
// forest, or wood polygon contains you
const PRIORITY: Record<OsmNearestFeature['featureType'], number> = {
  highway_path: 1,
  highway_footway: 2,
  highway_track: 3,
  leisure_park: 4,
  landuse_forest: 5,
  natural_wood: 6,
}

export async function fetchNearestOsmFeature(
  lat: number,
  lon: number,
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<OsmNearestFeature | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const composite = signal
    ? mergeSignals(signal, controller.signal)
    : controller.signal
  try {
    const body = new URLSearchParams({ data: buildQuery(lat, lon) })
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: composite,
    })
    if (!response.ok) return null
    const payload = (await response.json()) as OverpassResponse
    if (!payload?.elements?.length) return null

    let best: (OsmNearestFeature & { priorityRank: number }) | null = null
    for (const el of payload.elements) {
      const centre = el.type === 'node'
        ? { lat: el.lat, lon: el.lon }
        : el.center
      if (!centre || centre.lat == null || centre.lon == null) continue
      const featureType = classify(el.tags)
      if (!featureType) continue
      const name = el.tags?.name
      if (!name) continue
      const distanceM = Math.round(
        haversineMetres({ lat, lon }, { lat: centre.lat, lon: centre.lon }),
      )
      const priorityRank = PRIORITY[featureType]
      // closer wins normally, but if two features are roughly the same
      // distance (within 50m) I let the priority class decide instead - a
      // path 10m closer than a park shouldn't necessarily beat the park
      if (
        !best
        || distanceM < best.distanceM - 50
        || (Math.abs(distanceM - best.distanceM) <= 50 && priorityRank < best.priorityRank)
      ) {
        best = { featureType, featureName: name, distanceM, osmId: `${el.type[0]}${el.id}`, priorityRank }
      }
    }
    return best ? { featureType: best.featureType, featureName: best.featureName, distanceM: best.distanceM, osmId: best.osmId } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function mergeSignals(...signals: AbortSignal[]): AbortSignal {
  if (signals.length === 1) return signals[0]
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) { controller.abort(); return controller.signal }
    s.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}
