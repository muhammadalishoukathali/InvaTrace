import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '@/services/api-client'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { eventsApi } from '@/services/api/events'
import { eventContextStore } from './event-context'
import { State } from './EventsDiscoveryPage'

export function EventCheckInPage() {
  const { eventId = '' } = useParams(); const cache = useQueryClient(); const navigate = useNavigate(); const profileId = usePrivateAccess(state => state.profile?.id)
  const [location, setLocation] = useState<GeolocationPosition | null>(null); const [geoError, setGeoError] = useState(''); const [locating, setLocating] = useState(false); const request = useRef(0)
  useEffect(() => () => { request.current += 1 }, [eventId])
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => eventsApi.get(eventId) })
  const checkin = useMutation({ mutationFn: () => eventsApi.checkIn(eventId, { latitude: location!.coords.latitude, longitude: location!.coords.longitude, accuracyM: location!.coords.accuracy, capturedAt: new Date(location!.timestamp).toISOString() }), onSuccess: async result => { if (event.data) eventContextStore.checkIn({ eventId: event.data.id, startAt: event.data.startAt, endAt: event.data.endAt, profileId }, result.checkedInAt); await cache.invalidateQueries({ queryKey: ['event', eventId] }); navigate(`/events/${eventId}/tasks`) } })
  const locate = () => {
    if (!navigator.geolocation) { setGeoError('Location is unavailable on this device. Use a device with location services enabled.'); return }
    const id = ++request.current; setLocating(true); setLocation(null); setGeoError('')
    navigator.geolocation.getCurrentPosition(position => { if (request.current !== id) return; setLocation(position); setLocating(false) }, () => { if (request.current !== id) return; setGeoError('Location is unavailable. Allow location access and try again.'); setLocating(false) }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 })
  }
  if (event.isLoading) return <State text="Loading check-in…" />
  if (!event.data) return <State error text="This event is unavailable." />
  const accuracy = location?.coords.accuracy ?? null; const usable = typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 250
  const code = checkin.error instanceof ApiError ? checkin.error.code : null
  const messages: Record<string, string> = { location_unavailable: 'Location is unavailable. Turn on location services and try again.', accuracy_too_low: 'Your location is not accurate enough. Wait for an accuracy of 250 m or better.', outside_place: 'Your location is outside the mapped event place.', outside_time_window: 'Check-in is available from 30 minutes before the event until it ends.', event_not_published: 'This event is no longer open for check-in.', fresh_location_required: 'Your saved location is no longer fresh. Get a new location and try again.', event_geometry_stale: 'The event’s place boundary has changed. Contact the host before checking in again.' }
  return <section className="events-page event-work"><Link className="back-link" to={`/events/${eventId}`}>Back to event</Link><h1>Check in at {event.data.title}</h1><p>Use a fresh location. Check-in records your attendance and does not grant removal permission.</p><button className="event-primary" disabled={locating || checkin.isPending} onClick={locate}>{locating ? 'Getting location…' : 'Use my current location'}</button>{geoError && <p role="alert">{geoError}</p>}{accuracy !== null && <p className="event-location">Location accuracy: {Number.isFinite(accuracy) ? `${Math.round(accuracy)} m ${usable ? '— ready to check in' : '— wait for 250 m or better'}` : 'unavailable — get a new location'}</p>}<button disabled={!location || !usable || locating || checkin.isPending} onClick={() => checkin.mutate()}>{checkin.isPending ? 'Checking in…' : 'Confirm check-in'}</button>{checkin.error && <p role="alert">{code ? (messages[code] ?? 'Check-in could not be completed.') : 'Check-in could not be completed. Check your connection and try again.'}</p>}</section>
}
