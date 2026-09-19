// Activity feed for one adopted area: what has been reported inside it lately,
// with a small map showing where.
//
// The map here is a cut-down version of the one in ThreatMapPage - same raster
// basemap and the same manual worker-URL setup, but only the sightings for this
// one area, and no filter panel. I kept it separate rather than trying to reuse
// ThreatMapPage because that page's state is tied to the global map store and
// this screen needs its own camera.
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import * as maplibregl from 'maplibre-gl'
import type { Map, Marker } from 'maplibre-gl'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BASEMAP_STYLE } from '@/features/map/basemap'
import { api } from '@/services/api-client'
import { useOnline } from '@/hooks/useOnline'
import type { AdoptedAreaActivity } from '@/types'
import { approvedSpeciesDataset } from '@shared/catalogue'
import './adopted-areas.css'

maplibregl.setWorkerUrl(mapLibreWorkerUrl)

export function AdoptedAreaActivityPage() {
  const { adoptionId } = useParams()
  const online = useOnline()
  const [params, setParams] = useSearchParams()
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)
  const markers = useRef<Marker[]>([])
  const concentrationMarkers = useRef<Marker[]>([])
  const [mapReady, setMapReady] = useState(false)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [showConcentrations, setShowConcentrations] = useState(true)
  const query = useQuery({
    queryKey: ['adopted-area-activity', adoptionId, params.toString()],
    queryFn: () => api<AdoptedAreaActivity>(
      `/api/v1/adopted-areas/${adoptionId}/activity?${params.toString()}`,
    ),
    enabled: Boolean(adoptionId) && online,
  })

  useEffect(() => {
    if (!container.current || map.current) return
    const instance = new maplibregl.Map({
      container: container.current,
      style: BASEMAP_STYLE,
      center: [101.68, 3.14],
      zoom: 12,
      minZoom: 6,
      maxZoom: 19,
      maxBounds: [[99.3, 0.8], [119.5, 7.5]],
    })
    instance.on('load', () => setMapReady(true))
    map.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      instance.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!map.current || !mapReady || !query.data) return
    const instance = map.current
    if (instance.getLayer('adopted-boundary-fill')) instance.removeLayer('adopted-boundary-fill')
    if (instance.getLayer('adopted-boundary-line')) instance.removeLayer('adopted-boundary-line')
    if (instance.getSource('adopted-boundary')) instance.removeSource('adopted-boundary')
    instance.addSource('adopted-boundary', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: query.data.geometry },
    })
    if (query.data.geometry.type === 'Polygon' || query.data.geometry.type === 'MultiPolygon') {
      instance.addLayer({
        id: 'adopted-boundary-fill',
        type: 'fill',
        source: 'adopted-boundary',
        paint: { 'fill-color': '#1B7A50', 'fill-opacity': 0.12 },
      })
    }
    instance.addLayer({
      id: 'adopted-boundary-line',
      type: 'line',
      source: 'adopted-boundary',
      paint: { 'line-color': '#166341', 'line-width': 3 },
    })
    const bounds = geometryBounds(query.data.geometry)
    if (bounds) instance.fitBounds(bounds, { padding: 54, maxZoom: 16, duration: 0 })
    markers.current.forEach((marker) => marker.remove())
    markers.current = query.data.markers.map((marker) => {
      const element = document.createElement('button')
      element.type = 'button'
      element.className = `activity-marker activity-marker--${marker.status}`
      element.setAttribute(
        'aria-label',
        `${marker.scientificName}; ${marker.communityLabel}; ${marker.status}; ${formatDate(marker.statusDate)}`,
      )
      element.addEventListener('click', () => setSelectedMarkerId(marker.sightingId))
      return new maplibregl.Marker({ element })
        .setLngLat([marker.longitude, marker.latitude])
        .addTo(instance)
    })
  }, [mapReady, query.data])

  useEffect(() => {
    if (!map.current || !mapReady || !query.data) return
    concentrationMarkers.current.forEach((marker) => marker.remove())
    concentrationMarkers.current = []
    if (!showConcentrations) return
    concentrationMarkers.current = query.data.concentrations.map((concentration) => {
      const element = document.createElement('div')
      element.className = 'activity-concentration'
      element.textContent = String(concentration.reportCount)
      element.setAttribute(
        'aria-label',
        `Recent reporting concentration: ${concentration.reportCount} active reports`,
      )
      return new maplibregl.Marker({ element })
        .setLngLat([concentration.longitude, concentration.latitude])
        .addTo(map.current!)
    })
  }, [mapReady, query.data, showConcentrations])

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  const selectedMarker = query.data?.markers.find((marker) => marker.sightingId === selectedMarkerId)

  if (!online) return (
    <div className="areas-state" role="status">
      The current activity map needs a connection. Your monitoring bookmark remains saved.
      {' '}<Link to="/catalogue">Open offline catalogue</Link>
    </div>
  )
  if (query.isError) return <div className="areas-state" role="alert">Activity could not be loaded.</div>
  return (
    <section className="activity-page">
      <div className="activity-page__summary">
        <Link to="/adopted-areas">Back to monitoring areas</Link>
        <h2>{query.data?.name ?? 'Community activity'}</h2>
        <p>Community monitoring activity · geometry v{query.data?.geometryVersion ?? '—'}</p>
        <div className="activity-filters" aria-label="Activity filters">
          <label>Plant
            <select value={params.get('species_id') ?? ''} onChange={(event) => setFilter('species_id', event.target.value)}>
              <option value="">All approved plants</option>
              {approvedSpeciesDataset.records.map((record) => (
                <option key={record.species_id} value={record.species_id}>{record.scientific_name}</option>
              ))}
            </select>
          </label>
          <label>Status
            <select value={params.get('status') ?? ''} onChange={(event) => setFilter('status', event.target.value)}>
              <option value="">All statuses</option>
              <option value="screened">Active</option>
              <option value="removal_reported">Removal reported</option>
            </select>
          </label>
          <label>Period
            <select value={params.get('period') ?? 'all'} onChange={(event) => setFilter('period', event.target.value)}>
              <option value="all">All time</option>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
            </select>
          </label>
          <button type="button" onClick={() => setParams({})}>Clear filters</button>
          <label className="activity-layer-toggle">
            <input
              type="checkbox"
              checked={showConcentrations}
              onChange={(event) => setShowConcentrations(event.target.checked)}
            />
            Recent reporting concentrations
          </label>
        </div>
        {query.data && (
          <div className="activity-facts">
            <p><strong>{query.data.filteredCount}</strong> reports match these filters.</p>
            <p>
              <strong>{query.data.concentrationCount}</strong> active reports are in concentrations
              of at least three reports within 250 m during the last 30 days.
            </p>
            <p>
              Raw report counts {query.data.comparison.direction}: {query.data.comparison.recent0To29Days}
              {' '}in days 0–29 versus {query.data.comparison.prior30To59Days} in days 30–59.
            </p>
          </div>
        )}
        {selectedMarker && (
          <section className="activity-selection" aria-live="polite">
            <div>
              <h3><i>{selectedMarker.scientificName}</i></h3>
              <button type="button" onClick={() => setSelectedMarkerId(null)} aria-label="Close report details">×</button>
            </div>
            <p>{selectedMarker.communityLabel}</p>
            <dl>
              <div><dt>Observed</dt><dd>{formatDate(selectedMarker.observationDate)}</dd></div>
              <div><dt>Status</dt><dd>{selectedMarker.status === 'screened' ? 'Active' : 'Removal reported'}</dd></div>
              <div><dt>Status date</dt><dd>{formatDate(selectedMarker.statusDate)}</dd></div>
            </dl>
          </section>
        )}
      </div>
      <div className="activity-page__map-wrap">
        <div ref={container} className="activity-page__map" aria-label="Community activity map" />
        {query.isLoading && <div className="activity-page__overlay" role="status">Loading activity…</div>}
        {query.data?.emptyMessage && <div className="activity-page__overlay">{query.data.emptyMessage}</div>}
      </div>
    </section>
  )
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

const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
  .format(new Date(value))
