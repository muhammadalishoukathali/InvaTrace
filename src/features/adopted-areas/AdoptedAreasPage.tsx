import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/services/api-client'
import type { AdoptedAreaListResponse } from '@/types'
import './adopted-areas.css'

export function AdoptedAreasPage() {
  const queryClient = useQueryClient()
  const [sort, setSort] = useState<'recent' | 'name'>('recent')
  const query = useQuery({
    queryKey: ['adopted-areas', sort],
    queryFn: () => api<AdoptedAreaListResponse>(`/api/v1/adopted-areas?sort=${sort}`),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/v1/adopted-areas/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adopted-areas'] }),
  })

  if (query.isLoading) return <div className="areas-state" role="status">Loading monitoring areas…</div>
  if (query.isError || !query.data) {
    return (
      <div className="areas-state" role="alert">
        <strong>Monitoring areas could not be loaded.</strong>
        <button type="button" onClick={() => void query.refetch()}>Try again</button>
      </div>
    )
  }
  if (!query.data.items.length) {
    return (
      <section className="areas-state">
        <h2>No monitoring areas yet</h2>
        <p>Browse places to add a non-exclusive monitoring bookmark.</p>
        <Link to="/places">Browse places</Link>
        <small>{query.data.disclaimer}</small>
      </section>
    )
  }
  return (
    <section className="areas-page">
      <header>
        <div>
          <h2>Your monitoring bookmarks</h2>
          <p>{query.data.disclaimer}</p>
        </div>
        <label className="areas-sort">
          Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value as 'recent' | 'name')}>
            <option value="recent">Recent activity</option>
            <option value="name">Area name</option>
          </select>
        </label>
      </header>
      <div className="areas-list">
        {query.data.items.map((area) => (
          <article key={area.adoptionId}>
            <div className="areas-list__heading">
              <div>
                <h3>{area.name}</h3>
                <p>{area.type} · adopted {formatDate(area.adoptedAt)}</p>
                <p>
                  Most recent community report:{' '}
                  {area.mostRecentReportAt ? formatDate(area.mostRecentReportAt) : 'No reports'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Stop monitoring ${area.name}? Public reports and place data will not be deleted.`)) {
                    remove.mutate(area.adoptionId)
                  }
                }}
                disabled={remove.isPending}
              >
                Stop monitoring
              </button>
            </div>
            <h4>{area.metricsLabel}</h4>
            <dl className="areas-metrics">
              <Metric label="Active reports" value={area.metrics.activeReports} />
              <Metric label="Approved species" value={area.metrics.distinctApprovedSpecies} />
              <Metric label="New in 30 days" value={area.metrics.newReportsLast30Days} />
              <Metric label="Removal reports in 30 days" value={area.metrics.removalReportsLast30Days} />
              <Metric
                label="Days since most recent report"
                value={area.metrics.daysSinceMostRecentReport ?? 'No reports'}
              />
            </dl>
            <Link to={`/adopted-areas/${area.adoptionId}/activity`}>Open activity map</Link>
          </article>
        ))}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
  .format(new Date(value))
