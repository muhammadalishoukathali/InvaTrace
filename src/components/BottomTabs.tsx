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
  // Two destinations either side of Scan keeps the bar symmetric. Places lives
  // in the map controls cluster, and adopted areas are reached from the
  // profile and Places pages; both stay in the desktop sidebar.
  const permanentItems = items.filter((item) => item.id !== 'places' && item.id !== 'areas')
  return (
    <div className="bottom-tabs-shell">
      <nav aria-label="Primary" className="bottom-tabs">
        {permanentItems.slice(0, 2).map((item) => (
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
        {permanentItems.slice(2).map((item) => (
          <NavLink key={item.id} to={item.path} className={({ isActive }) => `bottom-tab${isActive ? ' bottom-tab--active' : ''}`}>
            <span className="bottom-tab__icon"><Icon name={item.icon} size={20} color="currentColor" /></span>
            <span className="bottom-tab__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
