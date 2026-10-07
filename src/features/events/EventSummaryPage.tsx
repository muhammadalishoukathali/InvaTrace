import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { BackLink } from '@/components/BackLink'
import { Icon } from '@/components/Icon'
import { api, ApiError } from '@/services/api-client'
import { eventsApi } from '@/services/api/events'
import { EventState } from './EventCard'
import { formatEventDay, formatEventTime } from './event-format'
import './events.css'

/**
 * US 9.5: a plain record of what the event submitted. It counts activity and
 * nothing more - no health score, no "improvement" (AC 9.5.2).
 */
export function EventSummaryPage() {
  const { eventId = '' } = useParams()
  const cache = useQueryClient()
  const summary = useQuery({ queryKey: ['event-summary', eventId], queryFn: () => eventsApi.summary(eventId) })
  const adoptions = useQuery({
    queryKey: ['adopted-areas'],
    queryFn: () => api<{ items: Array<{ placeId: string }> }>('/api/v1/adopted-areas'),
  })
  const follow = useMutation({
    mutationFn: () => api('/api/v1/adopted-areas', { method: 'POST', body: JSON.stringify({ placeId: summary.data!.placeId }) }),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['adopted-areas'] }),
  })
  if (summary.isLoading) return <EventState text="Loading event summary…" />
  if (!summary.data) {
    const status = summary.error instanceof ApiError ? summary.error.status : null
    if (status === 409) return <EventState error text="The summary is available once the event has ended." />
    if (status === 404) return <EventState error text="This event is not available." />
    return <EventState error text="This event summary is unavailable." retry={() => void summary.refetch()} />
  }
  const item = summary.data
  const alreadyAdopted = follow.isSuccess
    || adoptions.data?.items.some((adoption) => adoption.placeId === item.placeId)
    || (follow.error instanceof ApiError && follow.error.status === 409)

  return (
    <section className="events-page event-narrow">
      <BackLink to={`/events/${eventId}`}>Back to event</BackLink>
      <header className="event-detail__header">
        <span className="event-community">Community survey activity</span>
        <h2>What this event recorded</h2>
        <p className="event-detail__host">{item.placeName} · {formatEventDay(item.startAt)}, {formatEventTime(item.startAt)}–{formatEventTime(item.endAt)}</p>
      </header>

      <dl className="event-stats">
        <div><dt>Screened reports submitted</dt><dd>{item.reportsSubmittedCount}</dd></div>
        <div><dt>Different species recorded</dt><dd>{item.distinctSpeciesCount}</dd></div>
      </dl>
      <p className="event-muted">
        Counts of community reports captured during the event, excluding rejected or deleted ones. They describe activity only — not expert-verified, and not a measure of the place’s health, invasion density or removal.
      </p>

      <section className="event-section event-follow">
        <h3>Keep watching {item.placeName}</h3>
        <p>Adds it to your monitoring areas. A shared bookmark — no ownership or removal permission.</p>
        <button type="button" className="event-button event-button--primary" disabled={follow.isPending || alreadyAdopted} onClick={() => follow.mutate()}>
          {alreadyAdopted ? <><Icon name="CircleCheck" size={17} />Adopted</> : follow.isPending ? 'Adding…' : 'Follow this area for monitoring'}
        </button>
        {follow.error && !alreadyAdopted && <p className="event-inline-alert" role="alert">This area could not be followed. Try again.</p>}
      </section>

      <section className="event-section">
        <h3>Next survey here</h3>
        {item.nextEvent ? (
          <Link className="event-next" to={`/events/${item.nextEvent.eventId}`}>
            <Icon name="CalendarDays" size={18} />
            <span><strong>Next event</strong>{formatEventDay(item.nextEvent.startAt)} · {formatEventTime(item.nextEvent.startAt)}</span>
            <Icon name="ChevronRight" size={18} />
          </Link>
        ) : (
          <p className="event-muted">No later event has been published for this place yet. Follow the area to keep an eye on it, or <Link to="/events/host">host the next one</Link>.</p>
        )}
      </section>
    </section>
  )
}
