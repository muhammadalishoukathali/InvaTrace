import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { BackLink } from '@/components/BackLink'
import { Icon } from '@/components/Icon'
import { ApiError } from '@/services/api-client'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { eventsApi } from '@/services/api/events'
import { eventContextStore } from './event-context'
import { EventState } from './EventCard'
import { formatEventTime } from './event-format'
import './events.css'

const ACCURACY_LIMIT_M = 250

// AC 9.3.3: say which condition failed - location, accuracy, place or timing.
const REJECTIONS: Record<string, { condition: string; message: string }> = {
  location_unavailable: { condition: 'Location', message: 'Your location is unavailable. Turn on location services and try again.' },
  fresh_location_required: { condition: 'Location', message: 'That location is no longer fresh. Get a new location and try again.' },
  accuracy_too_low: { condition: 'Accuracy', message: `Your location is not accurate enough. Wait for ${ACCURACY_LIMIT_M} m or better, ideally outdoors.` },
  outside_place: { condition: 'Place', message: 'You are outside the mapped event place. Move closer to the meeting point and try again.' },
  event_geometry_stale: { condition: 'Place', message: 'The place boundary for this event has changed. Contact the host before checking in again.' },
  outside_time_window: { condition: 'Timing', message: 'Check-in opens 30 minutes before the event starts and closes when it ends.' },
  event_not_published: { condition: 'Timing', message: 'This event is no longer open for check-in.' },
}

const GEO_ERRORS: Record<number, string> = {
  1: 'Location is unavailable because location access is blocked. Allow location access for InvaTrace and try again.',
  2: 'Location is unavailable right now. Move into the open and try again.',
  3: 'Location is unavailable — the device took too long to find you. Try again outdoors.',
}

/** US 9.3: a fresh device location only, never a typed coordinate. */
export function EventCheckInPage() {
  const { eventId = '' } = useParams()
  const cache = useQueryClient()
  const navigate = useNavigate()
  const routeLocation = useLocation()
  const profileId = usePrivateAccess((state) => state.profile?.id)
  const [location, setLocation] = useState<GeolocationPosition | null>(null)
  const [geoError, setGeoError] = useState('')
  const [locating, setLocating] = useState(false)
  const request = useRef(0)
  useEffect(() => () => { request.current += 1 }, [eventId])
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => eventsApi.get(eventId) })
  const checkin = useMutation({
    mutationFn: () => eventsApi.checkIn(eventId, {
      latitude: location!.coords.latitude,
      longitude: location!.coords.longitude,
      accuracyM: location!.coords.accuracy,
      capturedAt: new Date(location!.timestamp).toISOString(),
    }),
    onSuccess: async (result) => {
      if (event.data) {
        eventContextStore.checkIn({ eventId: event.data.id, startAt: event.data.startAt, endAt: event.data.endAt, profileId }, result.checkedInAt)
      }
      await cache.invalidateQueries({ queryKey: ['event', eventId] })
      // Replace check-in so Back from the task returns to the event, not here.
      navigate(`/events/${eventId}/tasks`, { replace: true, state: routeLocation.state })
    },
  })
  const locate = () => {
    if (!navigator.geolocation) {
      setGeoError('Location is unavailable on this device. Use a phone with location services turned on.')
      return
    }
    const id = ++request.current
    setLocating(true)
    setLocation(null)
    setGeoError('')
    checkin.reset()
    navigator.geolocation.getCurrentPosition(
      (position) => { if (request.current !== id) return; setLocation(position); setLocating(false) },
      (error) => { if (request.current !== id) return; setGeoError(GEO_ERRORS[error.code] ?? GEO_ERRORS[2]); setLocating(false) },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
  }
  // AC 9.3.1: opening the check-in screen requests a fresh device location.
  // The unmount cleanup above invalidates any in-flight request, so a remount
  // simply asks again.
  useEffect(() => {
    locate()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the screen opens
  }, [eventId])

  if (event.isLoading) return <EventState text="Loading check-in…" />
  if (!event.data) {
    return event.error instanceof ApiError && event.error.status === 404
      ? <EventState error text="This event is not available." />
      : <EventState error text="This event is unavailable." retry={() => void event.refetch()} />
  }
  const closed = event.data.status !== 'published' || Boolean(event.data.hidden) || Date.now() > Date.parse(event.data.endAt)
  const accuracy = location?.coords.accuracy ?? null
  const usable = typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= ACCURACY_LIMIT_M
  const code = checkin.error instanceof ApiError ? checkin.error.code : null
  const rejection = code ? REJECTIONS[code] : null

  return (
    <section className="events-page event-narrow">
      <BackLink to={`/events/${eventId}`} state={routeLocation.state}>Back to event</BackLink>
      <header className="event-detail__header">
        <h2>Check in</h2>
        <p className="event-detail__host">{event.data.title} · {event.data.placeName ?? 'Mapped place'} · {formatEventTime(event.data.startAt)}–{formatEventTime(event.data.endAt)}</p>
      </header>

      {closed && <p className="event-banner" role="status">This event is not open for check-in. It may have ended, been cancelled or been hidden for review.</p>}
      {!closed && event.data.lastCheckinAt && (
        <p className="event-banner" role="status">
          You’re already checked in. <Link to={`/events/${eventId}/tasks`} replace state={routeLocation.state}>Open today’s task</Link>
        </p>
      )}
      <ol className="event-steps">
        <li className={location ? 'is-done' : 'is-current'}>
          <span className="event-steps__marker" aria-hidden>{location ? <Icon name="Check" size={15} /> : 1}</span>
          <div>
            <h3>Get your current location</h3>
            <p className="event-muted">A fresh location from your device. Coordinates cannot be typed or edited.</p>
            <button type="button" className={`event-button${location ? '' : ' event-button--primary'}`} disabled={locating || checkin.isPending} onClick={locate}>
              <Icon name="Crosshair" size={17} />{locating ? 'Getting location…' : location ? 'Get a new location' : 'Use my current location'}
            </button>
            {geoError && <p className="event-inline-alert" role="alert"><strong>Location:</strong> {geoError}</p>}
            {accuracy !== null && (
              <div className={`event-accuracy${usable ? ' is-ok' : ' is-weak'}`} role="status">
                <span>Measured accuracy</span>
                <strong>{Number.isFinite(accuracy) ? `±${Math.round(accuracy)} m` : 'Unavailable'}</strong>
                <small>{usable ? `Within the ${ACCURACY_LIMIT_M} m limit` : `Needs ${ACCURACY_LIMIT_M} m or better — move into the open and try again`}</small>
              </div>
            )}
          </div>
        </li>
        <li className={location && usable ? 'is-current' : ''}>
          <span className="event-steps__marker" aria-hidden>2</span>
          <div>
            <h3>Confirm check-in</h3>
            <p className="event-muted">We check the event time and that you are inside the event place. Checking in is not removal permission.</p>
            <button type="button" className="event-button event-button--primary" disabled={!location || !usable || locating || checkin.isPending} onClick={() => checkin.mutate()}>
              {checkin.isPending ? 'Checking in…' : 'Confirm check-in'}
            </button>
          </div>
        </li>
      </ol>
      {checkin.error && (
        <p className="event-inline-alert" role="alert">
          {rejection
            ? <><strong>{rejection.condition}:</strong> {rejection.message} You have not been checked in.</>
            : checkin.error instanceof ApiError && checkin.error.status === 429
              ? 'Too many check-in attempts. Wait a minute and try again. You have not been checked in.'
              : 'Check-in could not be completed. Check your connection and try again. You have not been checked in.'}
        </p>
      )}
    </section>
  )
}
