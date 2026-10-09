import { useId, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { eventsApi } from '@/services/api/events'
import { useOrigin } from './event-navigation'

/** AC 9.6.1: hosting unlocks once the identity has reported enough sightings. */
export function useHostEligibility() {
  return useQuery({ queryKey: ['events', 'host-eligibility'], queryFn: () => eventsApi.hostEligibility(), staleTime: 60_000 })
}

export function hostingLockedText(reportCount: number, required: number) {
  return `Report ${required} sightings to unlock hosting (${Math.min(reportCount, required)}/${required} so far).`
}

/**
 * A "Host an event" link that becomes a disabled button while the identity is
 * below the sighting requirement, followed by a full-width progress note. The
 * API still enforces the rule (403 hosting_locked); this only saves people from
 * a form they cannot submit. While the gate is switched off server-side the
 * eligibility check always passes, so only the plain link renders.
 */
export function HostEventLink({ className, icon, children, inline = false }: { className?: string; icon?: string; children: ReactNode; inline?: boolean }) {
  const eligibility = useHostEligibility()
  const hintId = useId()
  const origin = useOrigin()
  // While loading or on a failed check, keep the normal link; the host page re-checks.
  if (!eligibility.data || eligibility.data.eligible) {
    return <Link className={className} to="/events/host" state={origin}>{icon && <Icon name={icon} size={17} />}{children}</Link>
  }
  const { reportCount, required } = eligibility.data
  const done = Math.min(reportCount, required)
  if (inline) return <span className="host-locked-inline">{children} (unlocks after {required} sightings, {done}/{required} so far)</span>
  return (
    <>
      <button type="button" className={className} disabled aria-describedby={hintId}>
        <Icon name="Lock" size={16} />{children}
      </button>
      <p id={hintId} className="host-locked-note">
        <span className="host-locked-note__text">
          <strong>{hostingLockedText(reportCount, required)}</strong>
          <progress max={required} value={done} aria-label="Sightings reported" />
        </span>
        <Link to="/scan" className="host-locked-note__action"><Icon name="Camera" size={16} />Scan a plant</Link>
      </p>
    </>
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
