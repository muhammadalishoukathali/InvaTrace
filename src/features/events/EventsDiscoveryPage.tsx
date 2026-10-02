import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { approvedSpeciesDataset } from '@shared/catalogue'
import { eventsApi } from '@/services/api/events'
import { EventCard } from './EventCard'
import { EventMap } from './EventMap'
import './events.css'

export function EventsDiscoveryPage() {
  const [params] = useSearchParams()
  const placeId = params.get('placeId') ?? undefined
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [species, setSpecies] = useState<string[]>([])
  const [bbox, setBbox] = useState<string>()
  const invalidDates = Boolean(from && to && Date.parse(to) <= Date.parse(from))
  const events = useQuery({ enabled: !invalidDates, queryKey: ['events', placeId, species, bbox, from, to], placeholderData: keepPreviousData, queryFn: () => eventsApi.list({ placeId, speciesId: species, bbox, from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to).toISOString() : undefined }) })
  return <section className="events-page"><header className="events-heading"><div><h1>Community events</h1><p>Find upcoming surveys and repeat monitoring at mapped places.</p></div><div className="event-heading-actions"><Link to="/events/mine">Your hosted events</Link><Link className="event-primary" to="/events/host">Host an event</Link></div></header>
    <label className="event-filter">Filter by target species<select multiple value={species} onChange={(e) => setSpecies(Array.from(e.currentTarget.selectedOptions, option => option.value))} aria-describedby="species-help">
      {approvedSpeciesDataset.records.map((item) => <option key={item.species_id} value={item.species_id}>{item.common_names[0] ?? item.scientific_name} — {item.scientific_name}</option>)}</select><small id="species-help">Choose one or more species. Leave blank to show all events.</small></label>
    <div className="event-date-filters"><label>From<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Until<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></label></div>
    {placeId && <p>Showing events for your selected mapped place. <Link to="/events">Show all places</Link></p>}
    {invalidDates && <p role="alert">Until must be later than From. Adjust the dates to see matching events.</p>}
    {!invalidDates && events.isFetching && !events.isLoading && <p role="status">Updating matching events…</p>}
    {!invalidDates && events.isLoading && <State text="Loading upcoming events…" />}
    {!invalidDates && events.isError && <State text="Upcoming events could not be loaded." retry={() => void events.refetch()} error />}
    {!invalidDates && events.data && <EventMap events={events.data.items} onBoundsChange={setBbox} label="Upcoming events map" />}
    {!invalidDates && events.data && (events.data.items.length ? <div className="events-list">{events.data.items.map((event) => <EventCard key={event.id} event={event} />)}</div> : <section className="events-empty"><h2>No upcoming events match these filters</h2><p>There are no published community events to show yet. Try a different species filter or check again later.</p><Link to="/events/host">Host a community event</Link></section>)}
  </section>
}
export function State({ text, retry, error = false }: { text: string; retry?: () => void; error?: boolean }) { return <div className="events-state" role={error ? 'alert' : 'status'}>{text}{retry && <button onClick={retry}>Try again</button>}</div> }
