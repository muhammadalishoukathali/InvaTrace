import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { Icon } from './Icon'
import { visibleNav, type NavItem } from '@/app/nav'
import { scanStateFromPath } from '@/features/scan/scan-navigation'
import { profileStateFromPath } from '@/features/private-access/profile-navigation'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import type { Role } from '@/types'
import './bottom-tabs.css'

// Destinations that get their own slot in the bar. Everything else, plus
// Profile, lives behind the More tab so the header can stay title-only.
const BAR_IDS = ['map', 'reports', 'areas']
const PROFILE_ITEM: NavItem = {
  id: 'profile', path: '/profile', label: 'Profile', full: 'My profile', icon: 'User', iteration: 1,
}

function Tab({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.path} className={({ isActive }) => `bottom-tab${isActive ? ' bottom-tab--active' : ''}`}>
      <span className="bottom-tab__icon"><Icon name={item.icon} size={20} color="currentColor" /></span>
      <span className="bottom-tab__label">{item.label}</span>
    </NavLink>
  )
}

/** Shared mobile navigation with the scan action between the destinations. */
export function BottomTabs({ role }: { role: Role }) {
  const location = useLocation()
  const { pathname } = location
  const items = visibleNav(role)
  const barItems = items.filter((item) => BAR_IDS.includes(item.id))
  const moreItems = [...items.filter((item) => !BAR_IDS.includes(item.id)), PROFILE_ITEM]
  const half = Math.ceil(barItems.length / 2)
  const moreActive = moreItems.some((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))

  const [moreOpen, setMoreOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  useDialogA11y(sheetRef, () => setMoreOpen(false), {
    active: moreOpen,
    returnFocus: () => moreButtonRef.current,
  })
  // Picking a destination navigates; close the sheet behind it.
  useEffect(() => { setMoreOpen(false) }, [pathname])

  return (
    <div className="bottom-tabs-shell">
      {moreOpen && (
        <>
          {/* Portalled: the shell's transform would otherwise clip a fixed backdrop. */}
          {createPortal(
            <div className="bottom-tabs__more-backdrop" aria-hidden onClick={() => setMoreOpen(false)} />,
            document.body,
          )}
          <div
            ref={sheetRef}
            id="bottom-tabs-more"
            role="dialog"
            aria-modal="true"
            aria-label="More destinations"
            tabIndex={-1}
            className="bottom-tabs__more"
          >
            {moreItems.map((item) => (
              <NavLink
                key={item.id}
                to={item.path}
                state={item.id === 'profile' ? profileStateFromPath(pathname) : undefined}
                className={({ isActive }) => `bottom-tabs__more-item${isActive ? ' bottom-tabs__more-item--active' : ''}`}
              >
                <Icon name={item.icon} size={19} color="currentColor" />
                <span>{item.full}</span>
                <Icon name="ChevronRight" size={16} color="currentColor" />
              </NavLink>
            ))}
          </div>
        </>
      )}
      <nav aria-label="Primary" className="bottom-tabs">
        {barItems.slice(0, half).map((item) => <Tab key={item.id} item={item} />)}
        <NavLink
          to="/scan"
          state={scanStateFromPath(pathname)}
          aria-label="Scan a plant"
          className="bottom-tabs__scan"
        >
          <span className="bottom-tabs__scan-icon" aria-hidden>
            <Icon name="ScanLine" size={23} color="#fff" strokeWidth={2.15} />
          </span>
          <span>Scan</span>
        </NavLink>
        {barItems.slice(half).map((item) => <Tab key={item.id} item={item} />)}
        <button
          ref={moreButtonRef}
          type="button"
          className={`bottom-tab${moreActive || moreOpen ? ' bottom-tab--active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          aria-controls="bottom-tabs-more"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className="bottom-tab__icon"><Icon name="Menu" size={20} color="currentColor" /></span>
          <span className="bottom-tab__label">More</span>
        </button>
      </nav>
    </div>
  )
}
