import { describe, expect, it } from 'vitest'
import type { IdentifyResult } from '@/types'
import { deriveMalaysiaStatusState, isReportEligible } from './malaysia-status'

function result(overrides: Partial<IdentifyResult> = {}): IdentifyResult {
  return {
    outcome: 'target',
    confidence: 0.9,
    modelVersion: 'test',
    reportable: false,
    ...overrides,
  }
}

describe('Malaysia status safety gate', () => {
  it('allows only an explicit invasive status to continue toward reporting', () => {
    const state = deriveMalaysiaStatusState(result({ malaysiaStatus: 'invasive' }))
    expect(state).toBe('invasive')
    expect(isReportEligible(state)).toBe(true)
  })

  it.each([
    'native',
    'introduced',
    'naturalised',
    'alien_not_marked_invasive',
    'common_cultivated_status_not_inferred',
  ])('treats %s as information only', (malaysiaStatus) => {
    const state = deriveMalaysiaStatusState(result({ outcome: 'other_plant', malaysiaStatus }))
    expect(state).toBe('information_only')
    expect(isReportEligible(state)).toBe(false)
  })

  it('fails closed for missing and unrecognised catalogue values', () => {
    expect(deriveMalaysiaStatusState(result())).toBe('status_uncertain')
    expect(deriveMalaysiaStatusState(result({ malaysiaStatus: 'unexpected' })))
      .toBe('status_uncertain')
  })

  it('never treats an uncertain identification as report eligible', () => {
    const state = deriveMalaysiaStatusState(result({
      outcome: 'uncertain',
      malaysiaStatus: 'invasive',
    }))
    expect(state).toBeNull()
    expect(isReportEligible(state)).toBe(false)
  })
})
