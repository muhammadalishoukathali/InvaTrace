import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useOnline } from '@/hooks/useOnline'
import { api } from '@/services/api-client'
import type { PlaceDetail, PlacePlantAssociationsResponse } from '@/types'
import { PlaceGeometryMap } from './PlaceGeometryMap'
import './places.css'

export function PlaceDetailPage() {
  const { placeId } = useParams()
  const online = useOnline()
  const place = useQuery({
    queryKey: ['place', placeId],
    queryFn: () => api<PlaceDetail>(`/api/v1/places/${placeId}`),
    enabled: Boolean(placeId) && online,
  })
  const associations = useQuery({
    queryKey: ['place-associations', placeId],
    queryFn: () => api<PlacePlantAssociationsResponse>(`/api/v1/places/${placeId}/plant-associations`),
    enabled: Boolean(placeId) && online,
  })
  const adopt = useMutation({
    mutationFn: () => api<{ adoptionId: string }>(
      '/api/v1/adopted-areas',
      { method: 'POST', body: JSON.stringify({ placeId }) },
    ),
  })

  if (!online) return (
    <div className="places-state" role="status">
      Mapped place geometry and current association evidence need a connection.
      {' '}<Link to="/catalogue">Open offline catalogue</Link>
    </div>
  )
  if (place.isLoading || associations.isLoading) return <div className="places-state" role="status">Loading place evidence…</div>
  if (place.isError || associations.isError || !place.data || !associations.data) {
    return <div className="places-state" role="alert">This place or its occurrence data is unavailable.</div>
  }
  return (
    <section className="place-detail">
      <Link to="/places">Back to places</Link>
      <header>
        <div>
          <h2>{place.data.displayName}</h2>
          <p>{place.data.placeType} · {place.data.source} · geometry {place.data.geometryVersion}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Adopt ${place.data.displayName} for monitoring? This is a non-exclusive bookmark and does not grant removal permission.`)) {
              adopt.mutate()
            }
          }}
          disabled={adopt.isPending || adopt.isSuccess}
        >
          {adopt.isSuccess ? 'Adopted for monitoring' : adopt.isPending ? 'Adding…' : 'Adopt for monitoring'}
        </button>
      </header>
      <p className="place-detail__notice">
        Adding a bookmark is non-exclusive and does not create ownership, responsibility,
        access rights, or permission to remove plants.
      </p>
      <PlaceGeometryMap geometry={place.data.geometry} name={place.data.displayName} />
      {associations.data.items.length === 0 ? (
        <div className="places-state">
          <strong>No qualifying historical records found</strong>
          <p>Historical observations do not guarantee current presence.</p>
          <Link to="/catalogue">Browse the full catalogue</Link>
        </div>
      ) : (
        <ol className="place-associations">
          {associations.data.items.map((item) => (
            <li key={item.speciesId}>
              <div className="place-associations__heading">
                {item.imageUrl && (
                  <img src={item.imageUrl} alt={`Reference view of ${item.scientificName}`} loading="lazy" />
                )}
                <div>
                  <h3><i>{item.scientificName}</i></h3>
                  <p>{item.commonNames.join(' · ')} · Present in Malaysia</p>
                </div>
              </div>
              <dl>
                <div><dt>Historical records</dt><dd>{item.occurrenceCount}</dd></div>
                <div><dt>Most recent year</dt><dd>{item.mostRecentYear ?? 'Not recorded'}</dd></div>
                <div>
                  <dt>Closest evidence</dt>
                  <dd>{item.evidence.types.includes('inside_boundary')
                    ? 'Inside mapped area'
                    : `${Math.round(item.evidence.nearestDistanceM)} m`}</dd>
                </div>
                <div><dt>Evidence</dt><dd>{item.evidence.types.map(evidenceLabel).join(' · ')}</dd></div>
              </dl>
              <p className="place-associations__provenance">
                Historical observations do not guarantee current presence.
                {' '}Occurrence data updated {associations.data.occurrenceUpdatedAt
                  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(associations.data.occurrenceUpdatedAt))
                  : 'date unavailable'}.
              </p>
              <Link to={`/catalogue/${item.speciesId}`}>View catalogue entry</Link>
            </li>
          ))}
        </ol>
      )}
      <footer>
        <p>{associations.data.disclaimer}</p>
        <p>
          Occurrence data {associations.data.processedDataVersions.join(', ') || 'version unavailable'}
          {associations.data.occurrenceUpdatedAt
            ? ` · updated ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(associations.data.occurrenceUpdatedAt))}`
            : ''}
        </p>
      </footer>
    </section>
  )
}

const evidenceLabel = (value: string) => ({
  inside_boundary: 'inside boundary',
  nearby_buffer: 'nearby mapped buffer',
  trail_buffer: 'along trail buffer',
  upstream: 'upstream on mapped directed waterway',
}[value] ?? value)
