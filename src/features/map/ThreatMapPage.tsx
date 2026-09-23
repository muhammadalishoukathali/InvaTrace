/**
 * This is the main map screen at `/map`. After a user scans a plant (or if
 * they just want to browse), they end up here and can see every community
 * report near them. Honestly this was one of the trickier pages to build
 * because we had to juggle the map library, the filter panel and the
 * paginated fetch all together.
 *
 * We went with MapLibre GL instead of Google Maps because it's free and
 * works with any tile source - matters for the FYP because we don't have
 * a Google billing account set up. The whole thing is capped to Malaysia
 * bounds so users can't wander off to another country by accident.
 *
 * Rough flow: MapFilters.tsx writes the species/status/risk/search choices
 * into map-view-store.ts, and this page reads that store to fetch and
 * filter sightings and rebuild the markers. MapLegend.tsx floats on top of
 * the map to explain what the pin colours mean. When someone taps a pin
 * (or a row in the screen-reader list below the map), we call `select()`
 * on the store and SightingDetailsSheet.tsx picks that up to open the
 * details. A `?sighting=` query param or a "My Reports" nav state can
 * also drive the initial camera position - see map-location-link.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import * as maplibregl from 'maplibre-gl'
import type { Map, Marker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

import { api } from '@/services/api-client'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { useMapView as useMapStore } from '@/features/map/map-view-store'
import type { PlaceMapFeature, PlaceMapProperties, PlaceMapResponse, Sighting } from '@/types'
import { SightingDetailsSheet } from './SightingDetailsSheet'
import { MapLegend } from './MapLegend'
import { Icon } from '@/components/Icon'
import { parseMapLocationTarget, type MapLocationTarget } from './map-location-link'
import { PLACE_ICONS, PLACE_TYPES, formatPlaceType, loadSvgImage } from './place-icons'
import { BASEMAP_ATTRIBUTION, BASEMAP_FONT, BASEMAP_STYLE } from './basemap'

// Point MapLibre at its worker file ourselves. If we don't, it tries to
// guess a URL that sits next to Vite's optimized dep file in dev, and the
// worker isn't actually there - the map just silently doesn't paint. Doing
// the ?url import means it works the same way in dev and prod.
maplibregl.setWorkerUrl(mapLibreWorkerUrl)

const CENTRE: [number, number] = [101.6412, 3.1497]  // Bukit Kiara starting point.
const INITIAL_ZOOM = 13
const INITIAL_ZOOM_MOBILE = 13.5

// Approximate Malaysia boundary used to limit map panning.
const MY_BOUNDS: [[number, number], [number, number]] = [
  [99.3, 0.8],   // South-west corner.
  [119.5, 7.5],  // North-east corner.
]

const PLACE_SOURCE_ID = 'mapped-places'
const PLACE_LAYER_IDS = [
  'place-clusters',
  'place-cluster-count',
  'place-points-fallback',
  'place-points',
] as const
const EMPTY_PLACES: GeoJSON.FeatureCollection<GeoJSON.Point, PlaceMapProperties> = {
  type: 'FeatureCollection',
  features: [],
}

// Selecting a place eases the map, which starts another debounced (300 ms)
// /places/map request; the list is rebuilt again when that lands. The restore
// has to stay armed across both rebuilds, so this covers the debounce, the
// request and its render with room to spare. It is only ever allowed to move
// focus off <body>, so a generous window cannot fight the user.
const PLACE_FOCUS_RESTORE_WINDOW_MS = 2_500

export function ThreatMapPage() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<Map | null>(null)
  const markers = useRef<Marker[]>([])
  const recordLocationMarker = useRef<Marker | null>(null)
  const latestVisibleSightings = useRef<Sighting[]>([])
  const reportsHaveLoaded = useRef(false)
  const locationFailed = useRef(false)
  const initialViewApplied = useRef(false)
  const targetSightingId = useRef<string | null>(null)
  const fitReportsFallback = useRef<(() => void) | null>(null)
  const placeRequestTimer = useRef<number | null>(null)
  const placeRequestSequence = useRef(0)
  const loadVisiblePlaces = useRef<(target: Map) => void>(() => undefined)
  const placeReturnFocus = useRef<HTMLElement | null>(null)
  const placeSuppressFocusRestore = useRef(false)
  // Teardown for an in-flight focus restore: disconnects the observer and
  // clears the deadline. Null when no restore is pending.
  const placeFocusCleanup = useRef<(() => void) | null>(null)
  const placePreviewRef = useRef<HTMLElement>(null)
  const isDesktop = useIsDesktop()
  const routeLocation = useLocation()
  const [searchParams] = useSearchParams()
  const requestedSightingId = searchParams.get('sighting')
  const requestedLocation = useMemo(
    () => parseMapLocationTarget(routeLocation.state),
    [routeLocation.state],
  )
  targetSightingId.current = requestedSightingId
  const { species, statuses, risks, search, select, clearFilters } = useMapStore()
  const [locationNotice, setLocationNotice] = useState<{
    tone: 'pending' | 'success' | 'error'
    text: string
  } | null>(null)
  const [recordDetailsOpen, setRecordDetailsOpen] = useState(false)
  const [showPlaces, setShowPlaces] = useState(true)
  const showPlacesRef = useRef(showPlaces)
  const [placeData, setPlaceData] = useState<PlaceMapResponse>({
    type: 'FeatureCollection',
    features: [],
    truncated: false,
    maxResults: 2_000,
  })
  const [placesLoading, setPlacesLoading] = useState(false)
  const [placesError, setPlacesError] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState<PlaceMapProperties | null>(null)

  showPlacesRef.current = showPlaces
  loadVisiblePlaces.current = (target) => {
    if (!showPlacesRef.current || !target.getSource(PLACE_SOURCE_ID)) return
    if (placeRequestTimer.current !== null) window.clearTimeout(placeRequestTimer.current)
    placeRequestTimer.current = window.setTimeout(() => {
      const bounds = target.getBounds()
      const params = new URLSearchParams({
        min_lon: Math.max(MY_BOUNDS[0][0], bounds.getWest()).toFixed(6),
        min_lat: Math.max(MY_BOUNDS[0][1], bounds.getSouth()).toFixed(6),
        max_lon: Math.min(MY_BOUNDS[1][0], bounds.getEast()).toFixed(6),
        max_lat: Math.min(MY_BOUNDS[1][1], bounds.getNorth()).toFixed(6),
      })
      const sequence = ++placeRequestSequence.current
      setPlacesLoading(true)
      setPlacesError(false)
      void api<PlaceMapResponse>(`/api/v1/places/map?${params}`).then((response) => {
        if (sequence === placeRequestSequence.current) setPlaceData(response)
      }).catch(() => {
        if (sequence === placeRequestSequence.current) setPlacesError(true)
      }).finally(() => {
        if (sequence === placeRequestSequence.current) setPlacesLoading(false)
      })
    }, 300)
  }

  // Dispose any in-flight restore if the map unmounts mid-flight, so the
  // observer and its deadline do not outlive the page.
  useEffect(() => () => { placeFocusCleanup.current?.() }, [])

  useEffect(() => {
    if (!selectedPlace) return
    const previous = placeReturnFocus.current
    const closingPlaceId = selectedPlace.placeId
    const frame = window.requestAnimationFrame(() => placePreviewRef.current?.focus())
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedPlace(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
      // The user may have clicked "View plants recorded nearby", which
      // starts a route change. In that case we must not steal focus
      // back to the map - React Router will focus the new route's
      // landmark. `placeSuppressFocusRestore` is set true only in that
      // branch.
      if (placeSuppressFocusRestore.current) {
        placeSuppressFocusRestore.current = false
        placeReturnFocus.current = null
        return
      }
      // Watch the DOM for the button coming back, rather than guessing when it
      // will. The accessible place list is rebuilt whenever an in-flight
      // /places/map response lands, so the button this focus is owed to may not
      // exist for several frames. Earlier attempts hung the restore off
      // animation frames and then off React commits; both left focus on <body>
      // when the timing did not line up, which is silent for a sighted user and
      // total for a keyboard one.
      //
      // A MutationObserver fires when the node actually appears, whatever
      // caused the render, so there is no timing to get wrong.
      placeFocusCleanup.current?.()
      const restoreTarget = (): HTMLElement | null =>
        document.querySelector<HTMLElement>(`[data-place-id="${closingPlaceId}"]`)

      const focusTarget = (target: HTMLElement | null) => {
        if (target && document.activeElement !== target) {
          target.focus({ preventScroll: true })
        }
      }

      // Keep watching until the window closes rather than stopping at the
      // first success. Selecting a place calls map.easeTo, which moves the
      // viewport and kicks off another debounced /places/map request, so the
      // list is typically rebuilt once more AFTER focus has been restored. An
      // earlier version disconnected on the first hit, the replacement render
      // threw away the focused node, and focus fell back to <body> with
      // nothing left watching - which is exactly what CI kept reporting.
      //
      // Only ever re-focus out of <body>: anywhere else means the user moved
      // focus themselves and it is not ours to take back.
      const attempt = (): void => {
        const active = document.activeElement
        if (active !== null && active !== document.body) return
        focusTarget(restoreTarget())
      }

      const settle = () => {
        placeFocusCleanup.current?.()
        placeReturnFocus.current = null
      }

      attempt()
      {
        const observer = new MutationObserver(attempt)
        observer.observe(document.body, { childList: true, subtree: true })
        const deadline = window.setTimeout(() => {
          // Last resort: land somewhere deliberate rather than leaving focus
          // on <body>, which for a keyboard user is no position at all.
          const active = document.activeElement
          if (active === null || active === document.body) {
            const canvas = map.current?.getCanvas()
            focusTarget(
              restoreTarget()
              ?? (previous?.isConnected ? previous : null)
              ?? (canvas?.isConnected ? canvas : null)
              ?? document.querySelector<HTMLElement>('.map-places-toggle'),
            )
          }
          settle()
        }, PLACE_FOCUS_RESTORE_WINDOW_MS)
        placeFocusCleanup.current = () => {
          observer.disconnect()
          window.clearTimeout(deadline)
          placeFocusCleanup.current = null
        }
      }
    }
  }, [selectedPlace])

  // When we successfully recenter the user, the toast is really just a
  // quick "yep, done" - no reason to leave it stuck on screen. Errors
  // though should stay put until the user dismisses them, because the
  // fallback view needs explaining (otherwise they'll wonder why the map
  // opened somewhere random).
  useEffect(() => {
    if (locationNotice?.tone !== 'success') return
    const timer = window.setTimeout(() => {
      setLocationNotice((current) => current?.tone === 'success' ? null : current)
    }, 3_500)
    return () => window.clearTimeout(timer)
  }, [locationNotice])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sightings', species, statuses, risks, search],
    queryFn: () => {
      const params = new URLSearchParams()
      species.forEach((value) => params.append('species', value))
      statuses.forEach((value) => params.append('status', value))
      risks.forEach((value) => params.append('risk', value))
      if (search.trim()) params.set('q', search.trim())
      const query = params.toString()
      return api<{ items: Sighting[] }>(`/api/v1/sightings${query ? `?${query}` : ''}`)
    },
    staleTime: 60_000,
    refetchOnMount: 'always',
    refetchInterval: 15_000,
  })

  useEffect(() => {
    if (!requestedSightingId) return
    clearFilters()
  }, [clearFilters, requestedSightingId])

  // Only ever create one MapLibre instance for this page, and clean it up
  // when the page unmounts. If we let it re-init on every render we'd leak
  // canvas handles like crazy - found that out the hard way during dev.
  useEffect(() => {
    if (!container.current || map.current) return
    const m = new maplibregl.Map({
      container: container.current,
      style: BASEMAP_STYLE,
      center: CENTRE,
      zoom: isDesktop ? INITIAL_ZOOM : INITIAL_ZOOM_MOBILE,
      minZoom: 6,
      maxZoom: 19,
      maxBounds: MY_BOUNDS,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,          // Dragging should move the map, not rotate it.
      touchZoomRotate: true,
      touchPitch: false,
    })
    // We roll our own attribution chip (see MapAttribution below) rather
    // than using MapLibre's built-in AttributionControl. The default one
    // auto-expands on load and ends up sitting right on top of the scan
    // button on mobile, which was really annoying during pilot testing -
    // a plain link is more predictable and still credits OSM properly.
    m.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right')
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 8_000, maximumAge: 300_000 },
      showUserLocation: true, trackUserLocation: false,
    })
    m.addControl(geolocate, 'top-right')
    const showReportsFallback = (text: string) => {
      locationFailed.current = true
      fitReportsFallback.current?.()
      setLocationNotice({ tone: 'error', text })
    }
    geolocate.on('geolocate', () => {
      initialViewApplied.current = true
      setLocationNotice({ tone: 'success', text: 'Map centred on your location' })
    })
    geolocate.on('error', () => {
      showReportsFallback('Your location is unavailable, so the map is showing the visible community reports instead.')
    })
    geolocate.on('outofmaxbounds', () => {
      showReportsFallback('Your location is outside the current Malaysia map area, so the visible community reports are shown instead.')
    })
    const locationButton = container.current.querySelector<HTMLButtonElement>('.maplibregl-ctrl-geolocate')
    const onLocationRequest = () => {
      setLocationNotice({ tone: 'pending', text: 'Finding your location…' })
    }
    locationButton?.addEventListener('click', onLocationRequest)
    map.current = m
    if (import.meta.env.DEV) (window as unknown as { __map?: Map }).__map = m

    fitReportsFallback.current = () => {
      if (initialViewApplied.current || !reportsHaveLoaded.current) return
      const visible = latestVisibleSightings.current
      if (visible.length === 0) {
        m.jumpTo({ center: CENTRE, zoom: isDesktop ? INITIAL_ZOOM : INITIAL_ZOOM_MOBILE })
        initialViewApplied.current = true
        return
      }

      if (visible.length === 1) {
        const only = visible[0]
        m.easeTo({
          center: [only.location.lng, only.location.lat],
          zoom: isDesktop ? 14 : 14.5,
          duration: 650,
        })
        initialViewApplied.current = true
        return
      }

      const bounds = new maplibregl.LngLatBounds()
      visible.forEach((sighting) => bounds.extend([sighting.location.lng, sighting.location.lat]))
      m.fitBounds(bounds, {
        padding: isDesktop ? 88 : 54,
        maxZoom: isDesktop ? 14 : 14.5,
        duration: 650,
      })
      initialViewApplied.current = true
    }

    // Bit of a MapLibre v6 quirk: sometimes it parses the style before the
    // container has settled to its real size, and then it doesn't request
    // any tiles at all - you get a blank map. Forcing a resize and a jumpTo
    // once `style.load` fires nudges it to recompute what's visible.
    let locationReadyTimer: number | undefined
    const schedulePlaces = () => loadVisiblePlaces.current(m)
    m.once('style.load', () => {
      m.resize()
      // Decode the four local SVG icons in the browser before adding them
      // to MapLibre's sprite. MapLibre's URL loader only guarantees raster
      // image formats, so passing SVG URLs to it can leave every individual
      // place marker invisible in production.
      const loadIcons = PLACE_TYPES.map((placeType) => {
        const spec = PLACE_ICONS[placeType]
        return loadSvgImage(spec.svg).then((image) => {
          if (!m.hasImage(spec.id)) m.addImage(spec.id, image, { pixelRatio: 1 })
        })
      })
      m.addSource(PLACE_SOURCE_ID, {
        type: 'geojson',
        data: EMPTY_PLACES,
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 52,
      })
      m.addLayer({
        id: 'place-clusters',
        type: 'circle',
        source: PLACE_SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#164E3A',
          'circle-radius': ['step', ['get', 'point_count'], 17, 30, 22, 100, 28],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2,
        },
      })
      m.addLayer({
        id: 'place-cluster-count',
        type: 'symbol',
        source: PLACE_SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': BASEMAP_FONT, 'text-size': 12 },
        paint: { 'text-color': '#FFFFFF' },
      })
      // A coloured circle remains underneath each icon. Besides increasing
      // the practical touch target, it keeps places visible and clickable if
      // a browser ever fails to decode one of the bundled SVGs.
      m.addLayer({
        id: 'place-points-fallback',
        type: 'circle',
        source: PLACE_SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['match', ['get', 'placeType'],
            'park', PLACE_ICONS.park.fill,
            'forest', PLACE_ICONS.forest.fill,
            'wood', PLACE_ICONS.wood.fill,
            'trail', PLACE_ICONS.trail.fill,
            '#164E3A'],
          'circle-radius': 15,
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 2,
        },
      })
      // Symbol layers reuse MapLibre's sprite atlas, so we do not spawn
      // thousands of DOM markers even at Malaysia-wide zoom.
      const addSymbolLayer = () => {
        if (map.current !== m || m.getLayer('place-points')) return
        m.addLayer({
          id: 'place-points',
          type: 'symbol',
          source: PLACE_SOURCE_ID,
          filter: ['!', ['has', 'point_count']],
          layout: {
            'icon-image': ['match', ['get', 'placeType'],
              'park', PLACE_ICONS.park.id,
              'forest', PLACE_ICONS.forest.id,
              'wood', PLACE_ICONS.wood.id,
              'trail', PLACE_ICONS.trail.id,
              PLACE_ICONS.trail.id],
            // 40x40 source at pixelRatio:1 renders at 40 CSS px; slight
            // downscale keeps the icon compact while still giving the
            // ~40 px practical touch target required by handover §5.
            'icon-size': 0.85,
            'icon-allow-overlap': false,
            'icon-ignore-placement': false,
            'icon-anchor': 'center',
            'symbol-sort-key': ['match', ['get', 'placeType'],
              'park', 1, 'forest', 2, 'wood', 3, 'trail', 4, 5],
          },
        })
        PLACE_LAYER_IDS.forEach((layerId) => {
          if (m.getLayer(layerId)) {
            m.setLayoutProperty(layerId, 'visibility', showPlacesRef.current ? 'visible' : 'none')
          }
        })
      }
      void Promise.allSettled(loadIcons).then((results) => {
        const failedCount = results.filter((result) => result.status === 'rejected').length
        if (failedCount > 0) {
          console.warn(`[map] ${failedCount} place icon(s) could not load; using coloured markers.`)
          return
        }
        addSymbolLayer()
      })
      schedulePlaces()
      if (targetSightingId.current || requestedLocation) return
      m.jumpTo({ center: CENTRE, zoom: isDesktop ? INITIAL_ZOOM : INITIAL_ZOOM_MOBILE })
      setLocationNotice({ tone: 'pending', text: 'Finding your location…' })
      let checks = 0
      const triggerWhenReady = () => {
        const button = container.current?.querySelector<HTMLButtonElement>('.maplibregl-ctrl-geolocate')
        if (button && !button.disabled) {
          geolocate.trigger()
          return
        }
        checks += 1
        if (checks < 20) {
          locationReadyTimer = window.setTimeout(triggerWhenReady, 100)
          return
        }
        showReportsFallback('Location access is not available in this browser, so the visible community reports are shown instead.')
      }
      triggerWhenReady()
    })
    m.on('moveend', schedulePlaces)
    m.on('click', 'place-clusters', (event) => {
      const feature = event.features?.[0]
      const clusterId = Number(feature?.properties?.cluster_id)
      const coordinates = feature?.geometry.type === 'Point' ? feature.geometry.coordinates : null
      const source = m.getSource(PLACE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
      if (!source || !coordinates || !Number.isFinite(clusterId)) return
      void source.getClusterExpansionZoom(clusterId).then((zoom) => {
        m.easeTo({ center: coordinates as [number, number], zoom })
      })
    })
    // Bind to the always-present fallback layer. It sits below the icon but
    // remains queryable, so the same interaction works whether SVG icons load
    // successfully or the browser falls back to coloured circles.
    m.on('click', 'place-points-fallback', (event) => {
      const properties = event.features?.[0]?.properties as PlaceMapProperties | undefined
      if (!properties?.placeId) return
      placeReturnFocus.current = m.getCanvas()
      setSelectedPlace(properties)
    })
    PLACE_LAYER_IDS.forEach((layerId) => {
      m.on('mouseenter', layerId, () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', layerId, () => { m.getCanvas().style.cursor = '' })
    })

    // The app shell can change size after the map mounts (e.g. sidebar
    // opens on desktop). ResizeObserver just keeps the canvas glued to
    // whatever the container is doing.
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(container.current)

    return () => {
      locationButton?.removeEventListener('click', onLocationRequest)
      if (locationReadyTimer !== undefined) window.clearTimeout(locationReadyTimer)
      if (placeRequestTimer.current !== null) window.clearTimeout(placeRequestTimer.current)
      m.off('moveend', schedulePlaces)
      ro.disconnect()
      fitReportsFallback.current = null
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const currentMap = map.current
    const source = currentMap?.getSource(PLACE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    if (source) source.setData(placeData)
  }, [placeData])

  useEffect(() => {
    showPlacesRef.current = showPlaces
    const currentMap = map.current
    if (!currentMap?.getSource(PLACE_SOURCE_ID)) return
    PLACE_LAYER_IDS.forEach((layerId) => {
      if (currentMap.getLayer(layerId)) {
        currentMap.setLayoutProperty(layerId, 'visibility', showPlaces ? 'visible' : 'none')
      }
    })
    if (showPlaces) loadVisiblePlaces.current(currentMap)
    else setSelectedPlace(null)
  }, [showPlaces])

  // When someone comes here via a "My Reports" link they might be pointing
  // at a private scan or a draft report that hasn't actually been published
  // as a public sighting yet. So we draw its marker separately from the API
  // markers - that way a filter change or refetch can't wipe it off.
  useEffect(() => {
    if (!map.current) return
    setRecordDetailsOpen(false)
    recordLocationMarker.current?.remove()
    recordLocationMarker.current = null
    if (!requestedLocation) return

    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'map-record-location-marker'
    el.setAttribute('aria-label', `Open details for ${requestedLocation.label}`)
    el.title = requestedLocation.label
    el.addEventListener('click', () => setRecordDetailsOpen(true))
    const pin = document.createElement('div')
    pin.className = 'map-record-location-pin'
    el.append(pin)
    recordLocationMarker.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([requestedLocation.point.lng, requestedLocation.point.lat])
      .addTo(map.current)
    initialViewApplied.current = true
    map.current.easeTo({
      center: [requestedLocation.point.lng, requestedLocation.point.lat],
      zoom: isDesktop ? 16 : 16.5,
      duration: 650,
    })
    setLocationNotice({ tone: 'success', text: `Showing ${requestedLocation.label}` })

    return () => {
      recordLocationMarker.current?.remove()
      recordLocationMarker.current = null
    }
  }, [requestedLocation, isDesktop])

  // Whenever the data or filter set changes we blow away the old markers
  // and rebuild the whole lot. Not the most efficient thing in the world
  // but the pin count is small enough that it's fine, and it saved us
  // writing a diff routine.
  useEffect(() => {
    if (!map.current || !data) return

    markers.current.forEach((m) => m.remove())
    markers.current = []

    const q = search.trim().toLowerCase()
    const filtered = data.items.filter((s) => {
      if (species.length && !species.includes(s.speciesId)) return false
      if (statuses.length && !statuses.includes(s.status)) return false
      if (risks.length && !risks.includes(s.risk)) return false
      if (q && !s.speciesName.toLowerCase().includes(q) && !s.latinName.toLowerCase().includes(q)) return false
      return true
    })
    latestVisibleSightings.current = filtered
    reportsHaveLoaded.current = true

    for (const s of filtered) {
      const el = pinElement(s)
      el.addEventListener('click', () => select(s.id))
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([s.location.lng, s.location.lat])
        .addTo(map.current!)
      markers.current.push(marker)
    }

    // If we got here from a notification tap or a "My Reports" link, the
    // marker has to actually be on the map before we can select it and
    // fly the camera - that's why this bit lives at the end of the
    // rebuild, not up top.
    if (requestedSightingId) {
      const requested = filtered.find((sighting) => sighting.id === requestedSightingId)
      if (requested) {
        initialViewApplied.current = true
        select(requested.id)
        map.current.easeTo({
          center: [requested.location.lng, requested.location.lat],
          zoom: isDesktop ? 16 : 16.5,
          duration: 650,
        })
      }
    }

    if (locationFailed.current) fitReportsFallback.current?.()
  }, [data, species, statuses, risks, search, select, requestedSightingId, isDesktop])

  const filtered = data
    ? data.items.filter((s) => {
        const q = search.trim().toLowerCase()
        if (species.length && !species.includes(s.speciesId)) return false
        if (statuses.length && !statuses.includes(s.status)) return false
        if (risks.length && !risks.includes(s.risk)) return false
        if (q && !s.speciesName.toLowerCase().includes(q) && !s.latinName.toLowerCase().includes(q)) return false
        return true
      })
    : []
  // One of the ACs (4.2.3) asked us to show how many reports are actually
  // being shown after filters are applied. I kept the "filters active"
  // count separate from the "reports shown" count on purpose - during
  // pilot testing someone read "3" and thought there were 3 reports when
  // it was actually the number of active filters. Confusing.
  const filtersActive = species.length + statuses.length + risks.length + (search.trim() ? 1 : 0)
  const resultCountLabel = `Showing ${filtered.length} ${filtered.length === 1 ? 'report' : 'reports'}`

  return (
    <div style={{
      position: 'relative', height: '100%', minHeight: 0,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Accessibility bit - the map canvas itself is basically invisible
          to keyboard-only or screen reader users. So we always render an
          AccessibleSightingList below that mirrors the pins, including
          during loading and error states, so the report data is still
          reachable. Came out of the Iteration 1 P9 accessibility review. */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div
          ref={container}
          role="application"
          aria-label="Interactive community reports and mapped places. Parallel accessible lists are available below the map."
          aria-describedby="map-live-count"
          style={{
            position: 'absolute', inset: 0,
            touchAction: 'none',   // Let MapLibre handle all the touch stuff itself.
          }}
        />
        {isLoading && (
          <div className="map-state map-state--loading" role="status" aria-live="polite">
            <span className="map-state__pulse" aria-hidden />
            Loading community reports…
          </div>
        )}
        {isError && (
          <div className="map-state map-state--error" role="alert">
            <Icon name="WifiOff" size={18} color="var(--red-text)" />
            <span>Reports could not load.</span>
            <button type="button" onClick={() => void refetch()}>Try again</button>
          </div>
        )}
        {!isLoading && !isError && data?.items.length === 0 && (
          <div className="map-state map-state--empty" role="status">
            <Icon name="MapPin" size={18} color="var(--green-dark)" />
            No community reports are visible yet.
          </div>
        )}
        <MapLegend />
        <MapAttribution />
        {/* Same AC 4.2.3 - the visible count chip. We set aria-live so
            screen readers actually hear the new number after someone
            changes a filter, rather than silently updating. */}
        <div
          id="map-live-count"
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute', top: 12, left: 12, zIndex: 5,
            padding: '6px 10px', borderRadius: 'var(--r-chip)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            fontSize: 12, fontWeight: 600, color: 'var(--body)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
          }}
        >
          {resultCountLabel}
          {filtersActive > 0 && (
            <span style={{ marginLeft: 6, color: 'var(--muted)', fontWeight: 500 }}>
              · {filtersActive} filter{filtersActive === 1 ? '' : 's'} active
            </span>
          )}
        </div>
        <button
          type="button"
          className={`map-places-toggle${showPlaces ? ' map-places-toggle--active' : ''}`}
          aria-pressed={showPlaces}
          onClick={() => setShowPlaces((current) => !current)}
        >
          <Icon name="Trees" size={17} color="currentColor" />
          {showPlaces ? 'Hide places' : 'Show places'}
        </button>
        {showPlaces && (placesLoading || placesError || placeData.truncated || placeData.features.length === 0) && (
          <div className="map-places-status" role={placesError ? 'alert' : 'status'} aria-live="polite">
            {placesLoading
              ? 'Loading places in this view…'
              : placesError
                ? 'Mapped places could not load for this view.'
                : placeData.truncated
                  ? `Showing the first ${placeData.maxResults.toLocaleString()} places in this view. Zoom in for complete results.`
                  // An empty result is not the same as a broken map. Say the
                  // area simply has no mapped evidence so it doesn't read as a
                  // failure (UT-08).
                  : 'No mapped places in this view yet. Pan the map or zoom out to find nearby parks, forests and trails.'}
          </div>
        )}
        {selectedPlace && (
          <aside
            ref={placePreviewRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="false"
            aria-label={`${selectedPlace.displayName} place preview`}
            className="map-place-preview"
          >
            <button
              type="button"
              className="map-place-preview__close"
              aria-label="Close place preview"
              onClick={() => setSelectedPlace(null)}
            >
              <Icon name="X" size={17} color="currentColor" />
            </button>
            <span className="map-place-preview__type">{formatPlaceType(selectedPlace.placeType)}</span>
            <h2>{selectedPlace.displayName}</h2>
            <p>{selectedPlace.source} · geometry {selectedPlace.geometryVersion}</p>
            <Link
              to={`/places/${selectedPlace.placeId}`}
              onClick={() => { placeSuppressFocusRestore.current = true }}
            >
              View plants recorded nearby
            </Link>
          </aside>
        )}
        {locationNotice && (
          <div
            className={`map-location-notice map-location-notice--${locationNotice.tone}`}
            role={locationNotice.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            <Icon
              name={locationNotice.tone === 'error' ? 'MapPin' : 'Crosshair'}
              size={16}
              color="currentColor"
            />
            <span>{locationNotice.text}</span>
            <button type="button" onClick={() => setLocationNotice(null)} aria-label="Dismiss location message">
              <Icon name="X" size={15} color="currentColor" />
            </button>
          </div>
        )}
      </div>
      <AccessibleSightingList
        items={filtered}
        onSelect={select}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
      />
      <AccessiblePlaceList
        items={showPlaces ? placeData.features : []}
        isLoading={showPlaces && placesLoading}
        isError={showPlaces && placesError}
        onSelect={(feature, trigger) => {
          placeReturnFocus.current = trigger
          setSelectedPlace(feature.properties)
          map.current?.easeTo({ center: feature.geometry.coordinates as [number, number], zoom: 15 })
        }}
      />
      <SightingDetailsSheet />
      <SavedRecordDetailsSheet
        target={requestedLocation}
        open={recordDetailsOpen}
        onClose={() => setRecordDetailsOpen(false)}
      />
    </div>
  )
}

