import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/Icon'
import { api, ApiError } from '@/services/api-client'
import { useMapView } from '@/features/map/map-view-store'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { fetchNearestOsmFeature } from '@/services/osm-nearest'
import { PIN_TIERS, pinTier } from '@/features/map/ThreatMapPage'
import { PlantGuidancePanel } from '@/features/scan/PlantGuidancePanel'
import { findPlantGuidance } from '@/data/plant-guidance'
import { findModelSpecies, modelReferenceImageUrl } from '@/data/model-species-catalogue'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import type { RemovalReportResponse, SightingDetail } from '@/types'
import './sighting-details.css'

const OSM_FEATURE_LABEL: Record<string, string> = {
  highway_path: 'trail',
  highway_footway: 'footway',
  highway_track: 'track',
  leisure_park: 'park',
  landuse_forest: 'forest',
  natural_wood: 'wood',
}

/**
 * Full detail view for a single map sighting, shown as a bottom sheet:
 * species photo, risk tier, report count, nearby place, and the guidance
 * panel. It only gets rendered once inside ThreatMapPage.tsx and opens
 * whenever `selectedId` in map-view-store.ts gets set - that happens either
 * by clicking a pin or picking a row from the accessible sighting list.
 */
export function SightingDetailsSheet() {
  const { selectedId, select } = useMapView()
  const profileId = usePrivateAccess((state) => state.profile?.id ?? null)
  const dialogRef = useRef<HTMLElement>(null)
  const [removalFix, setRemovalFix] = useState<{
    latitude: number
    longitude: number
    accuracyM: number
    capturedAt: string
  } | null>(null)
  const [removalLocationError, setRemovalLocationError] = useState<string | null>(null)
  const [removalOpen, setRemovalOpen] = useState(false)
  const close = () => select(null)
  useDialogA11y(dialogRef, close, {
    active: !!selectedId,
    returnFocus: () => selectedId
      ? document.querySelector<HTMLElement>(`.map-pin[data-sighting-id="${CSS.escape(selectedId)}"]`)
      : null,
  })

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sighting', selectedId],
    queryFn: () => api<SightingDetail>(`/api/v1/sightings/${selectedId}`),
    enabled: !!selectedId,
    staleTime: 60_000,
  })
  const removal = useMutation({
    mutationFn: (fix: NonNullable<typeof removalFix>) => api<RemovalReportResponse>(
      `/api/v1/reports/${data!.removalReportId}/removal`,
      { method: 'POST', body: JSON.stringify(fix) },
    ),
    onSuccess: () => void refetch(),
  })

  useEffect(() => {
    setRemovalFix(null)
    setRemovalLocationError(null)
    setRemovalOpen(false)
    removal.reset()
    // The mutation object changes after every render; selectedId is the reset boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const captureRemovalLocation = () => {
    setRemovalLocationError(null)
    setRemovalFix(null)
    if (!navigator.geolocation) {
      setRemovalLocationError('Location is unavailable in this browser. No status was changed.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => setRemovalFix({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyM: position.coords.accuracy,
        capturedAt: new Date(position.timestamp).toISOString(),
      }),
      () => setRemovalLocationError(
        'A fresh location could not be obtained. Allow location access and try again at the plant.',
      ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
  }

  // Nearby-place lookup is just enrichment, so I don't want it blocking the
  // sheet from opening - it runs as its own query, separate from the main one.
  const { data: nearestOsm } = useQuery({
    queryKey: ['osm-nearest', data?.location.lat, data?.location.lng],
    queryFn: () => fetchNearestOsmFeature(data!.location.lat, data!.location.lng),
    enabled: !!data,
    staleTime: 10 * 60_000,
    retry: false,
  })

  if (!selectedId) return null

  const tier = data ? pinTier(data) : 'isolated'
  const tierInfo = PIN_TIERS[tier]
  const coordinateDecimals = data?.precisionReduced ? 4 : 5
  return createPortal(
    <>
      <div onClick={close} aria-hidden className="app-sheet-backdrop sighting-details-backdrop" />
      <aside ref={dialogRef} tabIndex={-1} className={`pin-sheet pin-sheet--${tier}`}
        role="dialog" aria-label="Sighting details" aria-modal="true">
        <div className="pin-sheet__handle" aria-hidden />

        <button type="button" onClick={close} aria-label="Close sighting details"
          className="pin-sheet__close">
          <Icon name="X" size={18} color="var(--body)" />
        </button>

        <div className="pin-sheet__content">
          {isError ? (
            <div role="alert" tabIndex={-1} data-dialog-initial className="pin-sheet__state pin-sheet__state--error">
              <strong>Could not load this sighting.</strong>
              <p>The map record is still available. Check the connection and try again.</p>
              <button type="button" onClick={() => void refetch()} className="pin-sheet__retry">
                Try again
              </button>
            </div>
          ) : isLoading || !data ? (
            <div role="status" tabIndex={-1} data-dialog-initial className="pin-sheet__state">
              <span className="pin-sheet__skeleton-photo invatrace-skeleton" aria-hidden />
              <span className="pin-sheet__skeleton-line pin-sheet__skeleton-line--title invatrace-skeleton" aria-hidden />
              <span className="pin-sheet__skeleton-line pin-sheet__skeleton-line--short invatrace-skeleton" aria-hidden />
              <span className="pin-sheet__skeleton-line invatrace-skeleton" aria-hidden />
              <span className="sr-only">Loading sighting…</span>
            </div>
          ) : (
            <>
              {/* AC 4.2.2 wants the actual evidence photo shown first, so this
                  goes above the catalogue reference photo. It comes through a
                  presigned thumbnailUrl. The reference photo below is clearly
                  labelled "reference" - I didn't want it read as if it were
                  the reporter's own evidence. */}
              <EvidenceThumbnail thumbnailUrl={data.thumbnailUrl} speciesName={data.speciesName} />
              <PlantReferenceMedia latinName={data.latinName} speciesName={data.speciesName} />

              <header className="pin-sheet__heading">
                <h2 tabIndex={-1} data-dialog-initial>{data.speciesName}</h2>
                <p className="pin-sheet__latin">{data.latinName}</p>
                <div className="pin-sheet__summary" aria-label={sightingSummaryLabel(data)}>
                  <span className={`pin-sheet__risk pin-sheet__risk--${tier}`}>
                    <span aria-hidden className="pin-sheet__risk-dot" style={{ background: tierInfo.fill }} />
                    {densityLabel(tierInfo.label)}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="pin-sheet__report-count">
                    {formatReportCount(data.reportCount)} at this location
                  </span>
                </div>
                <p className="pin-sheet__status-note">
                  {data.status === 'removal_reported'
                    ? `Removal reported ${formatTime(data.removalReportedAt ?? data.lastReportedAt)} · retained for follow-up`
                    : data.status === 'removed'
                      ? 'Marked removed · retained for follow-up'
                      : 'Community report - not expert validated'}
                </p>
              </header>

              <section className="pin-sheet__record" aria-labelledby="sighting-record-heading">
                <h3 id="sighting-record-heading">Report information</h3>
                <dl>
                  <MetaRow label="Reported" value={formatTime(data.lastReportedAt)} />
                  {/* AC 4.2.2 also asks for model confidence next to the report. */}
                  {typeof data.confidence === 'number' && (
                    <MetaRow
                      label="Model confidence"
                      value={`${Math.round(data.confidence * 100)}%`}
                      sub="Highest confidence across linked reports"
                    />
                  )}
                  <MetaRow label="Near"
                    value={nearbyPlaceLabel(data, nearestOsm)}
                    sub={
                      data.nearestFeatureName
                        ? 'Recorded at publication time from OpenStreetMap'
                        : nearestOsm ? 'Live place data from OpenStreetMap' : undefined
                    } />
                  <MetaRow label="Coordinates"
                    value={`${data.location.lat.toFixed(coordinateDecimals)}, ${data.location.lng.toFixed(coordinateDecimals)}`}
                    sub={data.precisionReduced ? 'Approximate location for privacy' : undefined} mono />
                </dl>
              </section>

              {profileId && data.status === 'screened' && data.removalReportId && (
                <section className="pin-sheet__removal" aria-labelledby="sighting-removal-heading">
                  {!removalOpen ? (
                    <>
                      <h3 id="sighting-removal-heading">Removal status</h3>
                      <p>This is a community-reported status, not expert verification.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setRemovalOpen(true)
                          captureRemovalLocation()
                        }}
                      >
                        Mark as removed
                      </button>
                    </>
                  ) : removal.data ? (
                    <>
                      <h3 id="sighting-removal-heading">Removal status</h3>
                      <p role="status">Removal reported. The original report remains available.</p>
                    </>
                  ) : (
                    <>
                      <h3 id="sighting-removal-heading">Confirm removal report</h3>
                      <p>
                        This is community-reported, not expert verification. The browser is requesting
                        a fresh location. It must be accurate to 250 m or better and within 250 m of the marker.
                      </p>
                      {!removalFix && !removalLocationError && (
                        <p role="status">Requesting a fresh device location…</p>
                      )}
                      {removalFix && (
                        <div className="pin-sheet__removal-fix" role="status">
                          <strong>Measured accuracy: ±{removalFix.accuracyM} m</strong>
                          {removalFix.accuracyM <= 250 ? (
                            <button
                              type="button"
                              onClick={() => removal.mutate(removalFix)}
                              disabled={removal.isPending}
                            >
                              {removal.isPending ? 'Submitting…' : 'Confirm removal report'}
                            </button>
                          ) : (
                            <>
                              <span role="alert">Accuracy is above 250 m. Request a new fix.</span>
                              <button type="button" onClick={captureRemovalLocation}>Request a new location</button>
                            </>
                          )}
                        </div>
                      )}
                      {(removalLocationError || removal.isError) && (
                        <>
                          <p role="alert">{removalLocationError ?? publicRemovalError(removal.error)}</p>
                          <button type="button" onClick={captureRemovalLocation}>Try location again</button>
                        </>
                      )}
                    </>
                  )}
                </section>
              )}

              <details className="pin-sheet__guidance">
                <summary>
                  <span>
                    <strong>Identification and safety</strong>
                    <small>Plant details and action guidance</small>
                  </span>
                  <span className="pin-sheet__guidance-action" aria-hidden />
                </summary>
                <PlantGuidancePanel
                  scientificName={data.latinName}
                  speciesName={data.speciesName}
                  plantId={data.speciesId}
                  showReferenceImage={false}
                  decisionContext={{ id: `sighting:${data.id}`, kind: 'sighting' }}
                />
              </details>
            </>
          )}
        </div>

        {data && (
          <footer className="pin-sheet__footer">
            <button type="button" disabled aria-label="Directions not available yet"
              className="pin-sheet__directions" title="Coming in a later release">
              <Icon name="Navigation" size={14} color="currentColor" />
              Directions coming soon
            </button>
          </footer>
        )}
      </aside>
    </>,
    document.body,
  )
}

