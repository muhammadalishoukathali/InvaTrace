import { useSyncExternalStore } from 'react'
import { usePrivateAccess } from '@/features/private-access/private-access-store'

/**
 * Which guided mission a scan belongs to. Set when the user taps "Scan a
 * plant" inside a mission; read by the scan and report steps. A scan only
 * counts as a mission scan when the scan flow's return path is that same
 * mission (see missionIdForScan), so a later scan started from the map is
 * never tagged by accident. Bound to the identity that started it - no token
 * is stored.
 */
export interface MissionContext {
  missionId: string
  placeId: string
  profileId: string
}

const key = 'invatrace.active-mission.v1'
const listeners = new Set<() => void>()
let current: MissionContext | null = read()

function read(): MissionContext | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const item = value as Partial<MissionContext>
    return typeof item.missionId === 'string' && typeof item.placeId === 'string' && typeof item.profileId === 'string'
      ? item as MissionContext : null
  } catch {
    return null
  }
}
const emit = () => listeners.forEach((listener) => listener())

export const missionContextStore = {
  getSnapshot: () => current,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  set(value: MissionContext) {
    current = value
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private browsing: keep in memory */ }
    emit()
  },
  clear() {
    current = null
    try { localStorage.removeItem(key) } catch { /* in-memory clear is enough */ }
    emit()
  },
}

export const missionPath = (placeId: string) => `/places/${placeId}/mission`
export const MISSION_PATH = /^\/places\/([a-zA-Z0-9-]+)\/mission$/

/** The mission id to attach to a scan or report started with this return path, if any. */
export function missionIdForScan(returnTo: string, profileId: string | undefined): string | null {
  const context = current
  if (!context || !profileId || context.profileId !== profileId) return null
  return returnTo === missionPath(context.placeId) ? context.missionId : null
}

export function useMissionContext() {
  const context = useSyncExternalStore(missionContextStore.subscribe, missionContextStore.getSnapshot, () => null)
  const profileId = usePrivateAccess((state) => state.profile?.id)
  return context && context.profileId === profileId ? context : null
}
