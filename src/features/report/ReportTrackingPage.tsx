import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '@/services/api-client'
import type { PlaceDetail, RemovalReportResponse, Report, ReportStatus, SightingDetail, WithdrawalReportResponse } from '@/types'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { LOCATION_ACCURACY_INSUFFICIENT_MESSAGE } from './gps-policy'
import './report-tracking.css'

const COPY: Record<ReportStatus, { title: string; body: string }> = {
  processing: {
    title: 'Screening in progress',
    body: 'This report remains private while its photo, location and submission details are checked.',
  },
  screened: {
    title: 'Report published',
    body: 'Community report - not expert validated. This report is now visible on the shared map.',
  },
  merged: {
    title: 'Added to an existing sighting',
    body: 'A recent report of the same species was found nearby, so this evidence was added to that sighting.',
  },
  needs_rescan: {
    title: 'A new scan is needed',
    body: 'The current photo or location could not be checked. Retake the scan at the plant.',
  },
  rejected: {
    title: 'Report not accepted',
    body: 'This evidence matches a report that was already submitted.',
  },
  validation_unavailable: {
    title: 'Screening unavailable',
    body: 'This report remains private until screening is available again.',
  },
}

/**
 * This is the private status page a single contributor sees for their own
 * report - where it currently stands in the automated screening pipeline
 * (processing, published, merged, needs rescan, rejected). One of the
 * requirements was that screening decisions shouldn't be a total black box,
 * so we do show reason codes here, but only in plain language and only for
 * this user's own report - we filter out the generic
 * "automated_rule_screened" code since that one doesn't actually tell the
 * user anything useful, and we never expose the raw rule internals or
 * anyone else's reports. It polls while the report is still processing (or
 * stuck in validation_unavailable but still retryable) since screening
 * happens asynchronously on the backend.
 */
