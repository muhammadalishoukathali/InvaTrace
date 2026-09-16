import { describe, expect, it } from 'vitest'
import {
  MSW_LOCATION_ACCURACY_MAX_M,
  MSW_POLICY_VERSION,
  MSW_SUPPORTED_MODEL_VERSIONS,
  evaluateMockReport,
} from './handlers'

// AC 2.2.1 - the MSW mock now runs the same deterministic decision table
// backend/app/domain/validation.py::evaluate uses, so dev flows can exercise
// every rejection and rescan path without a live FastAPI worker.

const okInput = {
  exactReplay: false,
  perceptualReplay: false,
  locationAccuracyM: 12,
  clientOutcome: 'target' as const,
  clientSpeciesId: 'mikania-micrantha',
  clientModelSupported: true,
  mergeTargetId: null,
}

describe('AC 2.2.1 - MSW deterministic screening', () => {
  it('screens a clean, well-formed submission', () => {
    const decision = evaluateMockReport(okInput)
    expect(decision.status).toBe('screened')
    expect(decision.reasonCodes).toEqual(['automated_rule_screened'])
    expect(decision.retryable).toBe(false)
  })

  it('rejects exact replay before any rescan check runs', () => {
    const decision = evaluateMockReport({
      ...okInput,
      exactReplay: true,
      // deliberately also insufficient - reject must still win
      locationAccuracyM: 5000,
    })
    expect(decision.status).toBe('rejected')
    expect(decision.reasonCodes).toEqual(['exact_photo_replay'])
    expect(decision.retryable).toBe(false)
  })

  it('rejects perceptual replay when exact replay is absent', () => {
    const decision = evaluateMockReport({ ...okInput, perceptualReplay: true })
    expect(decision.status).toBe('rejected')
    expect(decision.reasonCodes).toEqual(['perceptual_photo_replay'])
  })

  it('needs a rescan when GPS accuracy exceeds the policy threshold', () => {
    const decision = evaluateMockReport({
      ...okInput,
      locationAccuracyM: MSW_LOCATION_ACCURACY_MAX_M + 1,
    })
    expect(decision.status).toBe('needs_rescan')
    expect(decision.reasonCodes).toContain('location_accuracy_insufficient')
    expect(decision.retryable).toBe(true)
  })

  it('needs a rescan when GPS accuracy is missing', () => {
    const decision = evaluateMockReport({ ...okInput, locationAccuracyM: null })
    expect(decision.status).toBe('needs_rescan')
    expect(decision.reasonCodes).toContain('location_accuracy_insufficient')
  })

  it('needs a rescan when the client outcome is not a reportable target', () => {
    const decision = evaluateMockReport({
      ...okInput,
      clientOutcome: 'uncertain',
      clientSpeciesId: null,
    })
    expect(decision.status).toBe('needs_rescan')
    expect(decision.reasonCodes).toContain('plant_identification_not_reportable')
  })

  it('needs a rescan when the client model version is not supported', () => {
    const decision = evaluateMockReport({
      ...okInput,
      clientModelSupported: false,
    })
    expect(decision.status).toBe('needs_rescan')
    expect(decision.reasonCodes).toContain('unsupported_client_model_version')
  })

  it('collects every rescan reason at once for a single friendly retry', () => {
    const decision = evaluateMockReport({
      ...okInput,
      locationAccuracyM: 10_000,
      clientOutcome: 'uncertain',
      clientSpeciesId: null,
      clientModelSupported: false,
    })
    expect(decision.status).toBe('needs_rescan')
    expect(new Set(decision.reasonCodes)).toEqual(
      new Set([
        'location_accuracy_insufficient',
        'plant_identification_not_reportable',
        'unsupported_client_model_version',
      ]),
    )
  })

  it('promotes a nearby merge only after the report passes every rescan check', () => {
    const merged = evaluateMockReport({ ...okInput, mergeTargetId: 'sighting-42' })
    expect(merged.status).toBe('merged')
    expect(merged.reasonCodes).toEqual(['same_species_nearby_recent'])

    // A dirty submission with a merge target still needs a rescan first.
    const dirty = evaluateMockReport({
      ...okInput,
      mergeTargetId: 'sighting-42',
      locationAccuracyM: 10_000,
    })
    expect(dirty.status).toBe('needs_rescan')
  })

  it('uses the policy version + supported-model list that the real backend defaults to', () => {
    expect(MSW_POLICY_VERSION).toBe('deterministic-rules-v1.0')
    expect(MSW_SUPPORTED_MODEL_VERSIONS).toContain('invatrace-student33-tinyvit5m-320-fp16')
    expect(MSW_SUPPORTED_MODEL_VERSIONS).toContain('oe_v4_31class_web_fp16')
    // and the default threshold matches DEFAULT_LOCATION_ACCURACY_MAX_M
    expect(MSW_LOCATION_ACCURACY_MAX_M).toBe(250)
  })
})
