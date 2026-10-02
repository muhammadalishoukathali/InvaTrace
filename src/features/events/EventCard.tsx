import { ENGLISH_LOCALE } from '@/utils/date-time'
import { Link } from 'react-router-dom'
import type { CommunityEvent } from '@/services/api/events'
import { eventTypeLabels } from './event-types'

export function EventCard({ event }: { event: CommunityEvent }) {
  return <article className="event-card">
    <div><span className="event-badge">{eventTypeLabels[event.eventType]}</span><h3>{event.title}</h3>
      <p>{event.status === 'published' ? 'Published' : event.status === 'draft' ? 'Draft' : event.status === 'cancelled' ? 'Cancelled' : 'Completed'}{event.hidden ? ' · Hidden — review required' : ''}</p><p>Hosted by {event.hostDisplayName ?? 'Community host'}</p><p>{event.placeName ?? 'Mapped place'} · {formatTime(event.startAt)}</p></div>
    <Link to={`/events/${event.id}`}>View event</Link>
  </article>
}
export const formatTime = (value: string) => new Intl.DateTimeFormat(ENGLISH_LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
