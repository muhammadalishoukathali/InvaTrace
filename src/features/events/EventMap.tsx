import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map } from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAP_STYLE } from '@/features/map/basemap'
import type { CommunityEvent } from '@/services/api/events'

maplibregl.setWorkerUrl(mapLibreWorkerUrl)
type Point = { latitude: number; longitude: number }
const validPoint = (point: Point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  && point.latitude >= .8 && point.latitude <= 7.5 && point.longitude >= 99.3 && point.longitude <= 119.5

export function EventMap({ events = [], point, onPointChange, onBoundsChange, label = 'Event meeting locations' }: {
  events?: CommunityEvent[]; point?: Point; onPointChange?: (point: Point) => void
  onBoundsChange?: (bbox: string) => void; label?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const latest = useRef({ events, point, onPointChange, onBoundsChange })
  latest.current = { events, point, onPointChange, onBoundsChange }

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
        zoom: 11, minZoom: 4, maxZoom: 19, maxBounds: [[99.3, .8], [119.5, 7.5]],
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
      instance.addSource('event-points', { type: 'geojson', data: points(latest.current.events, latest.current.point) })
      instance.addLayer({ id: 'event-points-circle', type: 'circle', source: 'event-points', paint: {
        'circle-radius': 8, 'circle-color': '#1B7A50', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
      } })
      const located = locatedEvents(latest.current.events)
      if (!latest.current.point && located.length) {
        const bounds = new maplibregl.LngLatBounds()
        located.forEach(event => bounds.extend([event.meetingLongitude, event.meetingLatitude]))
        instance.fitBounds(bounds, { padding: 40, maxZoom: 12, duration: 0 })
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
    source?.setData(points(events, point))
    if (instance && point && validPoint(point) && !instance.getBounds().contains([point.longitude, point.latitude])) {
      instance.jumpTo({ center: [point.longitude, point.latitude] })
    }
  }, [events, point])

  return <div className="event-map-wrap">
    <div ref={container} className="event-map" role="region" aria-label={label} />
    {events.length > locatedEvents(events).length && <p role="status">Some meeting coordinates are unavailable. Refer to the event’s place and meeting notes.</p>}
    {unavailable && <p role="status">The map could not be loaded. Use the event details or meeting coordinates instead.</p>}
  </div>
}
function points(events: CommunityEvent[], point?: Point): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [
    ...locatedEvents(events).map(event => ({ type: 'Feature' as const, properties: { title: event.title },
      geometry: { type: 'Point' as const, coordinates: [event.meetingLongitude, event.meetingLatitude] } })),
    ...(point && validPoint(point) ? [{ type: 'Feature' as const, properties: { title: 'Selected meeting point' },
      geometry: { type: 'Point' as const, coordinates: [point.longitude, point.latitude] } }] : []),
  ] }
}

const locatedEvents = (events: CommunityEvent[]) => events.filter(event => validPoint({ latitude: event.meetingLatitude, longitude: event.meetingLongitude }))
