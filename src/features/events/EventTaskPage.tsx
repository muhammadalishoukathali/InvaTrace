import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { findApprovedSpecies } from '@shared/catalogue'
import { BackLink } from '@/components/BackLink'
import { Icon } from '@/components/Icon'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { scanStateFromPath } from '@/features/scan/scan-navigation'
import { eventsApi, type CommunityEvent } from '@/services/api/events'
import { eventContextStore, useEventContext } from './event-context'
import { EventState } from './EventCard'
import { EventSafetyNotice } from './EventSafetyNotice'
import { eventTypeLabels } from './event-types'
import { formatEventTime, speciesName } from './event-format'
import './events.css'

/**
 * AC 9.3.4: after check-in, the session task for this event's type. Every type
 * offers the same find-and-record scan; removal guidance only ever appears
 * inside the scan result after the Epic 3.0 permission and protected-area
 * checks pass for that person at that spot.
 */
export function EventTaskPage() {
  const { eventId = '' } = useParams()
  const active = useEventContext()
  const profileId = usePrivateAccess((state) => state.profile?.id)
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

  if (event.isLoading) return <EventState text="Opening event tasks…" />
  if (!event.data) return <EventState error text="This event is unavailable." retry={() => void event.refetch()} />
  const item = event.data
  if (item.status !== 'published' || item.hidden || Date.now() > Date.parse(item.endAt)) {
    return (
      <section className="events-page event-narrow">
        <BackLink to={`/events/${eventId}`}>Back to event</BackLink>
        <div className="events-empty">
          <h3>This event has ended or is unavailable</h3>
          <p>Scans you already captured during the event can still be submitted from My Records within the upload window.</p>
          <Link className="event-button" to="/reports">Open My Records</Link>
        </div>
      </section>
    )
  }
  if (active?.eventId !== eventId && !item.lastCheckinAt) {
    return (
      <section className="events-page event-narrow">
        <BackLink to={`/events/${eventId}`}>Back to event</BackLink>
        <div className="events-empty">
          <span className="events-empty__icon" aria-hidden><Icon name="Crosshair" size={26} /></span>
          <h3>Check in first</h3>
          <p>Check in with a fresh location so your observations can be tagged to this event. You can still scan and report as normal without checking in.</p>
          <div className="events-empty__actions">
            <Link className="event-button event-button--primary" to={`/events/${eventId}/check-in`}>Check in</Link>
            <Link className="event-button" to="/scan" state={scanStateFromPath(`/events/${eventId}`)}>Scan without the event</Link>
          </div>
        </div>
      </section>
    )
  }

  const scanState = scanStateFromPath(`/events/${eventId}/tasks`)
  return (
    <section className="events-page event-narrow">
      <BackLink to={`/events/${eventId}`}>Back to event</BackLink>
      <header className="event-detail__header">
        <div className="event-card__tags">
          <span className={`event-type event-type--${item.eventType}`}>{eventTypeLabels[item.eventType]}</span>
          <span className="event-checked-in"><Icon name="CircleCheck" size={15} />Checked in</span>
        </div>
        <h2>Today’s task</h2>
        <p className="event-detail__host">{item.title} · until {formatEventTime(item.endAt)}</p>
      </header>

      <section className="event-task">
        <TaskSteps event={item} />
        <Link className="event-button event-button--primary event-button--block event-task__scan" to="/scan" state={scanState}>
          <Icon name="ScanLine" size={18} />Start a scan
        </Link>
        <p className="event-muted">A scan stays on your device. Nothing is reported until you choose <strong>Submit to this event</strong>.</p>
      </section>

      <section className="event-uncertainty">
        <h3><Icon name="HelpCircle" size={17} />Identification is a prediction</h3>
        <p>A scan result is the model’s best guess, not a confirmed identification. Check the reference photos, and choose “not sure” when you are unsure.</p>
      </section>
      <EventSafetyNotice event={item} compact />
    </section>
  )
}

function TaskSteps({ event }: { event: CommunityEvent }) {
  if (event.eventType === 'removal') {
    return (
      <>
        <h3>Removal activity — permission first</h3>
        <ol className="event-task__list">
          <li>Scan each plant before touching it.</li>
          <li>Open the safe-response guidance in the scan result. It checks the protected-area boundary and asks whether the land manager has given you permission.</li>
          <li>Removal and disposal steps appear there only after those checks pass, for you, at that spot. If they do not pass, observe and report only.</li>
        </ol>
        <TargetPlants event={event} />
      </>
    )
  }
  if (event.eventType === 'monitoring') {
    return (
      <>
        <h3>Repeat monitoring</h3>
        <ol className="event-task__list">
          <li>Revisit earlier sightings at this place, especially grey markers that still need a follow-up.</li>
          <li>Scan what you find and record the result, including when you find no regrowth.</li>
        </ol>
        <p><Link to="/map?status=followup-needed"><Icon name="Map" size={15} />Show sightings that need a follow-up</Link></p>
        <TargetPlants event={event} />
      </>
    )
  }
  return (
    <>
      <h3>{event.eventType === 'survey' ? 'Find and record' : 'Your activity'}</h3>
      {event.eventType === 'other' && <p className="event-purpose">{event.purpose}</p>}
      <ol className="event-task__list">
        <li>Walk the area with the group and look for the plants below.</li>
        <li>Scan each possible plant and compare it with the reference photos.</li>
        <li>Submit what you find to this event. Only report what you actually see.</li>
      </ol>
      <TargetPlants event={event} />
    </>
  )
}

function TargetPlants({ event }: { event: CommunityEvent }) {
  if (!event.targetSpeciesIds.length) return <p className="event-muted">No specific target plants — record any supported invasive plant.</p>
  return (
    <ul className="event-target-plants" aria-label="Plants to look for">
      {event.targetSpeciesIds.map((id) => {
        const record = findApprovedSpecies({ speciesId: id })
        return (
          <li key={id}>
            <Link to={`/catalogue/${id}`}>
              <strong>{speciesName(id)}</strong>
              {record && <i>{record.scientific_name}</i>}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
