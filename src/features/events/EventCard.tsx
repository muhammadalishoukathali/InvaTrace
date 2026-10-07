import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import type { CommunityEvent } from '@/services/api/events'
import { eventTypeLabels } from './event-types'
import {
  eventDateTile, formatEventWindow, hostLabel, placeTypeLabels, statusLabels, targetSpeciesNames,
} from './event-format'

const MAX_SPECIES_CHIPS = 3

/**
 * One event in a list. Every card carries what AC 9.1.1-9.1.3 ask for: title,
 * place and place type, date and time, event type, target species, and a clear
 * "community activity" label so nobody reads it as an official operation.
 * The whole card is one link, so it is a single tab stop and a large touch
 * target.
 */
export function EventCard({ event, showStatus = false, highlighted = false }: {
  event: CommunityEvent
  showStatus?: boolean
  highlighted?: boolean
}) {
  const tile = eventDateTile(event.startAt)
  const species = targetSpeciesNames(event)
  const extraSpecies = species.length - MAX_SPECIES_CHIPS
  return (
    <article className={`event-card${highlighted ? ' event-card--highlighted' : ''}`} data-event-id={event.id}>
      <Link to={`/events/${event.id}`} className="event-card__link">
        <span className="event-card__date" aria-hidden>
          <span>{tile.month}</span>
          <strong>{tile.day}</strong>
        </span>
        <span className="event-card__body">
          <span className="event-card__tags">
            <span className={`event-type event-type--${event.eventType}`}>{eventTypeLabels[event.eventType]}</span>
            <span className="event-community">Community activity</span>
            {showStatus && (
              <span className={`event-status event-status--${event.status}`}>
                {statusLabels[event.status]}{event.hidden ? ' · hidden' : ''}
              </span>
            )}
          </span>
          <strong className="event-card__title">{event.title}</strong>
          <span className="event-card__meta">
            <Icon name="Clock" size={15} />
            <span>{formatEventWindow(event.startAt, event.endAt)}</span>
          </span>
          <span className="event-card__meta">
            <Icon name="MapPin" size={15} />
            <span>
              {event.placeName ?? 'Mapped place'}
              {event.placeType && <span className="event-card__place-type"> · {placeTypeLabels[event.placeType]}</span>}
            </span>
          </span>
          <span className="event-card__species" aria-label={species.length ? `Target species: ${species.join(', ')}` : 'All watchlist plants'}>
            {species.length === 0
              ? <span className="event-chip event-chip--quiet">All watchlist plants</span>
              : species.slice(0, MAX_SPECIES_CHIPS).map((name) => <span key={name} className="event-chip">{name}</span>)}
            {extraSpecies > 0 && <span className="event-chip event-chip--quiet">+{extraSpecies} more</span>}
          </span>
          <span className="event-card__host">Hosted by {hostLabel(event)}, a community member</span>
        </span>
        <Icon name="ChevronRight" size={18} />
      </Link>
    </article>
  )
}

/** Loading, error and retry panel shared by every event screen. */
export function EventState({ text, retry, error = false }: { text: string; retry?: () => void; error?: boolean }) {
  return (
    <div className="events-state" role={error ? 'alert' : 'status'}>
      {!error && <span className="events-state__spinner" aria-hidden />}
      <p>{text}</p>
      {retry && <button type="button" className="event-button" onClick={retry}>Try again</button>}
    </div>
  )
}
