import { useId, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { eventsApi } from '@/services/api/events'

/** AC 9.6.1: hosting unlocks once the identity has reported enough sightings. */
export function useHostEligibility() {
  return useQuery({ queryKey: ['events', 'host-eligibility'], queryFn: () => eventsApi.hostEligibility(), staleTime: 60_000 })
}

export function hostingLockedText(reportCount: number, required: number) {
  return `Report ${required} sightings to unlock hosting (${Math.min(reportCount, required)}/${required} so far).`
}

/**
 * A "Host an event" link that becomes a disabled button with progress while the
 * identity is below the sighting requirement. The API still enforces the rule
 * (403 hosting_locked); this only saves people from a form they cannot submit.
 */
export function HostEventLink({ className, children, inline = false }: { className?: string; children: ReactNode; inline?: boolean }) {
  const eligibility = useHostEligibility()
  const hintId = useId()
  // While loading or on a failed check, keep the normal link; the host page re-checks.
  if (!eligibility.data || eligibility.data.eligible) return <Link className={className} to="/events/host">{children}</Link>
  const { reportCount, required } = eligibility.data
  if (inline) return <span className="host-locked-inline">{children} (unlocks after {required} sightings, {Math.min(reportCount, required)}/{required} so far)</span>
  return (
    <span className="host-locked">
      <button type="button" className={className} disabled aria-describedby={hintId}>
        <Icon name="Lock" size={16} />{children}
      </button>
      <small id={hintId} className="event-muted">{hostingLockedText(reportCount, required)} <Link to="/scan">Scan a plant</Link></small>
    </span>
  )
}

/** Full-page panel for /events/host when hosting is still locked (covers deep links). */
export function HostingLockedPanel({ reportCount, required }: { reportCount: number; required: number }) {
  return (
    <section className="events-empty" role="status">
      <span className="events-empty__icon" aria-hidden><Icon name="Lock" size={26} /></span>
      <h3>Hosting unlocks after {required} sightings</h3>
      <p>
        You have reported {Math.min(reportCount, required)} of {required}. Hosts are people who already know how to spot and
        report invasive plants, so report a few sightings first.
      </p>
      <progress max={required} value={Math.min(reportCount, required)} aria-label="Sightings reported" />
      <Link className="event-button event-button--primary" to="/scan"><Icon name="Camera" size={17} />Scan a plant</Link>
    </section>
  )
}
