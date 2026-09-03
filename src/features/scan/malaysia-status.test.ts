import { describe, it, expect } from 'vitest'
import type { IdentifyResult } from '@/types'
import { plantStatusDataset } from '@shared/catalogue'
import {
  deriveMalaysiaStatusState,
  resolveResultPathway,
  isReportEligible,
} from './malaysia-status'

// AC Iteration 1 P3 - the Malaysian status decision must come from the
// authoritative catalogue on every classifiable outcome, and every downstream
// pathway (report / action / no-op) must follow from it. These tests use
// canonical records from the shipped plant-status.json fixture so a catalogue
// drift is caught here before it reaches the UI.

const MODEL_VERSION = plantStatusDataset.model_version

function makeResult(overrides: Partial<IdentifyResult>): IdentifyResult {
  return {
    outcome: 'target',
    confidence: 0.88,
    modelVersion: MODEL_VERSION,
    reportable: true,
    ...overrides,
  }
}

describe('deriveMalaysiaStatusState', () => {
  it('returns invasive for a catalogue-listed invasive species', () => {
    const state = deriveMalaysiaStatusState(makeResult({
      speciesId: 'bidens-pilosa', scientificName: 'Bidens pilosa',
    }))
    expect(state).toBe('invasive')
  })

  it('returns information_only for a catalogue-listed information species', () => {
    const state = deriveMalaysiaStatusState(makeResult({
      speciesId: 'mimosa-pudica', scientificName: 'Mimosa pudica',
    }))
    expect(state).toBe('information_only')
  })

  it('returns status_uncertain for a catalogue-listed uncertain species', () => {
    const state = deriveMalaysiaStatusState(makeResult({
      speciesId: 'centella-asiatica', scientificName: 'Centella asiatica',
    }))
    expect(state).toBe('status_uncertain')
  })

  it('falls back to status_uncertain when the catalogue has no entry', () => {
    const state = deriveMalaysiaStatusState(makeResult({
      speciesId: 'not-a-real-species', scientificName: 'Fakius plantus',
    }))
    expect(state).toBe('status_uncertain')
  })

  it('returns status_uncertain when the model version does not match the catalogue', () => {
    const state = deriveMalaysiaStatusState(makeResult({
      speciesId: 'bidens-pilosa', scientificName: 'Bidens pilosa',
      modelVersion: 'oe_v5_future_web_fp16',
    }))
    expect(state).toBe('status_uncertain')
  })

  it('returns null for an uncertain classifier outcome', () => {
    const state = deriveMalaysiaStatusState(makeResult({ outcome: 'uncertain' }))
    expect(state).toBeNull()
  })
})

describe('resolveResultPathway', () => {
  it('routes an invasive reportable target through the invasive_reportable pathway', () => {
    const pathway = resolveResultPathway(makeResult({
      speciesId: 'bidens-pilosa', scientificName: 'Bidens pilosa', reportable: true,
    }))
    expect(pathway).toEqual({
      pathway: 'invasive_reportable',
      statusState: 'invasive',
      canReport: true,
      canAction: true,
    })
  })

  it('routes a catalogue-invasive but non-reportable label through invasive_unsupported', () => {
    const pathway = resolveResultPathway(makeResult({
      speciesId: 'bidens-pilosa', scientificName: 'Bidens pilosa', reportable: false,
    }))
    expect(pathway.pathway).toBe('invasive_unsupported')
    expect(pathway.canReport).toBe(false)
    expect(pathway.canAction).toBe(false)
  })

  it('routes an information_only species with no action/report affordances', () => {
    const pathway = resolveResultPathway(makeResult({
      speciesId: 'mimosa-pudica', scientificName: 'Mimosa pudica',
    }))
    expect(pathway.pathway).toBe('information_only')
    expect(pathway.canReport).toBe(false)
    expect(pathway.canAction).toBe(false)
  })

  it('routes a status_uncertain species with no action/report affordances', () => {
    const pathway = resolveResultPathway(makeResult({
      speciesId: 'centella-asiatica', scientificName: 'Centella asiatica',
    }))
    expect(pathway.pathway).toBe('status_uncertain')
    expect(pathway.canReport).toBe(false)
    expect(pathway.canAction).toBe(false)
  })

  it('routes a missing catalogue entry to status_uncertain', () => {
    const pathway = resolveResultPathway(makeResult({
      speciesId: 'not-in-catalogue', scientificName: 'Ghostus plantum',
    }))
    expect(pathway.pathway).toBe('status_uncertain')
    expect(pathway.canReport).toBe(false)
    expect(pathway.canAction).toBe(false)
  })

  it('routes a model-version mismatch to status_uncertain even when the label is invasive', () => {
    const pathway = resolveResultPathway(makeResult({
      speciesId: 'bidens-pilosa', scientificName: 'Bidens pilosa',
      modelVersion: 'oe_v5_future_web_fp16',
    }))
    expect(pathway.pathway).toBe('status_uncertain')
    expect(pathway.canReport).toBe(false)
    expect(pathway.canAction).toBe(false)
  })

  it('routes other_plant outcomes with status_uncertain and no affordances', () => {
    const pathway = resolveResultPathway(makeResult({ outcome: 'other_plant', reportable: false }))
    expect(pathway.pathway).toBe('other_plant')
    expect(pathway.canReport).toBe(false)
    expect(pathway.canAction).toBe(false)
  })

  it('routes uncertain outcomes with a null statusState', () => {
    const pathway = resolveResultPathway(makeResult({ outcome: 'uncertain', reportable: false }))
    expect(pathway.pathway).toBe('uncertain')
    expect(pathway.statusState).toBeNull()
  })
})

describe('isReportEligible', () => {
  it('is true only for invasive', () => {
    expect(isReportEligible('invasive')).toBe(true)
    expect(isReportEligible('information_only')).toBe(false)
    expect(isReportEligible('status_uncertain')).toBe(false)
    expect(isReportEligible(null)).toBe(false)
  })
})
