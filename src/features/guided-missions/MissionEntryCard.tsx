import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { ApiError } from '@/services/api-client'
import { guidedMissionsApi } from '@/services/api/guided-missions'
import { useHabitatIndex, useHabitatLookup } from './habitat-data'
import { missionPath } from './mission-context'
import './guided-missions.css'

/**
 * The guided-mission entry on a place page. AC 7.1.1: Start guided mission
 * with the watchlist count. AC 7.1.3: when the place has no overlay, say so,
 * keep the watchlist and show no start action. AC 7.6.2: Resume mission when
 * this identity already has an active one here.
 */
export function MissionEntryCard({ placeId, watchlistIds }: { placeId: string; watchlistIds: string[] }) {
  const index = useHabitatIndex()
  const lookup = useHabitatLookup()
  const supported = Boolean(index.data?.byId.get(placeId))
  const active = useQuery({
    queryKey: ['guided-mission', placeId],
    queryFn: async () => {
      try { return await guidedMissionsApi.active(placeId) } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    },
    enabled: supported,
  })
  if (index.isLoading || lookup.isLoading) return null
  if (index.isError || lookup.isError) {
    return <p className="mission-entry mission-entry--muted" role="status">Guided habitat highlights could not be loaded right now.</p>
  }
  if (!supported) {
    return (
      <p className="mission-entry mission-entry--muted" role="status">
        <Icon name="Map" size={17} />
        <span>Guided habitat highlights are unavailable for this place. The plant watchlist below is still available.</span>
      </p>
    )
  }
  const guided = watchlistIds.filter((id) => lookup.data?.get(id)?.length)
  if (!watchlistIds.length) return null
  const resuming = Boolean(active.data)
  return (
    <section className="mission-entry" aria-labelledby="mission-entry-title">
      <span className="mission-entry__icon" aria-hidden><Icon name="Route" size={22} /></span>
      <div>
        <h3 id="mission-entry-title">{resuming ? 'Your guided mission is in progress' : 'Guided habitat search'}</h3>
        <p>
          {watchlistIds.length} watchlist {watchlistIds.length === 1 ? 'plant' : 'plants'}
          {guided.length < watchlistIds.length && ` · ${guided.length} with habitat guidance`}.
          {' '}See which mapped habitats suit them before you visit. Highlights are search guidance, not confirmed plant locations.
        </p>
      </div>
      <Link className="mission-button mission-button--primary" to={missionPath(placeId)}>
        {resuming ? 'Resume mission' : 'Start guided mission'}
      </Link>
    </section>
  )
}
