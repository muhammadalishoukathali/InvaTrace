import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BottomTabs } from './BottomTabs'
import { ReportQueueStatusBanner } from '@/features/report/ReportQueueStatusBanner'
import { ErrorBoundary } from './ErrorBoundary'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { NAV } from '@/app/nav'
import { Icon } from './Icon'
import { profileReturnPath, profileStateFromPath } from '@/features/private-access/profile-navigation'
import './app-shell.css'

const TITLES: Record<string, [string, string]> = {
  '/map': ['Live threat map', 'Bukit Kiara · updated 2 hours ago'],
  '/profile': ['My profile', 'Identity, recovery and device access'],
  '/reports': ['My records', 'Your submitted field reports'],
  '/catalogue': ['Plant catalogue', '32 evidence-reviewed invasive plants'],
  '/adopted-areas': ['Monitoring areas', 'Your non-exclusive monitoring bookmarks'],
  '/places': ['Browse places', 'Mapped parks, forests and trails'],
}

/**
 * This is the shared shell around every screen once you've got a profile set
 * up - map, profile, records all render inside it. Picks sidebar vs bottom
 * tabs based on viewport, does the header/title, and drops the active route
 * into an Outlet. Gets mounted at "/" in src/app/router.tsx behind
 * RequirePrivateAccess, so nothing here should ever render without a profile.
 */
export function AppShell() {
  const isDesktop = useIsDesktop()
  const profile = usePrivateAccess((state) => state.profile)
  const location = useLocation()
  const { pathname } = location
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)

  // One of the accessibility ACs asked for screen readers to announce where
  // you land after navigating. React Router doesn't move focus on its own
  // (it's an SPA, no real page load happening), so I do it manually here -
  // just shove focus onto the heading whenever the pathname changes.
  useEffect(() => { headingRef.current?.focus() }, [pathname])

  // in theory RequirePrivateAccess already stops us getting here without a
  // profile, but there's a brief moment between that check passing and the
  // profile actually being in the store, so this just covers that gap
  if (!profile) return null
  const [title, subtitle] = pathname.startsWith('/reports/')
    ? ['Report details', 'Status and screening result']
    : pathname.startsWith('/catalogue/')
      ? ['Plant details', 'Reviewed catalogue information and sources']
      : pathname.startsWith('/adopted-areas/')
        ? ['Community activity', 'Factual reports within your monitoring bookmark']
        : pathname.startsWith('/places/')
          ? ['Place details', 'Historical occurrence associations']
        : TITLES[pathname] ?? [NAV.find((n) => n.path === pathname)?.full ?? 'InvaTrace', '']
  const pageFillsAvailableSpace = pathname === '/map'
  const showBottomTabs = !isDesktop
  const showProfileBack = !isDesktop && pathname === '/profile'
  // Places lives outside the mobile bottom-tabs (entry is from the map
  // controls cluster) so it needs its own back-to-map affordance in the
  // header, otherwise users get stranded on /places with no exit path.
  const showPlacesBack = !isDesktop && pathname === '/places'
  const showProfileShortcut = !isDesktop && pathname !== '/profile' && pathname !== '/reports'
  const profileReturnTo = profileReturnPath(location.state)

  return (
    <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column',
                  height: '100dvh', background: 'var(--bg)',
                  paddingTop: isDesktop ? 0 : 'env(safe-area-inset-top)' }}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {isDesktop && <Sidebar profile={profile} />}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ReportQueueStatusBanner />
        <header className="app-header">
          <div className="app-header__leading">
            {showProfileBack && (
              <button
                type="button"
                className="app-header__back"
                aria-label={profileReturnTo === '/reports' ? 'Back to my records' : 'Back to threat map'}
                onClick={() => navigate(profileReturnTo, { replace: true })}
              >
                <Icon name="ChevronLeft" size={20} color="var(--body)" />
              </button>
            )}
            {showPlacesBack && (
              <button
                type="button"
                className="app-header__back"
                aria-label="Back to threat map"
                onClick={() => navigate('/map')}
              >
                <Icon name="ChevronLeft" size={20} color="var(--body)" />
              </button>
            )}
            <div className="app-header__heading">
              <h1 ref={headingRef} tabIndex={-1} className="app-header__title">{title}</h1>
              {subtitle && <p className="app-header__subtitle">{subtitle}</p>}
            </div>
          </div>
          <div className="app-header__actions">
            {showProfileShortcut && (
              <button
                type="button"
                aria-label="Manage private access"
                title="Private access"
                onClick={() => navigate('/profile', { state: profileStateFromPath(pathname) })}
                className="app-header__action"
              >
                <Icon name="User" size={18} color="var(--body)" />
              </button>
            )}
          </div>
        </header>

        <main id="main-content" tabIndex={-1} style={{
          flex: 1, minHeight: 0,
          overflow: pageFillsAvailableSpace ? 'hidden' : 'auto',
          padding: pageFillsAvailableSpace ? 0 : (isDesktop ? 26 : 16),
          paddingBottom: pageFillsAvailableSpace
            ? 0
            : isDesktop
              ? 26
              : showBottomTabs ? 'var(--mobile-nav-clearance)' : 24,
        }}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {showBottomTabs && <BottomTabs role={profile.role} />}
    </div>
  )
}
