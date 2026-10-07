import { useSyncExternalStore } from 'react'
import { ApiError } from '@/services/api-client'
import type { GuidedMission, MissionPlantState } from '@/services/api/guided-missions'

/**
 * Mission progress recorded while the backend is unreachable (handover sec
 * 13). Changes are kept on this device per mission, shown straight away and
 * sent once the connection returns, instead of being discarded. Only the last
 * change per plant (and the last filter choice) is kept - each one replaces
 * the previous state, so replaying older ones would add nothing.
 */
export interface PendingMissionChanges {
  plants: Record<string, { state: MissionPlantState; noTargetFound?: boolean }>
  /** Present only when a filter change is waiting; `value` null clears it. */
  selected?: { value: string | null }
}

const EMPTY: PendingMissionChanges = { plants: {} }
const storageKey = (missionId: string) => `invatrace.mission-pending.v1.${missionId}`
const listeners = new Set<() => void>()
const cache = new Map<string, PendingMissionChanges>()

function read(missionId: string): PendingMissionChanges {
  const cached = cache.get(missionId)
  if (cached) return cached
  let value = EMPTY
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(missionId)) ?? 'null')
    if (parsed && typeof parsed === 'object' && 'plants' in parsed && typeof parsed.plants === 'object' && parsed.plants) {
      value = parsed as PendingMissionChanges
    }
  } catch { /* unreadable storage: nothing pending */ }
  cache.set(missionId, value)
  return value
}

function write(missionId: string, value: PendingMissionChanges) {
  const empty = !Object.keys(value.plants).length && !value.selected
  cache.set(missionId, empty ? EMPTY : value)
  try {
    if (empty) localStorage.removeItem(storageKey(missionId))
    else localStorage.setItem(storageKey(missionId), JSON.stringify(value))
  } catch { /* private browsing: the in-memory copy still syncs this session */ }
  listeners.forEach((listener) => listener())
}

export const pendingMissionStore = {
  get: read,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  queuePlant(missionId: string, speciesId: string, change: { state: MissionPlantState; noTargetFound?: boolean }) {
    const current = read(missionId)
    write(missionId, { ...current, plants: { ...current.plants, [speciesId]: change } })
  },
  queueSelected(missionId: string, value: string | null) {
    write(missionId, { ...read(missionId), selected: { value } })
  },
  dropPlant(missionId: string, speciesId: string) {
    const current = read(missionId)
    const plants = { ...current.plants }
    delete plants[speciesId]
    write(missionId, { ...current, plants })
  },
  dropSelected(missionId: string) {
    const { plants } = read(missionId)
    write(missionId, { plants })
  },
  clear(missionId: string) { write(missionId, EMPTY) },
}

export function usePendingMissionChanges(missionId: string | null | undefined): PendingMissionChanges {
  return useSyncExternalStore(
    pendingMissionStore.subscribe,
    () => (missionId ? read(missionId) : EMPTY),
    () => EMPTY,
  )
}

export const pendingCount = (pending: PendingMissionChanges) =>
  Object.keys(pending.plants).length + (pending.selected ? 1 : 0)

/** Network failures and server outages are worth retrying; a 4xx answer is final. */
export const isRetryable = (error: unknown) => !(error instanceof ApiError) || error.status >= 500

/** The mission as the user sees it: server state with unsent changes on top. */
export function withPending(mission: GuidedMission, pending: PendingMissionChanges): GuidedMission {
  if (!pendingCount(pending)) return mission
  return {
    ...mission,
    selectedSpeciesId: pending.selected ? pending.selected.value : mission.selectedSpeciesId,
    plants: mission.plants.map((plant) => {
      const change = pending.plants[plant.speciesId]
      if (!change) return plant
      const noTargetFound = change.state === 'looked_for'
        ? change.noTargetFound ?? (plant.state === 'looked_for' && plant.noTargetFound)
        : false
      return { ...plant, state: change.state, noTargetFound }
    }),
  }
}
