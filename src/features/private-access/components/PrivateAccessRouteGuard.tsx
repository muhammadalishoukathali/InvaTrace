import { PlantLoader } from '@/components/PlantLoader'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { PrivateAccessLayout } from './PrivateAccessLayout'
import { Logo } from '@/components/Logo'
import { usePrivateAccess } from '@/features/private-access/private-access-store'

/** Guards the pre-app access routes (recovery setup, restore).
 *  This is the inverse of RequirePrivateAccess.tsx: that one keeps
 *  unauthorized users out of the app, this one keeps already-authorized
 *  users out of the setup flow so they can't accidentally re-run it. */
export function PrivateAccessRouteGuard() {
  const status = usePrivateAccess((state) => state.status)
  const profile = usePrivateAccess((state) => state.profile)
  const { pathname } = useLocation()

  if (status === 'initializing' || status === 'syncing') {
    return (
      <PrivateAccessLayout compact>
        <section className="access-state" aria-busy="true" aria-live="polite">
          <Logo size={52} />
          <h1>Checking this installation</h1>
          <PlantLoader label="Looking for existing private access…" />
        </section>
      </PrivateAccessLayout>
    )
  }
  // A profile exists but recovery setup wasn't acknowledged yet (e.g. the tab
  // closed mid-setup). Force back to the recovery screen instead of letting
  // the user wander off with codes they never confirmed they saved.
  if (status === 'recovery' && pathname !== '/private-access/recovery') {
    return <Navigate to="/private-access/recovery" replace />
  }
  if (profile && ['ready', 'offline', 'error'].includes(status)) return <Navigate to="/map" replace />
  return <Outlet />
}
