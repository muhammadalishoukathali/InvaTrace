import { describe, it, expect } from 'vitest'
import type { IdentifyResult, VerificationResult } from '@/types'
import { applyPlantNetVerification, shouldAskPlantNet } from './plantnet-handover'
import { resolveResultPathway } from './malaysia-status'

// The scan flow is two-stage: the on-device model owns the catalogue species,
// and anything it cannot place is handed to PlantNet. A plant that is simply
// not in the catalogue scores near zero on every catalogue class, so a low
// score must still reach PlantNet instead of dead-ending in a retake prompt.

function uncertain(overrides: Partial<IdentifyResult> = {}): IdentifyResult {
  return {
    outcome: 'uncertain',
    confidence: 0.04,
    modelVersion: 'test-model',
    reportable: false,
    ...overrides,
  }
}

const LOW_CERTAINTY = { reason: 'low_certainty' as const, message: 'Retake the photo.' }
const TOO_SMALL = { reason: 'image_too_small' as const, message: 'Move closer.' }

const MATCH: VerificationResult = {
  label: 'native',
  status: 'native',
  provider: 'plantnet',
  species: { scientificName: 'Hibiscus rosa-sinensis', commonNames: ['Chinese hibiscus'], score: 0.8 },
}
const NO_MATCH: VerificationResult = { label: 'not_sure', status: 'not_sure', provider: 'plantnet', reason: 'no match' }
const UNREACHABLE: VerificationResult = { label: 'not_sure', status: 'error', provider: 'plantnet', reason: 'HTTP 500' }

describe('shouldAskPlantNet', () => {
  it('asks for an uncertain result in the handover band', () => {
    expect(shouldAskPlantNet(uncertain({ confidence: 0.4 }))).toBe(true)
  })

  it('asks when the model scored the plant too low to classify', () => {
    expect(shouldAskPlantNet(uncertain({ retakeAdvice: LOW_CERTAINTY }))).toBe(true)
  })

  it('does not ask when the photo is too small to identify at all', () => {
    expect(shouldAskPlantNet(uncertain({ retakeAdvice: TOO_SMALL }))).toBe(false)
  })

  it('does not ask when the on-device model recognised the plant', () => {
    expect(shouldAskPlantNet(uncertain({ outcome: 'target', speciesId: 'mikania-micrantha' }))).toBe(false)
    expect(shouldAskPlantNet(uncertain({ outcome: 'other_plant' }))).toBe(false)
  })
})

describe('applyPlantNetVerification', () => {
  it('shows the PlantNet suggestion instead of the retake prompt when PlantNet names a species', () => {
    const merged = applyPlantNetVerification(uncertain({ retakeAdvice: LOW_CERTAINTY }), MATCH)

    expect(merged.verification).toEqual(MATCH)
    expect(merged.retakeAdvice).toBeUndefined()
    expect(resolveResultPathway(merged).pathway).toBe('uncertain')
  })

  it.each([NO_MATCH, UNREACHABLE])('keeps the retake prompt when PlantNet has no species (%#)', (verification) => {
    const merged = applyPlantNetVerification(uncertain({ retakeAdvice: LOW_CERTAINTY }), verification)

    expect(merged.verification).toEqual(verification)
    expect(merged.retakeAdvice).toEqual(LOW_CERTAINTY)
    expect(resolveResultPathway(merged).pathway).toBe('retake_recommended')
  })

  it('attaches the verification to a handover-band result unchanged', () => {
    const merged = applyPlantNetVerification(uncertain({ confidence: 0.4 }), NO_MATCH)

    expect(merged.verification).toEqual(NO_MATCH)
    expect(resolveResultPathway(merged).pathway).toBe('uncertain')
  })
})
