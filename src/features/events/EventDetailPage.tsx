import { PlantLoader } from '@/components/PlantLoader'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router-dom'
import { BackLink } from '@/components/BackLink'
import { Icon } from '@/components/Icon'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { ApiError } from '@/services/api-client'
import { eventsApi, type CommunityEvent } from '@/services/api/events'
import { eventTypeGuidance, eventTypeLabels } from './event-types'
import { EventState } from './EventCard'
import { EventMap } from './EventMap'
import { EventSafetyNotice } from './EventSafetyNotice'
import { ReportEventModal } from './ReportEventModal'
import { eventContextStore, useEventContext } from './event-context'
import { backTarget } from './event-navigation'
import {
  formatEventDay, formatEventDays, formatEventTime, hostLabel, placeTypeLabels, targetSpeciesNames,
} from './event-format'
import './events.css'

/** US 9.2: everything needed before committing, then join anonymously. */
export function EventDetailPage() {
  const { eventId = '' } = useParams()
  const cache = useQueryClient()
  const location = useLocation()
  const active = useEventContext()
  const [flagOpen, setFlagOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [flagSent, setFlagSent] = useState(false)
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => eventsApi.get(eventId), enabled: Boolean(eventId) })
  const join = useMutation({
    mutationFn: () => eventsApi.join(eventId),
    onSuccess: () => { setConfirmOpen(false); return cache.invalidateQueries({ queryKey: ['event', eventId] }) },
    // A 409 means the event was cancelled, completed or hidden meanwhile; refresh so the page says so.
    onError: () => cache.invalidateQueries({ queryKey: ['event', eventId] }),
  })
  const withdraw = useMutation({
    mutationFn: () => eventsApi.withdraw(eventId, event.data!.participationId!),
    onSuccess: () => {
      if (eventContextStore.getSnapshot()?.eventId === eventId) eventContextStore.clear()
      return cache.invalidateQueries({ queryKey: ['event', eventId] })
    },
  })

  if (event.isLoading) return <EventState text="Loading event details…" />
  if (event.error instanceof ApiError && event.error.status === 404) {
    return <EventState error text="This event is not available. It may be a private draft or hidden for review." />
  }
  if (event.isError || !event.data) return <EventState error text="This event could not be loaded." retry={() => void event.refetch()} />
  const item = event.data
  const species = targetSpeciesNames(item)
  const open = item.status === 'published' && !item.hidden
  const ended = Date.now() > Date.parse(item.endAt)
  // AC 9.2.6: the host and joined participants see the chat link, never once
  // the event is hidden or cancelled (the API also withholds it).
  // Once checked in (on this device or restored from the server) the next step
  // is the task screen, not another check-in.
  const checkedIn = active?.eventId === item.id || Boolean(item.lastCheckinAt)
  const showChat = Boolean(item.chatLink) && (item.isJoined || item.isHost) && item.status !== 'cancelled' && !item.hidden

  return (
    <section className="events-page event-detail">
      <BackLink {...backTarget(location.state, '/events')} />

      <header className="event-detail__header">
        <div className="event-card__tags">
          <span className={`event-type event-type--${item.eventType}`}>{eventTypeLabels[item.eventType]}</span>
          <span className="event-community">Community activity · not an official operation</span>
        </div>
        <h2>{item.title}</h2>
        <p className="event-detail__host">Hosted by {hostLabel(item)}, a community member</p>
      </header>

      {item.hidden && (
        <p className="event-banner event-banner--warning" role="status">
          This event is hidden after community safety reports. {item.canRestore ? 'Review the details in your hosted events before restoring visibility.' : 'Its history is kept while it is reviewed.'}
        </p>
      )}
      {item.status === 'cancelled' && <p className="event-banner" role="status">This event has been cancelled. Its attendance and report history are kept.</p>}
      {item.status === 'draft' && <p className="event-banner" role="status">Private draft — nobody else can find this event until you publish it.</p>}
      {item.status === 'completed' && <p className="event-banner" role="status">This event has ended. <Link to={`/events/${item.id}/summary`} state={location.state}>See what it recorded</Link></p>}

      <div className="event-detail__layout">
        <div className="event-detail__main">
          <section className="event-section">
            <h3>What we will do</h3>
            <p className="event-purpose">{item.purpose}</p>
            <p className="event-type-guidance"><Icon name="Info" size={16} />{eventTypeGuidance[item.eventType]}</p>
          </section>

          <section className="event-section">
            <h3>Target plants</h3>
            {species.length ? (
              <ul className="event-species-list">
                {item.targetSpeciesIds.map((id, index) => (
                  <li key={id}><Link to={`/catalogue/${id}`}>{species[index] ?? id}</Link></li>
                ))}
              </ul>
            ) : <p className="event-muted">No specific plants — record any supported invasive plant you find.</p>}
          </section>

          <section className="event-section">
            <h3>Meeting point</h3>
            <p className="event-meeting">
              <Icon name="MapPin" size={17} />
              <span>
                <strong>{item.placeName ?? 'Mapped place'}</strong>
                {item.placeType && <span className="event-muted"> · {placeTypeLabels[item.placeType]}</span>}
                {item.meetingNote && <span className="event-meeting__note">{item.meetingNote}</span>}
              </span>
            </p>
            <EventMap events={[item]} label={`Meeting point for ${item.title} at ${item.placeName ?? 'the mapped place'}`} className="event-map-wrap--detail" />
          </section>

          <EventSafetyNotice event={item} />
        </div>

        <aside className="event-action-card" aria-label="Attend this event">
          <dl className="event-when">
            <div><dt>Date</dt><dd>{formatEventDays(item.startAt, item.endAt)}</dd></div>
            <div><dt>Time</dt><dd>{formatEventTime(item.startAt)} – {formatEventTime(item.endAt)} <span className="event-muted">your local time</span></dd></div>
            <div><dt>Going</dt><dd>{item.joinedCount ?? 0} joined</dd></div>
          </dl>

          {open && !ended && (item.isJoined ? (
            <div className="event-joined">
              {checkedIn ? (
                <>
                  <p className="event-joined__state" role="status"><Icon name="CircleCheck" size={18} />Checked in</p>
                  <Link className="event-button event-button--primary event-button--block" to={`/events/${item.id}/tasks`} state={location.state}>
                    <Icon name="ClipboardList" size={17} />Open today’s task
                  </Link>
                </>
              ) : (
                <>
                  <p className="event-joined__state" role="status"><Icon name="CircleCheck" size={18} />Joined</p>
                  <p className="event-muted">Check in when you arrive on the day.</p>
                  <Link className="event-button event-button--primary event-button--block" to={`/events/${item.id}/check-in`} state={location.state}>
                    <Icon name="Crosshair" size={17} />Check in at the event
                  </Link>
                </>
              )}
              <button type="button" className="event-button event-button--block" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
                {withdraw.isPending ? <PlantLoader compact label="Withdrawing…" /> : 'Withdraw'}
              </button>
            </div>
          ) : (
            <div className="event-joined">
              <button type="button" className="event-button event-button--primary event-button--block" onClick={() => setConfirmOpen(true)} disabled={join.isPending}>
                Join this event
              </button>
              <p className="event-muted">No name, email or password needed.</p>
            </div>
          ))}
          {open && ended && <p className="event-muted">This event has finished.</p>}

          {showChat && (
            <div className="event-chat">
              <a href={item.chatLink!} target="_blank" rel="noopener noreferrer" className="event-button event-button--block">
                <Icon name="ExternalLink" size={16} />Open the group chat
              </a>
              <p className="event-muted">Opens outside InvaTrace. The chat is run by the host, not by InvaTrace.</p>
            </div>
          )}

          {withdraw.error && <p className="event-inline-alert" role="alert">Could not withdraw from this event. Try again.</p>}
          {join.error && !confirmOpen && <p className="event-inline-alert" role="alert">{join.error instanceof ApiError ? join.error.message : 'Could not join this event.'}</p>}

          <div className="event-action-card__links">
            {item.isHost && <Link to={`/events/${item.id}/edit`} state={location.state}><Icon name="Pencil" size={15} />Edit event</Link>}
            {item.status === 'completed' && <Link to={`/events/${item.id}/summary`} state={location.state}>View event summary</Link>}
            {!item.isHost && open && (flagSent
              ? <span className="event-muted" role="status">Thanks — your report was recorded.</span>
              : <button type="button" className="event-text-button" onClick={() => setFlagOpen(true)}><Icon name="AlertTriangle" size={15} />Report this event</button>)}
          </div>
        </aside>
      </div>

      {confirmOpen && (
        <JoinConfirmDialog
          event={item}
          pending={join.isPending}
          error={join.error ? (join.error instanceof ApiError ? join.error.message : 'Could not join this event.') : null}
          onCancel={() => { join.reset(); setConfirmOpen(false) }}
          onConfirm={() => join.mutate()}
        />
      )}
      {flagOpen && <ReportEventModal eventId={item.id} onClose={() => setFlagOpen(false)} onSent={() => { setFlagOpen(false); setFlagSent(true) }} />}
    </section>
  )
}

function JoinConfirmDialog({ event, pending, error, onCancel, onConfirm }: {
  event: CommunityEvent
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogA11y(dialogRef, onCancel)
  return createPortal(
    <div className="event-sheet">
      <div className="event-sheet__scrim" onClick={onCancel} />
      <div ref={dialogRef} className="event-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="join-title" tabIndex={-1}>
        <header className="event-sheet__header">
          <h2 id="join-title">Join {event.title}?</h2>
          <button type="button" className="event-icon-button" onClick={onCancel} aria-label="Close"><Icon name="X" size={20} /></button>
        </header>
        <div className="event-sheet__body">
          <p>{formatEventDay(event.startAt)}, {formatEventTime(event.startAt)} – {formatEventTime(event.endAt)} at {event.placeName ?? 'the mapped place'}.</p>
          <EventSafetyNotice event={event} compact />
          {error && <p className="event-inline-alert" role="alert">{error}</p>}
        </div>
        <footer className="event-sheet__footer">
          <button type="button" className="event-button" onClick={onCancel}>Not now</button>
          <button type="button" data-dialog-initial className="event-button event-button--primary" onClick={onConfirm} disabled={pending}>
            {pending ? <PlantLoader compact label="Joining…" /> : 'Join this event'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
