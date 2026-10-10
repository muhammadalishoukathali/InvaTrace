import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAP_ATTRIBUTION, BASEMAP_STYLE } from '@/features/map/basemap'
import { HABITAT_COLOURS, type HabitatCategory, type HabitatOverlay } from './habitat-data'

maplibregl.setWorkerUrl(`${mapLibreWorkerUrl}?module-mime=1`)

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const colourExpression = ['match', ['get', 'habitat'], ...Object.entries(HABITAT_COLOURS).flat(), '#888888'] as unknown as maplibregl.ExpressionSpecification

/**
 * The mission map: the place boundary plus every compatible habitat polygon.
 * Filtering only swaps the GeoJSON with setData - the map is never rebuilt.
 * Habitat fills sit under the boundary line so the place outline stays
 * readable.
 */
export function GuidedMissionMap({ overlay, boundary, bounds, selected, onSelect, label }: {
  overlay: HabitatOverlay
  boundary: GeoJSON.Geometry | null
  bounds: [[number, number], [number, number]] | null
  selected: HabitatCategory | null
  onSelect?: (habitat: HabitatCategory) => void
  label: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const latest = useRef({ overlay, boundary, bounds, onSelect })
  latest.current = { overlay, boundary, bounds, onSelect }

  useEffect(() => {
    if (!container.current || map.current) return
    let instance: MapLibreMap
    try {
      const initialBounds = latest.current.bounds
      instance = new maplibregl.Map({
        container: container.current,
        style: BASEMAP_STYLE,
        ...(initialBounds ? { bounds: initialBounds, fitBoundsOptions: { padding: 28 } } : { center: [101.69, 3.14], zoom: 11 }),
        minZoom: 4, maxZoom: 19, maxBounds: [[99.3, 0.8], [119.5, 7.5]],
        attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      })
    } catch {
      setUnavailable(true)
      return
    }
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const timeout = window.setTimeout(() => setUnavailable(true), 15_000)
    instance.on('load', () => {
      window.clearTimeout(timeout)
      setUnavailable(false)
      instance.addSource('guided-habitats', { type: 'geojson', data: latest.current.overlay })
      instance.addSource('place-boundary', { type: 'geojson', data: EMPTY })
      instance.addLayer({ id: 'guided-habitats-fill', type: 'fill', source: 'guided-habitats', paint: { 'fill-color': colourExpression, 'fill-opacity': 0.42 } })
      instance.addLayer({ id: 'guided-habitats-line', type: 'line', source: 'guided-habitats', paint: { 'line-color': colourExpression, 'line-width': 1.2, 'line-opacity': 0.9 } })
      instance.addLayer({ id: 'guided-habitats-selected', type: 'line', source: 'guided-habitats', filter: ['==', ['get', 'habitat'], ''], paint: { 'line-color': '#16201B', 'line-width': 2.6 } })
      instance.addLayer({ id: 'place-boundary-line', type: 'line', source: 'place-boundary', paint: { 'line-color': '#12402C', 'line-width': 2.4, 'line-dasharray': [2, 1.2] } })
      instance.on('click', 'guided-habitats-fill', (event) => {
        const habitat = event.features?.[0]?.properties?.habitat
        if (typeof habitat === 'string' && Object.hasOwn(HABITAT_COLOURS, habitat)) latest.current.onSelect?.(habitat as HabitatCategory)
      })
      instance.on('mouseenter', 'guided-habitats-fill', () => { instance.getCanvas().style.cursor = 'pointer' })
      instance.on('mouseleave', 'guided-habitats-fill', () => { instance.getCanvas().style.cursor = '' })
      setReady(true)
    })
    map.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current)
    return () => {
      window.clearTimeout(timeout)
      observer.disconnect()
      instance.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    ;(map.current?.getSource('guided-habitats') as maplibregl.GeoJSONSource | undefined)?.setData(overlay)
  }, [overlay, ready])

  useEffect(() => {
    if (!ready) return
    ;(map.current?.getSource('place-boundary') as maplibregl.GeoJSONSource | undefined)
      ?.setData(boundary ? { type: 'Feature', properties: {}, geometry: boundary } : EMPTY)
  }, [boundary, ready])

  useEffect(() => {
    if (!ready) return
    map.current?.setFilter('guided-habitats-selected', ['==', ['get', 'habitat'], selected ?? ''])
  }, [selected, ready])

  const refit = () => { if (bounds) map.current?.fitBounds(bounds, { padding: 28, duration: 400 }) }

  return (
    <div className="mission-map">
      <div ref={container} className="mission-map__canvas" role="region" aria-label={label} />
      {bounds && <button type="button" className="mission-map__refit" onClick={refit}>Show whole place</button>}
      <a className="mission-map__attribution" href="https://openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" title={BASEMAP_ATTRIBUTION} aria-label={`${BASEMAP_ATTRIBUTION} - data licence`}>© OSM · ESA · JRC</a>
      {unavailable && <p className="mission-map__note" role="status">The map could not be loaded. Use the habitat list below instead.</p>}
    </div>
  )
}
