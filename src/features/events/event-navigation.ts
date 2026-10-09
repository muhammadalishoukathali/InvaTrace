import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Epic 9 screens are reached from several places (discovery, your hosted
 * events, a place page, an event summary). Links into an event carry where they
 * came from so its Back control returns there, with the same filters, instead
 * of always dropping people on the events list.
 */
export interface EventOrigin { from: string }

export function originState(pathname: string, search = ''): EventOrigin {
  return { from: `${pathname}${search}` }
}

/** Link state recording the current screen as the origin. */
export function useOrigin(): EventOrigin {
  const location = useLocation()
  return originState(location.pathname, location.search)
}

function safeFrom(state: unknown): string | null {
  const from = (state as Partial<EventOrigin> | null)?.from
  // Same-origin app paths only; never a protocol-relative or external URL.
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : null
}

function labelFor(path: string): string {
  const pathname = path.split(/[?#]/)[0]
  if (pathname === '/events/mine') return 'Back to your hosted events'
  if (pathname === '/events') return 'Back to events'
  if (/^\/events\/[^/]+\/summary$/.test(pathname)) return 'Back to summary'
  if (/^\/events\/[^/]+$/.test(pathname)) return 'Back to event'
  if (/^\/places\/[^/]+/.test(pathname)) return 'Back to place'
  return 'Back'
}

/** Props for a BackLink that returns to the screen this one was opened from. */
export function backTarget(state: unknown, fallback: string): { to: string; children: ReactNode } {
  const to = safeFrom(state) ?? fallback
  return { to, children: labelFor(to) }
}
