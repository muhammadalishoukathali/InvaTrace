import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BackLink } from '@/components/BackLink'
import { Icon } from '@/components/Icon'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { ApiError } from '@/services/api-client'
import { eventsApi, type CommunityEvent } from '@/services/api/events'
import { EventCard, EventState } from './EventCard'
import { eventContextStore } from './event-context'
import './events.css'

/** US 9.6 / 9.7: the host's own events - edit, restore after review, cancel. */
export function MyHostedEventsPage() {
  const cache = useQueryClient()
  const [cancelling, setCancelling] = useState<CommunityEvent | null>(null)
  const events = useQuery({ queryKey: ['events', 'mine'], queryFn: eventsApi.mine })
  const refresh = async (_: unknown, eventId: string) => {
    if (eventContextStore.getSnapshot()?.eventId === eventId) eventContextStore.clear()
    await Promise.all([
      cache.invalidateQueries({ queryKey: ['events'] }),
      cache.invalidateQueries({ queryKey: ['event', eventId] }),
      cache.invalidateQueries({ queryKey: ['event-summary', eventId] }),
    ])
  }
  const cancel = useMutation({ mutationFn: eventsApi.cancel, onSuccess: async (value, id) => { setCancelling(null); await refresh(value, id) } })
  const restore = useMutation({ mutationFn: eventsApi.restore, onSuccess: refresh })
  if (events.isLoading) return <EventState text="Loading your hosted events…" />
  if (!events.data) return <EventState error text="Your hosted events could not be loaded." retry={() => void events.refetch()} />
  const items = events.data.items

  return (
    <section className="events-page">
      <BackLink to="/events">Back to events</BackLink>
      <header className="events-intro">
        <div>
          <h2>Your hosted events</h2>
          <p>Drafts stay private until you publish them. If an event is hidden after community reports, review it and restore it or cancel it — hidden events left unchanged are cancelled after 14 days.</p>
        </div>
        <div className="events-intro__actions">
          <Link className="event-button event-button--primary" to="/events/host"><Icon name="CalendarDays" size={17} />Host an event</Link>
        </div>
      </header>

      {items.length ? (
        <ul className="events-list events-list--managed">
          {items.map((event) => (
            <li key={event.id}>
              <EventCard event={event} showStatus />
              <div className="event-manage">
                {['draft', 'published'].includes(event.status) && (
                  <Link className="event-button event-button--small" to={`/events/${event.id}/edit`}><Icon name="Pencil" size={15} />Edit</Link>
                )}
                {event.hidden && (event.canRestore ?? event.status !== 'cancelled') && (
                  <button type="button" className="event-button event-button--small" disabled={restore.isPending} onClick={() => restore.mutate(event.id)}>
                    <Icon name="RotateCcw" size={15} />Restore visibility
                  </button>
                )}
                {['draft', 'published'].includes(event.status) && (
                  <button type="button" className="event-button event-button--small event-button--danger" onClick={() => setCancelling(event)}>Cancel event</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <section className="events-empty">
          <span className="events-empty__icon" aria-hidden><Icon name="CalendarDays" size={26} /></span>
          <h3>No hosted events yet</h3>
          <p>Anyone can host. Choose a mapped place, a time and what the group will do.</p>
          <Link className="event-button event-button--primary" to="/events/host">Host your first event</Link>
        </section>
      )}
      {restore.error && <p className="event-inline-alert" role="alert">{restore.error instanceof ApiError ? restore.error.message : 'The event could not be restored. Try again.'}</p>}
      {cancelling && (
        <CancelDialog
          event={cancelling}
          pending={cancel.isPending}
          error={cancel.error ? 'The event could not be cancelled. Try again.' : null}
          onClose={() => { cancel.reset(); setCancelling(null) }}
          onConfirm={() => cancel.mutate(cancelling.id)}
        />
      )}
    </section>
  )
}

function CancelDialog({ event, pending, error, onClose, onConfirm }: {
  event: CommunityEvent
  pending: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogA11y(dialogRef, onClose)
  return createPortal(
    <div className="event-sheet">
      <div className="event-sheet__scrim" onClick={onClose} />
      <div ref={dialogRef} className="event-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="cancel-title" tabIndex={-1}>
        <header className="event-sheet__header">
          <h2 id="cancel-title">Cancel {event.title}?</h2>
          <button type="button" className="event-icon-button" onClick={onClose} aria-label="Close"><Icon name="X" size={20} /></button>
        </header>
        <div className="event-sheet__body">
          <p>The event leaves discovery and nobody new can join or check in. Reports already submitted and the people who joined are kept.</p>
          {error && <p className="event-inline-alert" role="alert">{error}</p>}
        </div>
        <footer className="event-sheet__footer">
          <button type="button" data-dialog-initial className="event-button" onClick={onClose}>Keep event</button>
          <button type="button" className="event-button event-button--danger-solid" disabled={pending} onClick={onConfirm}>{pending ? 'Cancelling…' : 'Cancel event'}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
