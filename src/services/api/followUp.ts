import { api } from '@/services/api-client'

export type FollowUpOutcome = 'no_regrowth' | 'regrowth_present' | 'unable_to_confirm'

export interface FollowUpLocation {
  latitude: number
  longitude: number
  accuracyM: number
  capturedAt: string
}

export interface FollowUpResponse {
  sightingId: string
  outcome: FollowUpOutcome
  followUpState: 'needed' | 'resolved' | 'regrowth'
  lastFollowupAt: string
}

export function submitFollowUp(
  sightingId: string,
  location: FollowUpLocation,
  outcome: FollowUpOutcome,
) {
  return api<FollowUpResponse>(`/api/v1/sightings/${encodeURIComponent(sightingId)}/follow-up`, {
    method: 'POST',
    body: JSON.stringify({
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyM: location.accuracyM,
      capturedAt: location.capturedAt,
      outcome,
    }),
  })
}
