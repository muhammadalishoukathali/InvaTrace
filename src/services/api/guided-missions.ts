import { api } from '@/services/api-client'

export type MissionPlantState = 'not_checked' | 'looked_for' | 'unable_to_check'

export interface MissionPlantProgress {
  speciesId: string
  state: MissionPlantState
  noTargetFound: boolean
  updatedAt: string
}

export interface MissionReport {
  reportId: string
  speciesId: string | null
  status: string
  submittedAt: string
}

export interface GuidedMission {
  missionId: string
  placeId: string
  status: 'active' | 'completed'
  datasetVersion: string
  selectedSpeciesId: string | null
  startedAt: string
  updatedAt: string
  completedAt: string | null
  plants: MissionPlantProgress[]
  scansCount: number
  reports: MissionReport[]
}

export interface MissionSummary {
  missionId: string
  placeId: string
  status: 'active' | 'completed'
  startedAt: string
  completedAt: string | null
  lookedForCount: number
  unableToCheckCount: number
  notCheckedCount: number
  noTargetFoundCount: number
  scansCount: number
  reportsSubmittedCount: number
  reports: MissionReport[]
}

/** Epic 7 mission persistence. The profile always comes from the bearer token. */
export const guidedMissionsApi = {
  start(body: { placeId: string; watchlistSpeciesIds: string[]; datasetVersion: string }) {
    return api<GuidedMission>('/api/v1/guided-missions', { method: 'POST', body: JSON.stringify(body) })
  },
  active(placeId: string) {
    return api<GuidedMission>(`/api/v1/guided-missions/active?place_id=${encodeURIComponent(placeId)}`)
  },
  get(missionId: string) {
    return api<GuidedMission>(`/api/v1/guided-missions/${missionId}`)
  },
  selectSpecies(missionId: string, selectedSpeciesId: string | null) {
    return api<GuidedMission>(`/api/v1/guided-missions/${missionId}`, { method: 'PATCH', body: JSON.stringify({ selectedSpeciesId }) })
  },
  setPlant(missionId: string, speciesId: string, body: { state: MissionPlantState; noTargetFound?: boolean }) {
    return api<GuidedMission>(`/api/v1/guided-missions/${missionId}/plants/${encodeURIComponent(speciesId)}`, { method: 'PUT', body: JSON.stringify(body) })
  },
  complete(missionId: string) {
    return api<MissionSummary>(`/api/v1/guided-missions/${missionId}/complete`, { method: 'POST' })
  },
  summary(missionId: string) {
    return api<MissionSummary>(`/api/v1/guided-missions/${missionId}/summary`)
  },
}
