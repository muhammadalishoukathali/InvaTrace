import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '@/services/api-client'
import { eventsApi } from '@/services/api/events'
import { eventTypeGuidance, eventTypeLabels } from './event-types'
import { formatTime } from './EventCard'
import { State } from './EventsDiscoveryPage'
import { ReportEventModal } from './ReportEventModal'
import { EventMap } from './EventMap'
import { approvedSpeciesDataset } from '@shared/catalogue'
import { eventContextStore } from './event-context'
import { useState } from 'react'
import './events.css'
export function EventDetailPage() {
  const { eventId = '' } = useParams(); const cache = useQueryClient(); const [flag, setFlag] = useState(false)
  const event = useQuery({ queryKey: ['event', eventId], queryFn: () => eventsApi.get(eventId), enabled: Boolean(eventId) })
  const join = useMutation({ mutationFn: () => eventsApi.join(eventId), onSuccess: () => cache.invalidateQueries({ queryKey: ['event', eventId] }) })
  const withdraw = useMutation({ mutationFn: () => eventsApi.withdraw(eventId, event.data!.participationId!), onSuccess: () => { if (eventContextStore.getSnapshot()?.eventId === eventId) eventContextStore.clear(); return cache.invalidateQueries({ queryKey: ['event', eventId] }) } })
  if (event.isLoading) return <State text="Loading event details…" />
  if (event.isError || !event.data) return <State error text="This event could not be loaded." retry={() => void event.refetch()} />
  const item = event.data
  return <section className="events-page event-detail"><Link to="/events" className="back-link">Back to events</Link><span className="event-badge">{eventTypeLabels[item.eventType]}</span><h1>{item.title}</h1>{item.hidden && <p className="event-notice" role="status">This event is hidden after community safety reports. {item.canRestore ? 'Review the details in your hosted events before restoring visibility.' : 'Its safety report history is retained.'}</p>}{item.status === 'cancelled' && <p className="event-notice" role="status">This event has been cancelled. Its attendance and report history are retained.</p>}{item.status === 'draft' && <p role="status">Private draft — participants cannot discover this event yet.</p>}<p className="event-purpose">{item.purpose}</p>
    <dl className="event-facts"><div><dt>Where</dt><dd>{item.placeName ?? 'Mapped place'}{item.meetingNote ? ` — ${item.meetingNote}` : ''}</dd></div><div><dt>When</dt><dd>{formatTime(item.startAt)} to {formatTime(item.endAt)}</dd></div><div><dt>Host</dt><dd>{item.hostDisplayName ?? 'Community host'}</dd></div><div><dt>Participants</dt><dd>{item.joinedCount ?? 0} joined</dd></div></dl>
    <EventMap events={[item]} label={`Meeting point for ${item.title}`} />
    <section className="event-notice"><strong>Permission and safety</strong><p>{item.permissionContext === 'explicit_permission' ? 'The host has recorded an explicit permission context. Confirm the site rules yourself before acting.' : 'Permission has not been confirmed. Joining is not removal permission.'}</p>{item.safetyNotes && <p>{item.safetyNotes}</p>}</section>
    <p className="event-guidance">{eventTypeGuidance[item.eventType]}</p>
    {item.targetSpeciesIds.length > 0 && <p><strong>Target species:</strong> {item.targetSpeciesIds.map(id => approvedSpeciesDataset.records.find(record => record.species_id === id)?.common_names[0] ?? id).join(', ')}</p>}
    <div className="event-actions">{item.status === 'published' && !item.hidden && (item.isJoined ? <><button onClick={() => withdraw.mutate()} disabled={withdraw.isPending}> {withdraw.isPending ? 'Withdrawing…' : 'Withdraw from event'}</button><Link className="event-primary" to={`/events/${item.id}/check-in`}>Check in</Link></> : <button className="event-primary" onClick={() => { if (window.confirm('Join this community event? Joining does not grant removal permission.')) join.mutate() }} disabled={join.isPending}>{join.isPending ? 'Joining…' : 'Join event'}</button>)}
      {item.chatLink && <a href={item.chatLink} target="_blank" rel="noreferrer">Open event chat</a>} {!item.isHost && <button className="event-link" onClick={() => setFlag(true)}>Report this event</button>}</div>
    {withdraw.error && <p role="alert">Could not withdraw from this event. Try again.</p>}{join.error && <p role="alert">{join.error instanceof ApiError ? join.error.message : 'Could not join this event.'}</p>}{flag && <ReportEventModal eventId={item.id} onClose={() => setFlag(false)} />}
    {item.status === 'completed' && <Link to={`/events/${item.id}/summary`}>View event summary</Link>}{item.isHost && <Link to={`/events/${item.id}/edit`}>Edit event</Link>}
  </section>
}