/** The actual reporter-submitted photo (AC 4.2.2), served through a
 *  short-lived presigned URL from the sightings API. It's rendered above the
 *  catalogue reference photo so the evidence shows first. If thumbnailUrl
 *  isn't set I just render nothing here and let the reference-image row
 *  below carry the panel instead. */
function EvidenceThumbnail({
  thumbnailUrl, speciesName,
}: { thumbnailUrl: string | null; speciesName: string }) {
  if (!thumbnailUrl) return null
  return (
    <figure className="pin-sheet__reference">
      <img
        className="pin-sheet__photo"
        src={thumbnailUrl}
        alt={`Reporter photo of ${speciesName}`}
        loading="lazy"
      />
      <figcaption>
        <span>Community report evidence</span>
        <span>Uploaded by a reporter · not expert validated</span>
      </figcaption>
    </figure>
  )
}

/** This one only ever shows the reviewed catalogue image, never a reporter's
 *  own upload - keeping those two image sources visually distinct is the
 *  whole point of splitting this out from EvidenceThumbnail above. */
function PlantReferenceMedia({ latinName, speciesName }: { latinName: string; speciesName: string }) {
  const guidance = findPlantGuidance({
    scientificName: latinName,
    modelLabel: speciesName,
    plantId: null,
  })
  const modelSpecies = findModelSpecies({ scientificName: latinName })
  const referenceImage = guidance?.reference_image
    ?? (modelSpecies ? modelReferenceImageUrl(modelSpecies) : null)
  if (!referenceImage) return null
  return (
    <figure className="pin-sheet__reference">
      <img className="pin-sheet__photo" src={referenceImage}
        alt={`Typical appearance of ${latinName}`} />
      <figcaption>
        <span>Species reference</span>
        <span>{guidance?.reference_image_credit ?? 'Species reference image'}</span>
      </figcaption>
    </figure>
  )
}

