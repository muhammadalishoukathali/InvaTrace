import { api } from '@/services/api-client'

/**
 * AC 1.1.3 wants the server's model config to be the source of truth for
 * the acceptance threshold and which classifier versions still count,
 * whenever we can actually reach it.
 *
 * The Iteration 1 P2 AC is the trickier one though - a slow or dead backend
 * shouldn't stop the on-device classification result from showing up. So
 * when the config fetch fails I still trust the local open-set decision for
 * display purposes, but reporting stays blocked (serverAccepted: false)
 * until the server's actually confirmed it.
 */
export interface ModelConfig {
  modelVersion: string | null
  supportedVersions: string[]
  acceptanceThreshold: number
  thresholdVersion: string
  configVersion: string
}

let cached: Promise<ModelConfig | null> | null = null

const MODEL_CONFIG_TIMEOUT_MS = 4_000

/**
 * Fetches the server model config, but with a short timeout so a slow
 * backend can't eat into the 15s ceiling ScanCapturePage has for the whole
 * operation. If it fails I don't cache the null - I drop it from the cache
 * so the next attempt (say, once the client's back online) actually retries
 * instead of just returning the same stale null forever.
 */
export function fetchModelConfig(): Promise<ModelConfig | null> {
  if (!cached) {
    const attempt = new Promise<ModelConfig | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), MODEL_CONFIG_TIMEOUT_MS)
      api<ModelConfig>('/api/v1/model-config')
        .then((config) => { clearTimeout(timer); resolve(config) })
        .catch(() => { clearTimeout(timer); resolve(null) })
    })
    attempt.then((value) => { if (value === null) cached = null })
    cached = attempt
  }
  return cached
}

/** Only used in tests - resets the cached config so ordering tests get a
 *  clean slate without having to reimport the whole module. */
export function _resetModelConfigCache(): void {
  cached = null
}

/**
 * Takes the on-device classifier's verdict and checks it against the
 * server's rules: the classifier's own open-set call, whether the
 * confidence clears the server threshold, and whether the model version
 * is still one the server trusts.
 *
 * If the config isn't available I just return the local result as-is with
 * serverAccepted: false, so the UI can still show the classification but
 * reporting stays blocked. If the config is there but rejects the result,
 * I force it to "uncertain" instead.
 */
export interface ClassifierResult {
  outcome: 'target' | 'other_plant' | 'uncertain'
  confidence: number
  modelVersion: string
  speciesId?: string | null
  serverAccepted?: boolean
}

export function applyServerAcceptance<T extends ClassifierResult>(
  result: T,
  config: ModelConfig | null,
): T & { serverAccepted: boolean } {
  if (!config) {
    return { ...result, serverAccepted: false }
  }
  const versionOk = config.supportedVersions.length === 0
    || config.supportedVersions.includes(result.modelVersion)
  const confidentEnough = result.confidence >= config.acceptanceThreshold
  const hasLabel = result.outcome === 'target' ? Boolean(result.speciesId) : true
  if (!versionOk || !confidentEnough || !hasLabel) {
    return { ...result, outcome: 'uncertain', speciesId: null, serverAccepted: false }
  }
  return { ...result, serverAccepted: true }
}
