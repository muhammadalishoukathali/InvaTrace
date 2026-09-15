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
const VERIFY_TIMEOUT_MS = 12_000

export async function verifyWithPlantNet(image: Blob): Promise<VerificationResult> {
  const form = new FormData()
  form.append('image', image, image instanceof File ? image.name : 'scan.jpg')
  form.append('organ', 'auto')
  const token = getAccessToken()
  // Own timeout so a hung backend (or a PlantNet stall behind it) cannot
  // freeze the scan UI. Server-side has its own timeout too; this is
  // belt-and-braces for the browser side.
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
  try {
    const response = await fetch(apiUrl('/api/v1/identify/plantnet-verify'), {
      method: 'POST',
      credentials: 'omit',
      body: form,
      signal: controller.signal,
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
    const message = error instanceof Error ? error.message : 'network error'
    return {
      label: 'not_sure',
      status: 'error',
      provider: 'plantnet',
      reason: controller.signal.aborted ? 'PlantNet verification timed out' : message,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}
