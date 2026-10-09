import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { eventsApi } from '@/services/api/events'
import { eventTypeLabels } from './event-types'
import { formatEventWindow } from './event-format'
import './events.css'
import { HostEventLink } from './HostEventGate'

/**
 * AC 9.1.6: on an adopted (followed) area, list the published upcoming events
 * anchored to that place, so a follower learns about surveys there. Reuses
 * GET /api/v1/places/{place_id}/events. No notifications in the MVP.
 */
export function PlaceEventsSection({ placeId, placeName }: { placeId: string; placeName: string }) {
  const events = useQuery({ queryKey: ['events', 'place', placeId], queryFn: () => eventsApi.place(placeId), enabled: Boolean(placeId) })
  return (
    <section className="place-events" aria-labelledby="place-events-title">
      <h3 id="place-events-title"><Icon name="CalendarDays" size={16} />Upcoming community events here</h3>
      {events.isLoading && <p className="event-muted" role="status">Loading events…</p>}
      {events.isError && <p className="event-muted" role="alert">Events for this place could not be loaded. <button type="button" className="event-text-button" onClick={() => void events.refetch()}>Try again</button></p>}
      {events.data && (events.data.items.length ? (
        <ul>
          {events.data.items.slice(0, 4).map((event) => (
            <li key={event.id}>
              <Link to={`/events/${event.id}`}>
                <strong>{event.title}</strong>
                <span>{eventTypeLabels[event.eventType]} · {formatEventWindow(event.startAt, event.endAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="event-muted">No upcoming events at {placeName} yet. <HostEventLink inline>Host one</HostEventLink></p>
      ))}
      {events.data && events.data.items.length > 4 && <Link to={`/events?placeId=${placeId}`}>See all {events.data.items.length} events</Link>}
    </section>
  )
}
