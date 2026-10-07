/**
 * The scan flow can be opened from a few different places - the map, the
 * reports list, the profile screen - and "back"/"cancel" needs to actually
 * return the user to wherever they came from, not just default to the map
 * every time. This file centralizes that round-trip logic: encode the origin
 * into router state on the way in, decode it on the way out, so
 * ScanFlowLayout and every scan screen are all reading the same shape
 * instead of each one guessing at router state on its own.
 */
export interface ScanNavigationState {
  returnTo: string
}

const RETURN_PATH = /^\/(?:map|reports|profile|catalogue(?:\/[a-z0-9-]+)?|places(?:\/[a-zA-Z0-9-]+(?:\/mission)?)?|adopted-areas(?:\/[a-zA-Z0-9-]+\/activity)?|events(?:\/mine|\/[a-zA-Z0-9-]+(?:\/tasks)?)?)$/

export function scanReturnPath(state: unknown): ScanNavigationState['returnTo'] {
  if (!state || typeof state !== 'object' || !('returnTo' in state)) return '/map'
  const returnTo = (state as { returnTo?: unknown }).returnTo
  return typeof returnTo === 'string' && RETURN_PATH.test(returnTo) ? returnTo : '/map'
}

export function scanStateFromPath(pathname: string): ScanNavigationState {
  if (pathname.startsWith('/reports')) return { returnTo: '/reports' }
  return { returnTo: scanReturnPath({ returnTo: pathname }) }
}
