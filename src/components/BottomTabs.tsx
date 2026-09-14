import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from './Icon'
import { visibleNav } from '@/app/nav'
import { scanStateFromPath } from '@/features/scan/scan-navigation'
import type { Role } from '@/types'
import './bottom-tabs.css'

/**
 * Bottom bar for mobile with just the one big Scan button. AppShell only
 * mounts this on the map screen at narrow widths - I didn't want a full
 * tab bar since the map is meant to stay visible underneath, so it's really
 * just the single primary action rather than a proper tab set.
 */
export function BottomTabs({ role }: { role: Role }) {
  const location = useLocation()
  const items = visibleNav(role)
  const permanentItems = items.filter((item) => item.id !== 'places')
  const places = items.find((item) => item.id === 'places')
  return (
    <div className="bottom-tabs-shell">
      {places && (
        <NavLink to={places.path} className="bottom-tabs__places-shortcut">
          <Icon name={places.icon} size={17} color="currentColor" />
          Browse places
        </NavLink>
      )}
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
        {permanentItems.slice(2, 4).map((item) => (
          <NavLink key={item.id} to={item.path} className={({ isActive }) => `bottom-tab${isActive ? ' bottom-tab--active' : ''}`}>
            <span className="bottom-tab__icon"><Icon name={item.icon} size={20} color="currentColor" /></span>
            <span className="bottom-tab__label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
