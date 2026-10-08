import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from './Icon'
import { visibleNav } from '@/app/nav'
import { scanStateFromPath } from '@/features/scan/scan-navigation'
import type { Role } from '@/types'
import './bottom-tabs.css'

/** Shared mobile navigation with the scan action between the destinations. */
export function BottomTabs({ role }: { role: Role }) {
  const location = useLocation()
  const items = visibleNav(role)
  // Three destinations either side of Scan keeps the bar symmetric: exploring
  // (Map, Places, Plants) on the left, the user's own records, adopted areas
  // and events on the right. Order comes from NAV, shared with the sidebar.
  const half = Math.ceil(items.length / 2)
  return (
    <div className="bottom-tabs-shell">
      <nav aria-label="Primary" className="bottom-tabs">
        {items.slice(0, half).map((item) => (
          <NavLink key={item.id} to={item.path} className={({ isActive }) => `bottom-tab${isActive ? ' bottom-tab--active' : ''}`}>
            <span className="bottom-tab__icon"><Icon name={item.icon} size={20} color="currentColor" /></span>
            <span className="bottom-tab__label">{item.label}</span>
          </NavLink>
        ))}
        <NavLink
          to="/scan"
          state={scanStateFromPath(location.pathname)}
          aria-label="Scan a plant"
          className="bottom-tabs__scan"
        >
          <span className="bottom-tabs__scan-icon" aria-hidden>
            <Icon name="ScanLine" size={23} color="#fff" strokeWidth={2.15} />
          </span>
          <span>Scan</span>
        </NavLink>
        {items.slice(half).map((item) => (
          <NavLink key={item.id} to={item.path} className={({ isActive }) => `bottom-tab${isActive ? ' bottom-tab--active' : ''}`}>
            <span className="bottom-tab__icon"><Icon name={item.icon} size={20} color="currentColor" /></span>
            <span className="bottom-tab__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
