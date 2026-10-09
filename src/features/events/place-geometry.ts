/**
 * Meeting-point helpers for event places. The API only accepts a meeting point
 * the place polygon covers (or within 750 m of a trail), so the wizard must
 * never suggest a point outside it. A bounding-box centre is not enough: for
 * an L-shaped or crescent reserve it can fall outside the boundary.
 */
export interface LatLng { latitude: number; longitude: number }

type Ring = number[][]

function polygons(geometry: GeoJSON.Geometry): Ring[][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function inRing(x: number, y: number, ring: Ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inPolygons(x: number, y: number, list: Ring[][]) {
  return list.some(([outer, ...holes]) => inRing(x, y, outer) && !holes.some((hole) => inRing(x, y, hole)))
}

function segmentDistance(x: number, y: number, [ax, ay]: number[], [bx, by]: number[]) {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
}

function edgeDistance(x: number, y: number, list: Ring[][]) {
  let best = Infinity
  for (const polygon of list) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) best = Math.min(best, segmentDistance(x, y, ring[i - 1], ring[i]))
    }
  }
  return best
}

/** Whether the point lies inside the place. Trails are left to the API's 750 m buffer. */
export function pointInPlace(geometry: GeoJSON.Geometry | null | undefined, point: LatLng) {
  if (!geometry) return true
  const list = polygons(geometry)
  if (!list.length) return true
  return inPolygons(point.longitude, point.latitude, list)
}

/**
 * A sensible default meeting point: for a trail its middle vertex (always on the
 * line); for an area the inside point furthest from the boundary on a coarse
 * grid, so it sits well within the place rather than on its edge.
 */
export function defaultMeetingPoint(geometry: GeoJSON.Geometry): LatLng | null {
  if (geometry.type === 'LineString' && geometry.coordinates.length) {
    const [longitude, latitude] = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)]
    return { latitude, longitude }
  }
  if (geometry.type === 'MultiLineString' && geometry.coordinates[0]?.length) {
    const line = geometry.coordinates[0]
    const [longitude, latitude] = line[Math.floor(line.length / 2)]
    return { latitude, longitude }
  }
  const list = polygons(geometry)
  const outer = list.flatMap((polygon) => polygon[0] ?? [])
  if (!outer.length) return null
  const xs = outer.map((c) => c[0])
  const ys = outer.map((c) => c[1])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  let best: { x: number; y: number; distance: number } | null = null
  const steps = 24
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const x = minX + ((maxX - minX) * i) / steps
      const y = minY + ((maxY - minY) * j) / steps
      if (!inPolygons(x, y, list)) continue
      const distance = edgeDistance(x, y, list)
      if (!best || distance > best.distance) best = { x, y, distance }
    }
  }
  if (best) return { latitude: best.y, longitude: best.x }
  // A sliver thinner than the grid: fall back to its first vertex, which the
  // polygon covers (boundary points count for ST_Covers).
  return { latitude: outer[0][1], longitude: outer[0][0] }
}
