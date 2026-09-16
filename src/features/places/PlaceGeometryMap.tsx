// Small read-only map that draws one place's boundary polygon. Split out from
// PlaceDetailPage because the boundary is a static shape with no interaction,
// so it needs almost none of what ThreatMapPage does - no markers, no filters,
// no click handling, just fit the camera to the geometry and stop.
//
// Uses the same raster basemap as the main map so the two screens look alike.
import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map } from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'

maplibregl.setWorkerUrl(mapLibreWorkerUrl)

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: 'raster',
      tiles: [(import.meta.env.VITE_MAP_TILE_URL as string | undefined)
        ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
}

export function PlaceGeometryMap({ geometry, name }: { geometry: GeoJSON.Geometry; name: string }) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)

  useEffect(() => {
    if (!container.current || map.current) return
    const instance = new maplibregl.Map({
      container: container.current,
      style: STYLE,
      center: [101.68, 3.14],
      zoom: 11,
      interactive: true,
      minZoom: 6,
      maxZoom: 19,
      maxBounds: [[99.3, 0.8], [119.5, 7.5]],
    })
    instance.on('load', () => {
      instance.addSource('place-geometry', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry },
      })
      if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
        instance.addLayer({
          id: 'place-fill',
          type: 'fill',
          source: 'place-geometry',
          paint: { 'fill-color': '#1B7A50', 'fill-opacity': 0.15 },
        })
      }
      instance.addLayer({
        id: 'place-line',
        type: 'line',
        source: 'place-geometry',
        paint: { 'line-color': '#166341', 'line-width': 3 },
      })
      const bounds = geometryBounds(geometry)
      if (bounds) instance.fitBounds(bounds, { padding: 36, maxZoom: 16, duration: 0 })
    })
    map.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      instance.remove()
      map.current = null
    }
  }, [geometry])

  return <div ref={container} className="place-geometry-map" aria-label={`Mapped geometry for ${name}`} />
}

function geometryBounds(geometry: GeoJSON.Geometry): maplibregl.LngLatBounds | null {
  const points: number[][] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value) && value.length >= 2 && value.every((part) => typeof part === 'number')) {
      points.push(value as number[])
    } else if (Array.isArray(value)) value.forEach(visit)
  }
  if ('coordinates' in geometry) visit(geometry.coordinates)
  if (!points.length) return null
  const bounds = new maplibregl.LngLatBounds()
  points.forEach(([lng, lat]) => bounds.extend([lng, lat]))
  return bounds
}
