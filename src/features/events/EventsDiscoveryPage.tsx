import { useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { api } from '@/services/api-client'
import { eventsApi } from '@/services/api/events'
import type { PlaceDetail } from '@/types'
import { DateRangeDialog, dayRangeWindow, formatDayRange, type DayRange } from './DateRangeCalendar'
import { EventCard, EventState } from './EventCard'
import { EventMap } from './EventMap'
import { SpeciesPicker } from './SpeciesPicker'
import './events.css'
import { HostEventLink } from './HostEventGate'

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
  // Filters and the List/Map choice live in the URL so Back from an event
  // returns to the same filtered list (and they can be shared or reloaded).
  const [params, setParams] = useSearchParams()
  const placeId = params.get('placeId') ?? undefined
  const isDesktop = useIsDesktop()
  const preset = parsePreset(params.get('range'))
  const days = useMemo<DayRange>(() => ({ start: parseDay(params.get('from')), end: parseDay(params.get('to')) }), [params])
  const speciesParam = params.get('species') ?? ''
  const species = useMemo(() => speciesParam ? speciesParam.split(',').filter(Boolean) : [], [speciesParam])
  const view: 'list' | 'map' = params.get('view') === 'map' ? 'map' : 'list'
  const update = (changes: Record<string, string | null>) => setParams((previous) => {
    const next = new URLSearchParams(previous)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    return next
  }, { replace: true })
  const setPreset = (value: RangePreset) => update({ range: value === 'upcoming' ? null : value, ...(value === 'custom' ? {} : { from: null, to: null }) })
  const setSpecies = (value: string[]) => update({ species: value.length ? value.join(',') : null })
  const setView = (value: 'list' | 'map') => update({ view: value === 'map' ? 'map' : null })
  const [bbox, setBbox] = useState<string>()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [datesOpen, setDatesOpen] = useState(false)
  const customRef = useRef<HTMLButtonElement>(null)

  const range = useMemo(() => {
    if (preset === 'custom') return dayRangeWindow(days)
    if (preset === 'upcoming') return { from: null, to: null }
    const now = new Date()
    return { from: null, to: new Date(now.getTime() + (preset === 'week' ? 7 : 30) * DAY_MS) }
  }, [preset, days])

  const place = useQuery({
    queryKey: ['place', placeId],
    queryFn: () => api<PlaceDetail>(`/api/v1/places/${placeId}`),
    enabled: Boolean(placeId),
  })
  // A place-scoped list ignores the map viewport: AC 9.1.6 wants every event
  // anchored to the followed place, not just the ones currently on screen.
  const scopedBbox = placeId ? undefined : bbox
  const events = useQuery({
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
    preset === 'custom' && days.start ? formatDayRange(days) : RANGE_LABELS[preset].toLowerCase(),
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
          <HostEventLink className="event-button event-button--primary">
            <Icon name="CalendarDays" size={17} />Host an event
          </HostEventLink>
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
            {(Object.keys(RANGE_LABELS) as RangePreset[]).map((key) => key === 'custom' ? (
              <button key={key} ref={customRef} type="button" aria-pressed={preset === key} aria-haspopup="dialog" onClick={() => setDatesOpen(true)}>
                <Icon name="CalendarDays" size={15} />
                {preset === 'custom' && days.start ? formatDayRange(days) : RANGE_LABELS[key]}
              </button>
            ) : (
              <button key={key} type="button" aria-pressed={preset === key} onClick={() => setPreset(key)}>
                {RANGE_LABELS[key]}
              </button>
            ))}
          </div>
          {datesOpen && (
            <DateRangeDialog
              initial={days}
              onClose={() => setDatesOpen(false)}
              onApply={(next) => { update({ range: 'custom', from: formatDay(next.start), to: formatDay(next.end) }); setDatesOpen(false) }}
              returnFocus={() => customRef.current}
            />
          )}
        </fieldset>
      </div>

      <div className="events-results-bar">
        <p role="status" aria-live="polite" className="events-count">
          {events.isLoading ? 'Searching…'
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

      {events.isLoading && <EventState text="Loading upcoming events…" />}
      {events.isError && !events.data && <EventState text="Upcoming events could not be loaded." retry={() => void events.refetch()} error />}
      {events.data && (
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

function parsePreset(value: string | null): RangePreset {
  return value === 'week' || value === 'month' || value === 'custom' ? value : 'upcoming'
}

function parseDay(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDay(value: Date | null): string | null {
  if (!value) return null
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
