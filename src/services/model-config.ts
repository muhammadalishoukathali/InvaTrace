import { api } from '@/services/api-client'

/**
 * AC 1.1.3 — the server model configuration is authoritative for the
 * product acceptance threshold and the set of supported classifier
 * versions when it is reachable.
 *
 * AC Iteration 1 P2 — a slow or unavailable backend must not prevent the
 * local classification result from appearing. When the config cannot be
 * fetched the client-side open-set decision is trusted for display, but
 * reporting stays blocked via `serverAccepted: false` until the gate has
 * been able to confirm the result.
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
 * Fetch the server model-config with a short timeout so it cannot hold up
 * the full-operation 15s ceiling in ScanCapturePage. A memoised failure is
 * dropped from the cache so the next attempt (e.g. after the client comes
 * back online) can retry rather than serving a stale null forever.
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

/** Test-only reset of the memoised config so ordering tests can start
 *  from a clean slate without reimporting the module. */
export function _resetModelConfigCache(): void {
  cached = null
}

/**
 * Combine the on-device classifier verdict with the server-authoritative
 * gates: (a) the classifier's own open-set acceptance, (b) the reported
 * confidence is at or above the server threshold, and (c) the model
 * version is one the server still trusts.
 *
 * Config unavailable → return the local result unchanged with
 * `serverAccepted: false` so the UI shows the classification but blocks
 * reporting. Config present but rejecting → force uncertain.
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
