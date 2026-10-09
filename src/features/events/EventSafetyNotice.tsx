import { useId } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import type { CommunityEvent } from '@/services/api/events'
import { speciesName } from './event-format'

/**
 * The AC 9.2.4 / 9.6.5 / 9.6.7 wording: taking part is never removal permission. Used
 * on the event detail, the join confirmation and the task view so the message
 * is word-for-word the same everywhere, with the Epic 3.0 guidance one tap
 * away.
 */
export function EventSafetyNotice({ event, compact = false }: {
  event: Pick<CommunityEvent, 'eventType' | 'landStatus' | 'protectedAreaName' | 'safetyNotes' | 'targetSpeciesIds'>
  compact?: boolean
}) {
  // The detail page and its join dialog both render this notice; keep ids unique.
  const titleId = useId()
  return (
    <section className="event-safety" aria-labelledby={titleId}>
      <h3 id={titleId}><Icon name="ShieldAlert" size={18} />Permission and safety</h3>
      <p>
        <strong>Joining {event.eventType === 'removal' ? 'this removal event' : 'an event'} is not permission to remove any plant or to enter restricted land.</strong>
        {' '}Any removal still depends on the InvaTrace permission and protected-area checks, which run for each person at each location on the day.
      </p>
      {!compact && (
        <p>
          {event.landStatus === 'protected'
            ? `This place overlaps a mapped protected area${event.protectedAreaName ? ` (${event.protectedAreaName})` : ''}. Observe and report only.`
            : event.landStatus === 'not_protected'
              ? 'This place is not in a mapped protected area. That is not ownership or access permission — confirm the site rules yourself before acting.'
              : 'The protected-area status of this place could not be confirmed. Observe and report only.'}
        </p>
      )}
      {!compact && event.safetyNotes && (
        <div className="event-safety__host">
          <strong>Host safety notes</strong>
          <p>{event.safetyNotes}</p>
        </div>
      )}
      <SafeGuidanceLinks speciesIds={event.targetSpeciesIds} />
    </section>
  )
}

function SafeGuidanceLinks({ speciesIds }: { speciesIds: string[] }) {
  if (!speciesIds.length) {
    return <p className="event-safety__links"><Link to="/catalogue">Open safe-response guidance in the plant catalogue</Link></p>
  }
  return (
    <p className="event-safety__links">
      <span>Safe-response and permission guidance:</span>
      {speciesIds.map((id) => <Link key={id} to={`/catalogue/${id}`}>{speciesName(id)}</Link>)}
    </p>
  )
}
