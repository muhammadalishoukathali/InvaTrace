import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { EnglishDateTimeField } from '@/components/EnglishDateTimeField'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { api } from '@/services/api-client'
import { eventsApi } from '@/services/api/events'
import type { PlaceDetail } from '@/types'
import { parseLocalDateTime } from '@/utils/date-time'
import { EventCard, EventState } from './EventCard'
import { EventMap } from './EventMap'
import { SpeciesPicker } from './SpeciesPicker'
import './events.css'

type RangePreset = 'upcoming' | 'week' | 'month' | 'custom'
const RANGE_LABELS: Record<RangePreset, string> = {
  upcoming: 'All upcoming',
  week: 'Next 7 days',
  month: 'Next 30 days',
  custom: 'Custom dates',
}
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * US 9.1 discovery. The list and the map render from the same query result so
 * their counts always match (AC 9.1.4); the list is the accessible fallback for
 * the map. On phones the two are a List/Map toggle so the events are never
 * pushed below a wall of filters; on laptops they sit side by side.
 */
export function EventsDiscoveryPage() {
  const [params] = useSearchParams()
  const placeId = params.get('placeId') ?? undefined
  const isDesktop = useIsDesktop()
  const [preset, setPreset] = useState<RangePreset>('upcoming')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [species, setSpecies] = useState<string[]>([])
  const [bbox, setBbox] = useState<string>()
  const [view, setView] = useState<'list' | 'map'>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const range = useMemo(() => {
    if (preset === 'custom') return { from: parseLocalDateTime(from), to: parseLocalDateTime(to) }
    if (preset === 'upcoming') return { from: null, to: null }
    const now = new Date()
    return { from: null, to: new Date(now.getTime() + (preset === 'week' ? 7 : 30) * DAY_MS) }
  }, [preset, from, to])
  const invalidFields = preset === 'custom' && Boolean((from && !range.from) || (to && !range.to))
  const invalidOrder = Boolean(range.from && range.to && range.to <= range.from)
  const invalidDates = invalidFields || invalidOrder

  const place = useQuery({
    queryKey: ['place', placeId],
    queryFn: () => api<PlaceDetail>(`/api/v1/places/${placeId}`),
    enabled: Boolean(placeId),
  })
  // A place-scoped list ignores the map viewport: AC 9.1.6 wants every event
  // anchored to the followed place, not just the ones currently on screen.
  const scopedBbox = placeId ? undefined : bbox
  const events = useQuery({
    enabled: !invalidDates,
    queryKey: ['events', placeId, species, scopedBbox, range.from?.toISOString(), range.to?.toISOString()],
    placeholderData: keepPreviousData,
    queryFn: () => eventsApi.list({
      placeId, speciesId: species, bbox: scopedBbox,
      from: range.from?.toISOString(), to: range.to?.toISOString(),
    }),
  })
  const items = events.data?.items ?? []
  const filterSummary = [
    species.length ? `${species.length} species` : 'all species',
    RANGE_LABELS[preset].toLowerCase(),
    placeId ? (place.data?.displayName ?? 'selected place') : scopedBbox ? 'in the map area' : 'all places',
  ].join(' · ')
  const showList = isDesktop || view === 'list'
  const showMap = isDesktop || view === 'map'

  return (
    <section className="events-page events-discovery">
      <header className="events-intro">
        <div>
          <h2>{placeId && place.data ? `Events at ${place.data.displayName}` : 'Upcoming community events'}</h2>
          <p>Volunteer outings hosted by community members — not official or government operations.</p>
        </div>
        <div className="events-intro__actions">
          <Link className="event-button event-button--primary" to="/events/host">
            <Icon name="CalendarDays" size={17} />Host an event
          </Link>
          <Link className="event-button" to="/events/mine">Your hosted events</Link>
        </div>
      </header>

      {placeId && (
        <p className="events-scope">
          <Icon name="MapPin" size={16} />
          <span>Showing only events at {place.data?.displayName ?? 'this place'}.</span>
          <Link to="/events">Show all places</Link>
        </p>
      )}

      <div className="events-filters" role="group" aria-label="Event filters">
        <SpeciesPicker label="Target species" value={species} onChange={setSpecies} emptyLabel="All species" />
        <fieldset className="events-range">
          <legend>When</legend>
          <div className="event-segmented">
            {(Object.keys(RANGE_LABELS) as RangePreset[]).map((key) => (
              <button key={key} type="button" aria-pressed={preset === key} onClick={() => setPreset(key)}>
                {RANGE_LABELS[key]}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="events-range__custom">
              <EnglishDateTimeField label="From" value={from} onChange={setFrom} />
              <EnglishDateTimeField label="Until" value={to} onChange={setTo} />
            </div>
          )}
        </fieldset>
      </div>
      {invalidFields && <p className="event-inline-alert" role="alert">Enter valid filter dates using YYYY-MM-DD HH:mm, or use the date picker.</p>}
      {invalidOrder && <p className="event-inline-alert" role="alert">Until must be later than From. Adjust the dates to see matching events.</p>}

      <div className="events-results-bar">
        <p role="status" aria-live="polite" className="events-count">
          {invalidDates ? 'Fix the dates to search'
            : events.isLoading ? 'Searching…'
              : `${items.length} ${items.length === 1 ? 'event' : 'events'}`}
          <small className="events-count__summary">{filterSummary}</small>
          {events.isFetching && !events.isLoading && <span className="sr-only"> Updating results</span>}
        </p>
        {!isDesktop && (
          <div className="event-segmented event-segmented--compact" role="group" aria-label="Show events as">
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="ClipboardList" size={16} />List</button>
            <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}><Icon name="Map" size={16} />Map</button>
          </div>
        )}
      </div>

      {!invalidDates && events.isLoading && <EventState text="Loading upcoming events…" />}
      {!invalidDates && events.isError && !events.data && <EventState text="Upcoming events could not be loaded." retry={() => void events.refetch()} error />}
      {!invalidDates && events.data && (
        <div className={`events-layout${events.isFetching ? ' events-layout--updating' : ''}`}>
          {showList && (
            <div className="events-layout__list">
              {items.length ? (
                <ul className="events-list" aria-label="Upcoming events">
                  {items.map((event) => (
                    <li key={event.id}><EventCard event={event} highlighted={event.id === selectedId} /></li>
                  ))}
                </ul>
              ) : (
                <section className="events-empty">
                  <span className="events-empty__icon" aria-hidden><Icon name="CalendarDays" size={26} /></span>
                  <h3>No upcoming survey events found here</h3>
                  <p>This does not mean the area is free of invasive plants.</p>
                  <div className="events-empty__actions">
                    <Link className="event-button" to="/catalogue">Browse the plant catalogue</Link>
                    {placeId
                      ? <Link className="event-button" to={`/places/${placeId}`}>Adopt this area</Link>
                      : <Link className="event-button" to="/places">Adopt an area</Link>}
                  </div>
                </section>
              )}
            </div>
          )}
          {showMap && (
            <div className="events-layout__map">
              <EventMap
                events={items}
                onBoundsChange={setBbox}
                onSelect={(id) => {
                  setSelectedId(id)
                  if (!isDesktop) setView('list')
                  requestAnimationFrame(() => document.querySelector(`[data-event-id="${CSS.escape(id)}"] a`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
                }}
                selectedId={selectedId}
                label={`Map of ${items.length} upcoming events. The list shows the same events.`}
              />
              <p className="event-map__legend"><span className="event-marker-swatch" aria-hidden />Community event meeting point</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