/** One label/value row (plus an optional sub-note) in the "Report information" list. */
function MetaRow({ label, value, sub, mono }: {
  label: string; value: string; sub?: string; mono?: boolean
}) {
  return (
    <div className="pin-sheet__record-row">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
      {sub && <span>{sub}</span>}
    </div>
  )
}

// Per AC 4.3.1, the nearest-feature name the backend computed and stored at
// publication time is treated as authoritative and shown first if present.
// The live Overpass fetch above is just enrichment I fall back to when the
// server never persisted a nearest feature. And per AC 4.3.2, if neither one
// has anything, this falls through to the exact copy "No named trail, park
// or forest found nearby" rather than an empty field.
function nearbyPlaceLabel(
  data: SightingDetail,
  nearestOsm: Awaited<ReturnType<typeof fetchNearestOsmFeature>> | undefined,
): string {
  if (data.nearestFeatureName && data.nearestFeatureType) {
    const kind = OSM_FEATURE_LABEL[data.nearestFeatureType]
      ?? OSM_FEATURE_LABEL[`highway_${data.nearestFeatureType}`]
      ?? OSM_FEATURE_LABEL[`leisure_${data.nearestFeatureType}`]
      ?? OSM_FEATURE_LABEL[`landuse_${data.nearestFeatureType}`]
      ?? OSM_FEATURE_LABEL[`natural_${data.nearestFeatureType}`]
      ?? data.nearestFeatureType
    const distance = data.nearestFeatureDistanceM != null
      ? `, about ${Math.round(data.nearestFeatureDistanceM)} m away`
      : ''
    return `${data.nearestFeatureName} · ${kind}${distance}`
  }
  if (nearestOsm) {
    const kind = OSM_FEATURE_LABEL[nearestOsm.featureType] ?? 'feature'
    return `${nearestOsm.featureName} · ${kind}, about ${nearestOsm.distanceM} m away`
  }
  if (data.place.source === 'fallback' || !data.place.displayName) {
    return 'No named trail, park or forest found nearby'
  }
  return data.place.displayName
}

