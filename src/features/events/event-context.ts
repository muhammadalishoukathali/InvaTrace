import { useSyncExternalStore } from 'react'
import { usePrivateAccess } from '@/features/private-access/private-access-store'

export interface ActiveEventContext {
  eventId: string
  startAt: string
  endAt: string
  checkedInAt: string
  /** The pseudonymous profile that made this check-in. Never store any token. */
  profileId?: string
}
const key = 'invatrace.active-event.v1'
let current: ActiveEventContext | null = read()
const listeners = new Set<() => void>()
function valid(value: unknown): value is ActiveEventContext {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ActiveEventContext>
  return typeof item.eventId === 'string' && typeof item.startAt === 'string'
    && typeof item.endAt === 'string' && typeof item.checkedInAt === 'string'
    && (item.profileId === undefined || typeof item.profileId === 'string')
}
function read(): ActiveEventContext | null {
  try { const raw = localStorage.getItem(key); const value: unknown = raw ? JSON.parse(raw) : null; return valid(value) ? value : null } catch { return null }
}
function emit() { listeners.forEach((listener) => listener()) }
export const eventContextStore = {
  getSnapshot: () => current,
  subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) },
  set(value: ActiveEventContext) { current = value; try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private browsing may deny durable storage */ } emit() },
  clear() { current = null; try { localStorage.removeItem(key) } catch { /* in-memory clear still protects the current session */ } emit() },
  checkIn(event: Omit<ActiveEventContext, 'checkedInAt'>, checkedInAt: string) { this.set({ ...event, checkedInAt }) },
}
export function useEventContext() {
  const context = useSyncExternalStore(eventContextStore.subscribe, eventContextStore.getSnapshot, () => null)
  const profileId = usePrivateAccess((state) => state.profile?.id)
  // A check-in is an identity-bound authorization. Do not reuse one restored
  // from a different pseudonymous identity on this installation.
  return context?.profileId && context.profileId === profileId ? context : null
}
