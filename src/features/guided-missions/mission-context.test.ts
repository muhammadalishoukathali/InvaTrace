import { beforeEach, describe, expect, it } from 'vitest'
import { missionContextStore, missionIdForScan, missionPath } from './mission-context'

describe('mission scan context', () => {
  beforeEach(() => missionContextStore.clear())

  it('tags a scan only when it returns to the same mission, for the same identity', () => {
    missionContextStore.set({ missionId: 'm-1', placeId: 'place-1', profileId: 'profile-1' })
    expect(missionIdForScan(missionPath('place-1'), 'profile-1')).toBe('m-1')
    expect(missionIdForScan('/map', 'profile-1')).toBeNull()
    expect(missionIdForScan(missionPath('place-2'), 'profile-1')).toBeNull()
    expect(missionIdForScan(missionPath('place-1'), 'profile-2')).toBeNull()
    expect(missionIdForScan(missionPath('place-1'), undefined)).toBeNull()
  })

  it('stops tagging once cleared', () => {
    missionContextStore.set({ missionId: 'm-1', placeId: 'place-1', profileId: 'profile-1' })
    missionContextStore.clear()
    expect(missionIdForScan(missionPath('place-1'), 'profile-1')).toBeNull()
  })
})
