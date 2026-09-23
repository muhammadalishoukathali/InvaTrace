import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'

/**
 * One shared back path for detail screens. Testers kept losing their way
 * returning from a catalogue entry, a place, a scan result or a record because
 * every page hand-rolled its own back link (or had none), so the affordance
 * looked different or was missing depending where you were (UT-06). This gives
 * every detail screen the same visible, touch-sized back control.
 */
export function BackLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="back-link">
      <Icon name="ChevronLeft" size={17} color="currentColor" />
      <span>{children}</span>
    </Link>
  )
}
