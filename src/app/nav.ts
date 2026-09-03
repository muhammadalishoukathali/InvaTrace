// I pulled the nav items out into one file because I originally had BottomTabs
// and Sidebar each hardcoding their own list, and they kept getting out of
// sync whenever I added a route. Now they both just read from here.
import type { Role } from '@/types'

export interface NavItem {
  id: string
  path: string
  label: string        // short label for the mobile tab bar, not much room there
  full: string         // longer label, used in the desktop sidebar instead
  icon: string         // just the Lucide icon name, not the component itself
  /** Which iteration of the project unlocks this page. Iteration 1 is what's
   *  actually working right now - the rest are just placeholders so the marker
   *  can see where things are heading, but they're not clickable yet. */
  iteration: 1 | 2 | 3
  /** Restricts a nav item to certain roles. Left undefined = everyone can see it. */
  roles?: Role[]
}

/** Order here is what both the mobile tabs and the sidebar show. Trying to keep
 *  positions stable across iterations so nothing jumps around between demos. */
export const NAV: NavItem[] = [
  { id: 'map',      path: '/map',      label: 'Map',      full: 'Threat map',   icon: 'MapPinned',    iteration: 1 },
  { id: 'reports',  path: '/reports',  label: 'Records',  full: 'My records',   icon: 'ClipboardList', iteration: 1 },
  // only add stuff here once the route actually exists, otherwise it just shows a dead link
]

export const isEnabled = (item: NavItem, role: Role): boolean =>
  item.iteration === 1 && (!item.roles || item.roles.includes(role))

export const visibleNav = (role: Role): NavItem[] =>
  // filters out anything not ready yet so we don't show buttons that go nowhere
  NAV.filter((i) => isEnabled(i, role))