/**
 * The little detail sheet that opens when you tap a "My Reports" pin.
 * I made it a separate component from SightingDetailsSheet because the
 * data source is completely different - this one reads from React
 * Router's navigation state (see map-location-link.ts) instead of the
 * public sightings API. The record here might not even be a published
 * sighting yet, so treating it the same as a normal pin would have
 * gotten messy fast.
 */
function SavedRecordDetailsSheet({
  target,
  open,
  onClose,
}: {
  target: MapLocationTarget | null
  open: boolean
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  useDialogA11y(dialogRef, onClose, {
    active: open && !!target,
    returnFocus: () => document.querySelector<HTMLElement>('.map-record-location-marker'),
  })

  if (!open || !target) return null
  const details = target.details
  const coordinate = `${target.point.lat.toFixed(5)}, ${target.point.lng.toFixed(5)}`

  return createPortal(
    <>
      <div onClick={onClose} aria-hidden className="app-sheet-backdrop sighting-details-backdrop" />
      <aside
        ref={dialogRef}
        tabIndex={-1}
        className="pin-sheet pin-sheet--isolated saved-record-sheet"
        role="dialog"
        aria-label="Saved record details"
        aria-modal="true"
      >
        <div className="pin-sheet__handle" aria-hidden />
        <button type="button" onClick={onClose} aria-label="Close saved record details"
          className="pin-sheet__close">
          <Icon name="X" size={18} color="var(--body)" />
        </button>
        <div className="pin-sheet__content">
          <header className="saved-record-sheet__heading" tabIndex={-1} data-dialog-initial>
            <span>{details?.kind === 'scan' ? 'Saved scan' : 'Saved report'}</span>
            <h2>{target.label}</h2>
            <p>
              This is the location saved with your private record. It is separate from public community sightings until the report is published.
            </p>
          </header>
          <dl className="saved-record-sheet__facts">
            {details && <SavedRecordFact label="Status" value={details.statusLabel} />}
            {details && <SavedRecordFact label="Recorded" value={formatSavedRecordTime(details.observedAt)} />}
            <SavedRecordFact label="Coordinates" value={coordinate} mono />
            {details?.locationAccuracyM != null && (
              <SavedRecordFact label="GPS accuracy" value={`±${Math.round(details.locationAccuracyM)} m`} />
            )}
          </dl>
          {details?.kind === 'report' && details.recordId && (
            <Link className="saved-record-sheet__link" to={`/reports/${encodeURIComponent(details.recordId)}`}>
              View full report
            </Link>
          )}
        </div>
      </aside>
    </>,
    document.body,
  )
}

/** Just one row in the little facts list on the saved-record sheet
 *  (label on the left, value on the right). Pulled out so the map
 *  component doesn't get any more crowded than it already is. */
function SavedRecordFact({ label, value, mono = false }: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  )
}

function formatSavedRecordTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

/**
 * Small basemap credit chip. Sits in a corner where it won't get
 * covered by the scan button on mobile, and stays above the MapLibre
 * nav buttons on desktop. We have to keep OSM (and tile provider)
 * attribution visible per their licences, so this needs to always be there.
 */
function MapAttribution() {
  return (
    <a
      href="https://openstreetmap.org/copyright"
      target="_blank"
      rel="noopener noreferrer"
      className="map-attribution"
      aria-label={`${BASEMAP_ATTRIBUTION} - data license`}
    >
      {BASEMAP_ATTRIBUTION}
    </a>
  )
}

/**
 * The community reports list that sits below the map. It mirrors every pin as a
 * plain list item, so it works for screen-reader and keyboard users without
 * touching the map canvas - and, since usability testers looking for "the
 * reports list below the map" could not find a screen-reader-only one (UT-13),
 * it is now a visible, collapsible panel too. One accessible list serves both.
 */
function AccessibleSightingList({
  items, onSelect, isLoading, isError, onRetry,
}: {
  items: Sighting[]
  onSelect: (id: string) => void
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}) {
  const summary = isLoading
    ? 'Community reports · loading…'
    : isError
      ? 'Community reports · could not load'
      : `Community reports · ${items.length}`
  // The list has to render in loading and error states too, not just when data
  // arrives - otherwise a keyboard or screen-reader user who hit a network
  // error would have nothing to interact with, since the map canvas doesn't
  // help them. Came from the accessibility review.
  return (
    <section aria-label="Community reports list" className="map-reports-panel">
      <details open>
        <summary className="map-reports-panel__summary">{summary}</summary>
        <div className="map-reports-panel__body">
          {isLoading && <p role="status">Loading community reports…</p>}
          {isError && (
            <p role="alert">
              Community reports could not load.{' '}
              <button type="button" onClick={onRetry}>Try again</button>
            </p>
          )}
          {!isLoading && !isError && (
            <>
              <p className="map-reports-panel__count">
                {items.length === 0
                  ? 'No community reports match the current filters.'
                  : `${items.length} community report${items.length === 1 ? '' : 's'} match the current filters.`}
              </p>
              {items.length > 0 && (
                <ul className="map-reports-panel__list">
                  {items.map((s) => {
                    const statusLabel = s.status === 'screened'
                      ? 'Community report - not expert validated'
                      : s.status === 'removal_reported' ? 'Removal reported' : 'Removed'
                    const statusDate = s.status === 'removal_reported'
                      ? ` on ${formatStatusDate(s.removalReportedAt ?? s.lastReportedAt)}`
                      : ''
                    const tierLabel = PIN_TIERS[pinTier(s)].label
                    const placeName = s.place.source === 'fallback' || !s.place.displayName
                      ? 'No named trail, park or forest found nearby'
                      : s.place.displayName
                    return (
                      <li key={s.id}>
                        <button type="button" onClick={() => onSelect(s.id)} className="map-reports-panel__item">
                          <span className="map-reports-panel__item-name">{s.speciesName} <i>({s.latinName})</i></span>
                          <span className="map-reports-panel__item-meta">{tierLabel} · {statusLabel}{statusDate}</span>
                          <span className="map-reports-panel__item-place">{placeName}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </details>
    </section>
  )
}

function AccessiblePlaceList({
  items, isLoading, isError, onSelect,
}: {
  items: PlaceMapFeature[]
  isLoading: boolean
  isError: boolean
  onSelect: (feature: PlaceMapFeature, trigger: HTMLButtonElement) => void
}) {
  return (
    <section aria-label="Mapped places in current view" className="sr-only">
      {isLoading && <p role="status">Loading mapped places in the current map view…</p>}
      {isError && <p role="alert">Mapped places could not load for the current map view.</p>}
      {!isLoading && !isError && (
        <>
          <p>{items.length} mapped place{items.length === 1 ? '' : 's'} in the current view.</p>
          <ul>
            {items.map((feature) => (
              <li key={feature.properties.placeId}>
                <button
                  type="button"
                  data-place-id={feature.properties.placeId}
                  onClick={(event) => onSelect(feature, event.currentTarget)}
                >
                  {feature.properties.displayName} - {formatPlaceType(feature.properties.placeType)} - View plants recorded nearby
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** Tiny helper - we colour active markers by how many reports they've
 *  gathered (hotspot vs spreading vs isolated), and anything marked as
 *  removed goes grey so it visually fades into the background. */
type PinTier = 'hotspot' | 'spreading' | 'isolated' | 'removed'

export const PIN_TIERS: Record<PinTier, { fill: string; label: string }> = {
  hotspot: { fill: '#C2412D', label: 'Hotspot (5+ reports)' },
  spreading: { fill: '#D9880F', label: 'Spreading (2-4 reports)' },
  isolated: { fill: '#2E7D3F', label: 'Isolated (1 report)' },
  removed: { fill: '#8B978F', label: 'Removed' },
}

export function pinTier(s: Pick<Sighting, 'status' | 'reportCount'>): PinTier {
  if (s.status === 'removed' || s.status === 'removal_reported') return 'removed'
  if (s.reportCount >= 5) return 'hotspot'
  if (s.reportCount >= 2) return 'spreading'
  return 'isolated'
}

/**
 * Builds the DOM element for one marker on the map. I went with a
 * teardrop shape rather than a plain circle - the pointy tip actually
 * lands on the coordinate, so users can tell which spot it means. A
 * hovering circle looked ambiguous during pilot testing.
 */
function pinElement(s: Sighting): HTMLElement {
  const el = document.createElement('button')
  el.type = 'button'
  const statusLabel = s.status === 'screened'
    ? 'Community report - not expert validated'
    : s.status === 'removal_reported' ? 'Removal reported' : 'Removed'
  const statusDate = s.status === 'removal_reported'
    ? ` on ${formatStatusDate(s.removalReportedAt ?? s.lastReportedAt)}`
    : ''
  const tier = pinTier(s)
  const tierInfo = PIN_TIERS[tier]
  const ariaLabel = `${s.speciesName} - ${tierInfo.label} - ${statusLabel}${statusDate}`
  el.setAttribute('aria-label', ariaLabel)
  el.title = `${tierInfo.label}\n${statusLabel}${statusDate}`
  el.dataset.sightingId = s.id
  el.dataset.tier = tier
  el.className = 'map-pin'
  const isRemoved = tier === 'removed'
  el.innerHTML = `
    <svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.3));">
      <path d="M13 33 C 13 33 24 20 24 11 A 11 11 0 1 0 2 11 C 2 20 13 33 13 33 Z"
            fill="${tierInfo.fill}" stroke="#fff" stroke-width="2" />
      <circle cx="13" cy="11" r="4.5" fill="#fff" opacity="${isRemoved ? 0.6 : 0.9}" />
    </svg>`
  el.style.cssText = `
    width: 26px; height: 34px; padding: 0; background: transparent;
    border: none; cursor: pointer; opacity: ${isRemoved ? 0.7 : 1};
    -webkit-tap-highlight-color: transparent;
  `
  return el
}

function formatStatusDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}
