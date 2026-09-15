import type { VerificationResult } from '@/types'
import { apiUrl, getAccessToken } from '@/services/api-client'

/**
 * Second-opinion identifier the scan flow reaches for when the on-device
 * Student33 model returns `outcome: 'uncertain'`. Posts the same photo the
 * user just tried to identify to the backend, which forwards it to PlantNet
 * with the server-side API key.
 *
 * Any failure - network hiccup, backend down, missing key on the server -
 * falls through to a `not_sure` verification so the UI can render a real
 * answer to the user instead of blocking on a broken external dependency.
 */
export async function verifyWithPlantNet(image: Blob): Promise<VerificationResult> {
  const form = new FormData()
  form.append('image', image, image instanceof File ? image.name : 'scan.jpg')
  form.append('organ', 'auto')
  const token = getAccessToken()
  try {
    const response = await fetch(apiUrl('/api/v1/identify/plantnet-verify'), {
      method: 'POST',
      credentials: 'omit',
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!response.ok) {
      return { label: 'not_sure', status: 'error', provider: 'plantnet', reason: `HTTP ${response.status}` }
    }
    const raw = await response.json() as {
      label: 'native' | 'not_sure'
      status: 'native' | 'not_sure' | 'disabled' | 'error'
      species?: {
        scientificName: string
        commonNames: string[]
        family: string | null
        score: number
      } | null
      reason: string | null
      provider: string
    }
    return {
      label: raw.label,
      status: raw.status,
      provider: 'plantnet',
      species: raw.species ? {
        scientificName: raw.species.scientificName,
        commonNames: raw.species.commonNames ?? [],
        family: raw.species.family ?? null,
        score: raw.species.score,
      } : undefined,
      reason: raw.reason ?? null,
    }
  } catch (error) {
    return {
      label: 'not_sure',
      status: 'error',
      provider: 'plantnet',
      reason: error instanceof Error ? error.message : 'network error',
    }
  }
}