export function ReportTrackingPage() {
  const { reportId } = useParams()
  const navigate = useNavigate()
  const goBack = () => {
    // If this page was opened straight from a notification, browser history
    // might just be one entry deep, so navigate(-1) could bounce the user
    // right out of the app. We fall back to the records list instead.
    if (window.history.length > 1) navigate(-1)
    else navigate('/reports')
  }
  const profileId = usePrivateAccess((state) => state.profile?.id ?? null)
  const [removalFix, setRemovalFix] = useState<{
    latitude: number
    longitude: number
    accuracyM: number
    capturedAt: string
  } | null>(null)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [adoptionDismissed, setAdoptionDismissed] = useState(false)
  const [withdrawReason, setWithdrawReason] = useState('')
  const query = useQuery({
    queryKey: ['report', profileId, reportId],
    queryFn: () => api<Report>(`/api/v1/reports/${reportId}`),
    enabled: !!profileId && !!reportId,
    refetchInterval: (state) => (
      state.state.data?.status === 'processing'
        || (state.state.data?.status === 'validation_unavailable'
          && state.state.data.validation.retryable)
        ? 3_000
        : false
    ),
  })
  const sighting = useQuery({
    queryKey: ['sighting', query.data?.sightingId],
    queryFn: () => api<SightingDetail>(`/api/v1/sightings/${query.data!.sightingId}`),
    enabled: Boolean(query.data?.sightingId),
  })
  const removal = useMutation({
    mutationFn: (fix: NonNullable<typeof removalFix>) => api<RemovalReportResponse>(
      `/api/v1/reports/${reportId}/removal`,
      {
        method: 'POST',
        body: JSON.stringify(fix),
      },
    ),
    onSuccess: () => void sighting.refetch(),
  })
  // UT-10: a controlled way to withdraw an accidental *published* report. It
  // removes the sighting from the public map but keeps the report and its audit
  // history for review - it never silently deletes community evidence.
  const withdrawal = useMutation({
    mutationFn: (reason: string) => api<WithdrawalReportResponse>(
      `/api/v1/reports/${reportId}/withdrawal`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),
    onSuccess: () => { void sighting.refetch(); void query.refetch() },
  })
  const adoptionPlace = useQuery({
    queryKey: ['report-adoption-place', reportId, query.data?.submission.location],
    queryFn: () => api<{ place: PlaceDetail | null }>(
      `/api/v1/places/at-location?lat=${query.data!.submission.location.lat}&lon=${query.data!.submission.location.lng}`,
    ),
    enabled: Boolean(
      query.data
      && (query.data.status === 'screened' || query.data.status === 'merged')
      && query.data.sightingId,
    ),
  })
  const adopt = useMutation({
    mutationFn: (placeId: string) => api<{ adoptionId: string }>(
      '/api/v1/adopted-areas',
      { method: 'POST', body: JSON.stringify({ placeId }) },
    ),
  })

  const captureRemovalLocation = () => {
    setLocationError(null)
    setRemovalFix(null)
    if (!navigator.geolocation) {
      setLocationError('Location is unavailable in this browser. The removal report was not submitted.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setRemovalFix({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        })
      },
      () => setLocationError(
        'A fresh location could not be obtained. Allow location access and try again at the plant.',
      ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
  }

  if (query.isLoading) {
    return (
      <section className="report-tracking" aria-label="Report status">
        <article className="report-tracking__content report-tracking__content--loading" role="status">
          <span className="report-tracking__skeleton-line report-tracking__skeleton-line--short invatrace-skeleton" aria-hidden />
          <span className="report-tracking__skeleton-line report-tracking__skeleton-line--title invatrace-skeleton" aria-hidden />
          <span className="report-tracking__skeleton-line invatrace-skeleton" aria-hidden />
          <span className="report-tracking__skeleton-line report-tracking__skeleton-line--medium invatrace-skeleton" aria-hidden />
          <span className="sr-only">Loading report status…</span>
        </article>
      </section>
    )
  }

  if (query.isError || !query.data) {
    return (
      <section className="report-tracking" aria-label="Report status">
        <article className="report-tracking__content" role="alert">
          <h1>Report unavailable</h1>
          <p>We could not load this report. Check the connection and try again.</p>
          <div className="report-tracking__actions">
            <button type="button" onClick={() => void query.refetch()}>Try again</button>
            <Link to="/reports" className="report-tracking__secondary">Back to my records</Link>
          </div>
        </article>
      </section>
    )
  }

  const report = query.data
  const copy = COPY[report.status]
  const usefulReasons = report.validation.reasonCodes.filter((reason) => reason !== 'automated_rule_screened')

  return (
    <section className={`report-tracking report-tracking--${report.status}`} aria-label="Report status">
      <article className="report-tracking__content" aria-live="polite">
        <button type="button" onClick={goBack} className="report-tracking__back">
          &larr; Back
        </button>
        <p className="report-tracking__reference">Report {report.id.slice(0, 8)}</p>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>

        <dl className="report-tracking__meta">
          <div>
            <dt>Reported location</dt>
            <dd className="report-tracking__coordinates">
              {report.submission.location.lat.toFixed(5)}, {report.submission.location.lng.toFixed(5)}
            </dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{formatSubmittedAt(report.createdAt)}</dd>
          </div>
        </dl>

        {usefulReasons.length > 0 && (
          <section className="report-tracking__reasons" aria-labelledby="report-reasons-heading">
            <h2 id="report-reasons-heading">Details</h2>
            {usefulReasons.map((reason) => <p key={reason}>{humanize(reason)}</p>)}
          </section>
        )}

        {(report.status === 'screened' || report.status === 'merged')
          && adoptionPlace.data?.place
          && !adoptionDismissed && (
          <section className="report-tracking__adoption" aria-labelledby="report-adoption-heading">
            <h2 id="report-adoption-heading">Adopt this area for monitoring?</h2>
            <p>
              Your report is inside or along <strong>{adoptionPlace.data.place.displayName}</strong>.
              Save it as a non-exclusive monitoring bookmark. This does not grant ownership,
              responsibility, access rights or removal permission.
            </p>
            {adopt.isSuccess ? (
              <p role="status">{adoptionPlace.data.place.displayName} is adopted for monitoring.</p>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => adopt.mutate(adoptionPlace.data!.place!.placeId)}
                  disabled={adopt.isPending}
                >
                  {adopt.isPending ? 'Adding…' : 'Adopt for monitoring'}
                </button>
                <button type="button" onClick={() => setAdoptionDismissed(true)}>Not now</button>
              </div>
            )}
          </section>
        )}

        {(report.status === 'screened' || report.status === 'merged')
          && report.sightingId && sighting.data?.status === 'screened' && (
          <section className="report-tracking__removal" aria-labelledby="removal-report-heading">
            <h2 id="removal-report-heading">Mark as removed</h2>
            <p>
              Use a fresh browser location at the plant. The server accepts a fix only when its
              accuracy is 250 metres or better and it is within 250 metres of the original report.
            </p>
            {removal.data ? (
              <p className="report-tracking__removal-success" role="status">
                Removal reported {formatSubmittedAt(removal.data.removalReportedAt)}.
                {' '}Location accuracy was ±{removal.data.accuracyM} m.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="report-tracking__location-button"
                  onClick={captureRemovalLocation}
                  disabled={removal.isPending}
                >
                  Use my current location
                </button>
                {removalFix && (
                  <div className="report-tracking__location-fix" role="status">
                    <strong>Fresh location accuracy: ±{removalFix.accuracyM} m</strong>
                    <span>Coordinates are captured by the browser and cannot be edited.</span>
                    {removalFix.accuracyM <= 250 ? (
                      <button
                        type="button"
                        onClick={() => removal.mutate(removalFix)}
                        disabled={removal.isPending}
                      >
                        {removal.isPending ? 'Submitting…' : 'Confirm removal report'}
                      </button>
                    ) : (
                      <span role="alert">Accuracy is above 250 m. Move closer and request a new fix.</span>
                    )}
                  </div>
                )}
                {(locationError || removal.isError) && (
                  <p className="report-tracking__removal-error" role="alert">
                    {locationError ?? removalErrorMessage(removal.error)}
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {(report.status === 'screened' || report.status === 'merged')
          && report.sightingId && (
          <section className="report-tracking__withdraw" aria-labelledby="withdraw-report-heading">
            <h2 id="withdraw-report-heading">Reported this by mistake?</h2>
            {withdrawal.data || sighting.data?.status === 'withdrawn' ? (
              <p className="report-tracking__withdraw-success" role="status">
                Withdrawal recorded. This report no longer appears on the public map.
                Your original report and its history are kept for review.
              </p>
            ) : (
              <>
                <p>
                  Request withdrawal to take this report off the public map. Your
                  report and its history are kept for review — community evidence
                  is never silently deleted.
                </p>
                <label className="report-tracking__withdraw-label">
                  Reason (optional)
                  <textarea
                    value={withdrawReason}
                    onChange={(event) => setWithdrawReason(event.target.value)}
                    maxLength={300}
                    rows={2}
                    placeholder="e.g. I misidentified the plant"
                  />
                </label>
                <button
                  type="button"
                  className="report-tracking__withdraw-button"
                  onClick={() => {
                    if (window.confirm('Withdraw this report from the public map? Your report history is kept for review.')) {
                      withdrawal.mutate(withdrawReason.trim())
                    }
                  }}
                  disabled={withdrawal.isPending}
                >
                  {withdrawal.isPending ? 'Submitting…' : 'Request withdrawal'}
                </button>
                {withdrawal.isError && (
                  <p className="report-tracking__removal-error" role="alert">
                    The withdrawal could not be submitted. Check the connection and try again.
                  </p>
                )}
              </>
            )}
          </section>
        )}

        <div className="report-tracking__actions">
          {report.status === 'needs_rescan' && <Link to="/scan" state={{ returnTo: '/reports' }}>Retake scan</Link>}
          {report.sightingId && (
            <Link to={`/map?sighting=${encodeURIComponent(report.sightingId)}`}>View shared map</Link>
          )}
          <Link to="/reports" className="report-tracking__secondary">Back to my records</Link>
        </div>
      </article>
    </section>
  )
}

const REASON_COPY: Record<string, string> = {
  exact_photo_replay: 'This photo was already submitted.',
  perceptual_photo_replay: 'This photo is very similar to an earlier report of the same species.',
  same_species_nearby_recent: 'The same species was reported nearby recently.',
  image_too_small: 'The photo is too small to check.',
  image_too_dark: 'The photo is too dark.',
  image_too_bright: 'The photo is too bright.',
  image_low_contrast: 'The plant is difficult to distinguish from the background.',
  image_too_blurry: 'The photo is too blurry.',
  invalid_or_corrupt_image: 'The photo could not be read.',
  location_accuracy_insufficient: LOCATION_ACCURACY_INSUFFICIENT_MESSAGE,
  plant_identification_not_reportable: 'This species is not currently reportable.',
  unsupported_client_model_version: 'Update the app before submitting this report.',
}

const humanize = (reason: string) => REASON_COPY[reason]
  ?? `${reason.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase())}.`

const formatSubmittedAt = (value: string) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value))

function removalErrorMessage(error: Error | null): string {
  if (error instanceof ApiError) {
    if (error.code === 'removal_too_far') return 'You are more than 250 metres from the original report.'
    if (error.code === 'removal_accuracy_too_low') return 'Location accuracy must be 250 metres or better.'
    if (error.code === 'removal_location_stale') return 'The location fix expired. Request a fresh location.'
    if (error.code === 'removal_not_available') return 'This report can no longer be marked as removed.'
  }
  return 'The removal report could not be submitted. Check the connection and try again.'
}
