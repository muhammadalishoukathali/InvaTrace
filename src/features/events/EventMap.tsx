import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map } from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAP_ATTRIBUTION, BASEMAP_STYLE } from '@/features/map/basemap'
import type { CommunityEvent } from '@/services/api/events'

maplibregl.setWorkerUrl(mapLibreWorkerUrl)
type Point = { latitude: number; longitude: number }
const validPoint = (point: Point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  && point.latitude >= .8 && point.latitude <= 7.5 && point.longitude >= 99.3 && point.longitude <= 119.5

// Event markers are violet with a white ring so they never read as a sighting
// marker (green/amber/red/grey) or a place marker (AC 9.1.3).
export const EVENT_MARKER_COLOUR = '#5B3FA0'

export function EventMap({ events = [], point, boundary, onPointChange, onBoundsChange, onSelect, selectedId, label = 'Event meeting locations', className = '' }: {
  events?: CommunityEvent[]; point?: Point; boundary?: GeoJSON.Geometry | null; onPointChange?: (point: Point) => void
  onBoundsChange?: (bbox: string) => void; onSelect?: (eventId: string) => void
  selectedId?: string | null; label?: string; className?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [ready, setReady] = useState(false)
  const latest = useRef({ events, point, onPointChange, onBoundsChange, onSelect, selectedId })
  latest.current = { events, point, onPointChange, onBoundsChange, onSelect, selectedId }

  useEffect(() => {
    if (!container.current || map.current) return
    let instance: Map
    try {
      const initial = latest.current.point
      const located = locatedEvents(latest.current.events)
      const single = located.length === 1 ? located[0] : null
      instance = new maplibregl.Map({
        container: container.current, style: BASEMAP_STYLE,
        center: initial && validPoint(initial) ? [initial.longitude, initial.latitude]
          : single ? [single.meetingLongitude, single.meetingLatitude] : [101.6412, 3.1497],
        // One meeting point needs street-level detail to be findable on the day.
        zoom: initial || single ? 15 : 11, minZoom: 4, maxZoom: 19, maxBounds: [[99.3, .8], [119.5, 7.5]],
        // Same small attribution chip as the threat map; MapLibre's own
        // control auto-expands over the map on phones.
        attributionControl: false,
      })
    } catch {
      setUnavailable(true)
      return
    }
    let loaded = false
    const timeout = window.setTimeout(() => { if (!loaded) setUnavailable(true) }, 15_000)
    instance.on('load', () => {
      loaded = true
      window.clearTimeout(timeout)
      setUnavailable(false)
      instance.addSource('event-boundary', { type: 'geojson', data: EMPTY })
      instance.addLayer({ id: 'event-boundary-fill', type: 'fill', source: 'event-boundary', paint: { 'fill-color': EVENT_MARKER_COLOUR, 'fill-opacity': 0.08 } })
      instance.addLayer({ id: 'event-boundary-line', type: 'line', source: 'event-boundary', paint: { 'line-color': EVENT_MARKER_COLOUR, 'line-width': 2, 'line-dasharray': [2, 1.5] } })
      instance.addSource('event-points', { type: 'geojson', data: points(latest.current.events, latest.current.point, latest.current.selectedId) })
      instance.addLayer({ id: 'event-points-circle', type: 'circle', source: 'event-points', paint: {
        'circle-radius': ['case', ['get', 'selected'], 12, 9],
        'circle-color': EVENT_MARKER_COLOUR,
        'circle-stroke-width': ['case', ['get', 'selected'], 4, 2.5],
        'circle-stroke-color': '#fff',
      } })
      instance.on('click', 'event-points-circle', (event) => {
        const id = event.features?.[0]?.properties?.id
        if (typeof id === 'string' && id) latest.current.onSelect?.(id)
      })
      instance.on('mouseenter', 'event-points-circle', () => { if (latest.current.onSelect) instance.getCanvas().style.cursor = 'pointer' })
      instance.on('mouseleave', 'event-points-circle', () => { instance.getCanvas().style.cursor = '' })
      const located = locatedEvents(latest.current.events)
      if (!latest.current.point && located.length) {
        const bounds = new maplibregl.LngLatBounds()
        located.forEach(event => bounds.extend([event.meetingLongitude, event.meetingLatitude]))
        instance.fitBounds(bounds, { padding: 40, maxZoom: located.length === 1 ? 15 : 12, duration: 0 })
      }
      const publishBounds = () => {
        const bounds = instance.getBounds()
        latest.current.onBoundsChange?.([
          Math.max(99.3, bounds.getWest()), Math.max(.8, bounds.getSouth()),
          Math.min(119.5, bounds.getEast()), Math.min(7.5, bounds.getNorth()),
        ].map(value => value.toFixed(5)).join(','))
      }
      instance.on('moveend', publishBounds)
      publishBounds()
      instance.on('click', event => latest.current.onPointChange?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }))
      if (latest.current.onPointChange) instance.getCanvas().style.cursor = 'crosshair'
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
    const instance = map.current
    const source = instance?.getSource('event-points') as maplibregl.GeoJSONSource | undefined
    source?.setData(points(events, point, selectedId))
    if (instance && point && validPoint(point) && !instance.getBounds().contains([point.longitude, point.latitude])) {
      instance.jumpTo({ center: [point.longitude, point.latitude] })
    }
  }, [events, point, selectedId])

  useEffect(() => {
    const instance = map.current
    if (!ready || !instance) return
    const source = instance.getSource('event-boundary') as maplibregl.GeoJSONSource | undefined
    source?.setData(boundary ? { type: 'Feature', properties: {}, geometry: boundary } : EMPTY)
    const box = boundary ? geometryBounds(boundary) : null
    if (box) instance.fitBounds(box, { padding: 32, maxZoom: 17, duration: 0 })
  }, [boundary, ready])

  return <div className={`event-map-wrap ${className}`}>
    <div className="event-map__frame">
      <div ref={container} className="event-map" role="region" aria-label={label} />
      <a className="event-map__attribution" href="https://openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" title={BASEMAP_ATTRIBUTION} aria-label={`${BASEMAP_ATTRIBUTION} - data licence`}>© OSM</a>
    </div>
    {events.length > locatedEvents(events).length && <p className="event-map__note" role="status">Some meeting coordinates are unavailable. Refer to the event’s place and meeting notes.</p>}
    {unavailable && <p className="event-map__note" role="status">The map could not be loaded. Use the event list and meeting notes instead.</p>}
  </div>
}
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function geometryBounds(geometry: GeoJSON.Geometry): maplibregl.LngLatBounds | null {
  const bounds = new maplibregl.LngLatBounds()
  let found = false
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number' && typeof value[1] === 'number') { bounds.extend([value[0], value[1]]); found = true; return }
    value.forEach(visit)
  }
  if (geometry.type === 'GeometryCollection') geometry.geometries.forEach((item) => visit('coordinates' in item ? item.coordinates : null))
  else visit(geometry.coordinates)
  return found ? bounds : null
}

function points(events: CommunityEvent[], point?: Point, selectedId?: string | null): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [
    ...locatedEvents(events).map(event => ({ type: 'Feature' as const, properties: { id: event.id, title: event.title, selected: event.id === selectedId },
      geometry: { type: 'Point' as const, coordinates: [event.meetingLongitude, event.meetingLatitude] } })),
    ...(point && validPoint(point) ? [{ type: 'Feature' as const, properties: { id: '', title: 'Selected meeting point', selected: true },
      geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] } }] : []),
  ] }
}

const locatedEvents = (events: CommunityEvent[]) => events.filter(event => validPoint({ latitude: event.meetingLatitude, longitude: event.meetingLongitude }))