function densityLabel(label: string): string {
  return label.replace(/\s*\(.*\)$/, '')
}

function formatReportCount(count: number): string {
  return `${count} ${count === 1 ? 'report' : 'reports'}`
}

function sightingSummaryLabel(data: SightingDetail): string {
  const status = data.status === 'removed' ? 'removed' : 'Community report - not expert validated'
  return `${densityLabel(PIN_TIERS[pinTier(data)].label)}, ${formatReportCount(data.reportCount)}, ${status}`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const mins = Math.round((now - d.getTime()) / 60000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

function publicRemovalError(error: Error | null): string {
  if (error instanceof ApiError) {
    if (error.code === 'removal_too_far') return 'You are more than 250 metres from the marker.'
    if (error.code === 'outside_removal_radius') return 'You are more than 250 metres from the marker.'
    if (error.code === 'removal_accuracy_too_low') return 'Location accuracy must be 250 metres or better.'
    if (error.code === 'removal_location_stale') return 'The location fix expired. Request a fresh location.'
    if (error.code === 'fresh_location_required') return 'Request a fresh location with accuracy of 250 metres or better.'
    if (error.code === 'removal_not_available') return 'This sighting cannot be marked as removed.'
  }
  return 'The removal report could not be submitted. Check the connection and try again.'
}
