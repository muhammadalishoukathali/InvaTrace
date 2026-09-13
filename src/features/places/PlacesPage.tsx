import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/services/api-client'
import type { PlaceDetail } from '@/types'
import './places.css'

export function PlacesPage() {
  const query = useQuery({
    queryKey: ['places'],
    queryFn: () => api<{ items: PlaceDetail[] }>('/api/v1/places'),
  })
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
      {!query.data.items.length ? (
        <div className="places-state">No supported mapped places are available in this dataset.</div>
      ) : (
        <ul className="places-list">
          {query.data.items.map((place) => (
            <li key={place.placeId}>
              <Link to={`/places/${place.placeId}`}>
                <span><strong>{place.displayName}</strong><small>{place.placeType}</small></span>
                <span>{place.source} · geometry {place.geometryVersion}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
