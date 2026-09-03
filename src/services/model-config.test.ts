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

// AC 1.1.3 / P2 - every branch of the server-authoritative gate lands the
// result in the same shape the UI reads. When the gate cannot run the local
// result must still surface, only reporting is blocked (serverAccepted=false).
describe('applyServerAcceptance', () => {
  beforeEach(() => _resetModelConfigCache())

  it('preserves target and flags serverAccepted when config accepts it', () => {
    const out = applyServerAcceptance(targetResult, supportedConfig)
    expect(out.outcome).toBe('target')
    expect(out.serverAccepted).toBe(true)
  })

  it('keeps local result when no config is available but marks it unaccepted', () => {
    // AC Iteration 1 P2 - a slow/unavailable backend must not prevent the
    // local classification from appearing. Reporting stays blocked via
    // serverAccepted=false until the gate confirms.
    const out = applyServerAcceptance(targetResult, null)
    expect(out.outcome).toBe('target')
    expect(out.speciesId).toBe('mikania-micrantha')
    expect(out.serverAccepted).toBe(false)
  })

  it('forces uncertain below the acceptance threshold', () => {
    const out = applyServerAcceptance(
      { ...targetResult, confidence: 0.49 },
      supportedConfig,
    )
    expect(out.outcome).toBe('uncertain')
    expect(out.serverAccepted).toBe(false)
  })

  it('accepts at the exact threshold boundary', () => {
    const out = applyServerAcceptance(
      { ...targetResult, confidence: 0.5 },
      supportedConfig,
    )
    expect(out.outcome).toBe('target')
    expect(out.serverAccepted).toBe(true)
  })

  it('forces uncertain when the model version is not supported', () => {
    const out = applyServerAcceptance(
      { ...targetResult, modelVersion: 'ancient-model' },
      supportedConfig,
    )
    expect(out.outcome).toBe('uncertain')
    expect(out.serverAccepted).toBe(false)
  })

  it('forces uncertain when a target result carries no species id', () => {
    const out = applyServerAcceptance(
      { ...targetResult, speciesId: null },
      supportedConfig,
    )
    expect(out.outcome).toBe('uncertain')
    expect(out.serverAccepted).toBe(false)
  })

  it('leaves other_plant results alone and accepts them', () => {
    const out = applyServerAcceptance(
      {
        outcome: 'other_plant' as const,
        confidence: 0.99,
        modelVersion: 'oe_v4_31class_web_fp16',
      },
      supportedConfig,
    )
    expect(out.outcome).toBe('other_plant')
    expect(out.serverAccepted).toBe(true)
  })
})
