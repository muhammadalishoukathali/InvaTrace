import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { eventsApi } from '@/services/api/events'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { eventContextStore, useEventContext } from './event-context'
import { State } from './EventsDiscoveryPage'
import { eventTypeGuidance } from './event-types'
import { scanStateFromPath } from '@/features/scan/scan-navigation'

export function EventTaskPage() {
  const { eventId = '' } = useParams()
  const active = useEventContext()
  const profileId = usePrivateAccess(state => state.profile?.id)
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => eventsApi.get(eventId) })
  // A recovered identity may have a server-side check-in but no event context
  // on this device. Restore only the current viewer's check-in.
  useEffect(() => {
    const item = event.data
    if (item?.lastCheckinAt && item.status === 'published' && !item.hidden
      && Date.now() <= Date.parse(item.endAt) && profileId && active?.eventId !== eventId) {
      eventContextStore.checkIn({ eventId: item.id, startAt: item.startAt, endAt: item.endAt, profileId }, item.lastCheckinAt)
    }
  }, [event.data, active?.eventId, eventId, profileId])
  if (event.isLoading) return <State text="Opening event tasks…" />
  if (!event.data) return <State error text="This event is unavailable." />
  if (event.data.status !== 'published' || event.data.hidden || Date.now() > Date.parse(event.data.endAt)) return <section className="events-page event-work"><h1>This event has ended or is unavailable</h1><p>You can still submit previously captured scans within the upload window from your saved scan.</p><Link to={`/events/${eventId}`}>Back to event</Link></section>
  if (active?.eventId !== eventId && !event.data.lastCheckinAt) return <section className="events-page event-work"><h1>Check-in needed</h1><p>Check in with a fresh location before starting event tasks.</p><Link className="event-primary" to={`/events/${eventId}/check-in`}>Check in</Link></section>
  return <section className="events-page event-work"><Link className="back-link" to={`/events/${eventId}`}>Back to event</Link><h1>{event.data.title}</h1><p>{eventTypeGuidance[event.data.eventType]}</p><section className="event-notice"><strong>Before you scan</strong><p>Record only what you observe. A scan stays on your device until you explicitly submit a report.</p></section><Link className="event-primary" to="/scan" state={scanStateFromPath(`/events/${eventId}/tasks`)}>Start scan</Link></section>
}
