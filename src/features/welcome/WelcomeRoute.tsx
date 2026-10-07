import { Navigate } from 'react-router-dom'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { WelcomePage } from './WelcomePage'
import { welcomeRedirect } from './welcome-entry'

/** Element for "/". Reads the private-access state only to decide between
 *  the public welcome page and the existing destinations; it never creates
 *  or changes an identity. */
export function WelcomeRoute() {
  const status = usePrivateAccess((state) => state.status)
  const hasProfile = usePrivateAccess((state) => state.profile !== null)
  // Stored identity is still being read: render nothing rather than flash the
  // welcome page at a returning user before sending them to the map.
  if (status === 'initializing') return null
  const target = welcomeRedirect(status, hasProfile)
  return target ? <Navigate to={target} replace /> : <WelcomePage />
}
