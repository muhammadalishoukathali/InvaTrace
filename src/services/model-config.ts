import { api } from '@/services/api-client'

/**
 * AC 1.1.3 — the server model configuration is authoritative for the
 * product acceptance threshold and the set of supported classifier
 * versions. The app fetches this on demand, caches the result, and forces
 * an uncertain outcome if it cannot be retrieved safely rather than
 * guessing with stale numbers.
 */
export interface ModelConfig {
  modelVersion: string | null
  supportedVersions: string[]
  acceptanceThreshold: number
  thresholdVersion: string
  configVersion: string
}

let cached: Promise<ModelConfig | null> | null = null

export function fetchModelConfig(): Promise<ModelConfig | null> {
  if (!cached) {
    cached = api<ModelConfig>('/api/v1/model-config').catch(() => null)
  }
  return cached
}

/** Test-only reset of the memoised config so ordering tests can start
 *  from a clean slate without reimporting the module. */
export function _resetModelConfigCache(): void {
  cached = null
}

/**
 * Combine the on-device classifier verdict with the server-authoritative
 * gates: (a) the classifier's own open-set acceptance, (b) the reported
 * confidence is at or above the server threshold, and (c) the model
 * version is one the server still trusts. Any failure short-circuits to
 * `outcome: 'uncertain'` so the UI hides reporting and offers Retake photo.
 */
export interface ClassifierResult {
  outcome: 'target' | 'other_plant' | 'uncertain'
  confidence: number
  modelVersion: string
  speciesId?: string | null
}

export function applyServerAcceptance<T extends ClassifierResult>(
  result: T,
  config: ModelConfig | null,
): T {
  if (!config) {
    return { ...result, outcome: 'uncertain', speciesId: null }
  }
  const versionOk = config.supportedVersions.length === 0
    || config.supportedVersions.includes(result.modelVersion)
  const confidentEnough = result.confidence >= config.acceptanceThreshold
  const hasLabel = result.outcome === 'target' ? Boolean(result.speciesId) : true
  if (!versionOk || !confidentEnough || !hasLabel) {
    return { ...result, outcome: 'uncertain', speciesId: null }
  }
  return result
}
