import { beforeEach, describe, expect, it } from 'vitest'
import { _resetModelConfigCache, applyServerAcceptance, type ModelConfig } from './model-config'

const supportedConfig: ModelConfig = {
  modelVersion: 'oe_v4_31class_web_fp16',
  supportedVersions: ['oe_v4_31class_web_fp16'],
  acceptanceThreshold: 0.5,
  thresholdVersion: 'oe_v4_31class_web_fp16@0.5000',
  configVersion: 'oe_v4_31class_web_fp16@0.5000',
}

const targetResult = {
  outcome: 'target' as const,
  confidence: 0.9,
  modelVersion: 'oe_v4_31class_web_fp16',
  speciesId: 'mikania-micrantha',
}

// AC 1.1.3 — every branch of the server-authoritative gate must land the
// result in the same shape the UI reads.
describe('applyServerAcceptance', () => {
  beforeEach(() => _resetModelConfigCache())

  it('preserves target when config accepts it', () => {
    expect(applyServerAcceptance(targetResult, supportedConfig).outcome).toBe('target')
  })

  it('forces uncertain when no config is available', () => {
    const out = applyServerAcceptance(targetResult, null)
    expect(out.outcome).toBe('uncertain')
    expect(out.speciesId).toBeNull()
  })

  it('forces uncertain below the acceptance threshold', () => {
    const out = applyServerAcceptance(
      { ...targetResult, confidence: 0.49 },
      supportedConfig,
    )
    expect(out.outcome).toBe('uncertain')
  })

  it('accepts at the exact threshold boundary', () => {
    const out = applyServerAcceptance(
      { ...targetResult, confidence: 0.5 },
      supportedConfig,
    )
    expect(out.outcome).toBe('target')
  })

  it('forces uncertain when the model version is not supported', () => {
    const out = applyServerAcceptance(
      { ...targetResult, modelVersion: 'ancient-model' },
      supportedConfig,
    )
    expect(out.outcome).toBe('uncertain')
  })

  it('forces uncertain when a target result carries no species id', () => {
    const out = applyServerAcceptance(
      { ...targetResult, speciesId: null },
      supportedConfig,
    )
    expect(out.outcome).toBe('uncertain')
  })

  it('leaves other_plant results alone', () => {
    const out = applyServerAcceptance(
      {
        outcome: 'other_plant' as const,
        confidence: 0.99,
        modelVersion: 'oe_v4_31class_web_fp16',
      },
      supportedConfig,
    )
    expect(out.outcome).toBe('other_plant')
  })
})
