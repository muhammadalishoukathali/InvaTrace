import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { scanStateFromPath } from '@/features/scan/scan-navigation'
import './bottom-tabs.css'

/**
 * Bottom bar for mobile with just the one big Scan button. AppShell only
 * mounts this on the map screen at narrow widths - I didn't want a full
 * tab bar since the map is meant to stay visible underneath, so it's really
 * just the single primary action rather than a proper tab set.
 */
export function BottomTabs() {
  return (
    <div className="bottom-tabs-shell">
      <nav aria-label="Primary" className="bottom-tabs bottom-tabs--scan-only">
        <NavLink
          to="/scan"
          state={scanStateFromPath('/map')}
          aria-label="Scan a plant"
          className="bottom-tabs__scan"
        >
          <span className="bottom-tabs__scan-icon" aria-hidden>
            <Icon name="ScanLine" size={23} color="#fff" strokeWidth={2.15} />
          </span>
          <span>Scan</span>
        </NavLink>
      </nav>
    </div>
  )
}
