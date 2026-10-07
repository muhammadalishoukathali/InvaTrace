import { describe, expect, it } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { GuidedMission } from '@/services/api/guided-missions'
import { isRetryable, pendingCount, pendingMissionStore, withPending } from './mission-offline'

const mission = (): GuidedMission => ({
  missionId: 'm-1', placeId: 'p-1', status: 'active', datasetVersion: 'v1', selectedSpeciesId: null,
  startedAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z', completedAt: null, scansCount: 0, reports: [],
  plants: [
    { speciesId: 'a', state: 'looked_for', noTargetFound: true, updatedAt: '' },
    { speciesId: 'b', state: 'not_checked', noTargetFound: false, updatedAt: '' },
  ],
})

describe('unsent mission progress', () => {
  it('keeps the latest change per plant and the filter until each is sent', () => {
    pendingMissionStore.clear('m-1')
    pendingMissionStore.queuePlant('m-1', 'b', { state: 'unable_to_check' })
    pendingMissionStore.queuePlant('m-1', 'b', { state: 'looked_for' })
    pendingMissionStore.queueSelected('m-1', 'a')
    const pending = pendingMissionStore.get('m-1')
    expect(pendingCount(pending)).toBe(2)
    const view = withPending(mission(), pending)
    expect(view.selectedSpeciesId).toBe('a')
    expect(view.plants[1]).toMatchObject({ state: 'looked_for', noTargetFound: false })
    pendingMissionStore.dropPlant('m-1', 'b')
    pendingMissionStore.dropSelected('m-1')
    expect(pendingCount(pendingMissionStore.get('m-1'))).toBe(0)
  })

  it('applies the same no-find rule as the server', () => {
    pendingMissionStore.clear('m-1')
    pendingMissionStore.queuePlant('m-1', 'a', { state: 'unable_to_check' })
    expect(withPending(mission(), pendingMissionStore.get('m-1')).plants[0]).toMatchObject({ state: 'unable_to_check', noTargetFound: false })
    pendingMissionStore.queuePlant('m-1', 'a', { state: 'looked_for' })
    expect(withPending(mission(), pendingMissionStore.get('m-1')).plants[0].noTargetFound).toBe(true)
    pendingMissionStore.clear('m-1')
  })

  it('retries only network failures and server outages', () => {
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetryable(new ApiError(503, 'down'))).toBe(true)
    expect(isRetryable(new ApiError(409, 'done', 'mission_completed'))).toBe(false)
  })
})
