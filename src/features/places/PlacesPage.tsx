import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useOnline } from '@/hooks/useOnline'
import { api } from '@/services/api-client'
import type { PlaceSummary } from '@/types'
import './places.css'

export function PlacesPage() {
  const online = useOnline()
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['places'],
    queryFn: () => api<{ items: PlaceSummary[] }>('/api/v1/places'),
    enabled: online,
  })
  const normalized = search.trim().toLocaleLowerCase()
  const places = useMemo(() => (query.data?.items ?? []).filter((place) => (
    !normalized
    || place.displayName.toLocaleLowerCase().includes(normalized)
    || place.placeType.toLocaleLowerCase().includes(normalized)
  )), [normalized, query.data?.items])
  if (!online) {
    return (
      <section className="places-page">
        <header><h2>Browse mapped places</h2></header>
        <div className="places-state" role="status">
          Mapped places and current association data need a connection. The offline plant catalogue remains available.
          {' '}<Link to="/catalogue">Open offline catalogue</Link>
        </div>
      </section>
    )
  }
  if (query.isLoading) return <div className="places-state" role="status">Loading mapped places…</div>
  if (query.isError || !query.data) {
    return <div className="places-state" role="alert">Mapped places are temporarily unavailable.</div>
  }
  return (
    <section className="places-page">
      <header>
        <h2>Browse mapped places</h2>
        <p>Select a named park, forest or trail to view historical occurrence associations.</p>
      </header>
      <label className="places-search">
        <span>Search places</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search park, forest or trail"
        />
        {search && <button type="button" onClick={() => setSearch('')}>Clear search</button>}
      </label>
      {!query.data.items.length ? (
        <div className="places-state">No supported mapped places are available in this dataset.</div>
      ) : !places.length ? (
        <div className="places-state" role="status">
          No mapped places match this search.{' '}
          <button type="button" onClick={() => setSearch('')}>Clear search</button>
        </div>
      ) : (
        <ul className="places-list">
          {places.map((place) => (
            <li key={place.placeId}>
              <Link to={`/places/${place.placeId}`}>
                <span><strong>{place.displayName}</strong><small>{place.placeType}</small></span>
                <span className="places-list__source">{place.source} · geometry {place.geometryVersion}</span>
                <strong className="places-list__action">View plants recorded nearby</strong>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
