import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IdentifyResult } from '@/types'
import * as catalogue from '@shared/catalogue'
import { assistantSpeciesForScan } from './PlantAssistantPanel'

vi.mock('@/services/api-client', () => ({ api: vi.fn(), ApiError: class extends Error {} }))

const accepted: IdentifyResult = {
  outcome: 'target', speciesId: 'mikania-micrantha', scientificName: 'Mikania micrantha',
  confidence: 0.99, modelVersion: 'test-model', reportable: true,
}

afterEach(() => vi.restoreAllMocks())

describe('assistant scan eligibility', () => {
  it.each(['other_plant', 'uncertain'] as const)('blocks %s before catalogue lookup despite stale valid names', outcome => {
    const lookup = vi.spyOn(catalogue, 'findApprovedSpecies')
    expect(assistantSpeciesForScan({ ...accepted, outcome })).toBeNull()
    expect(lookup).not.toHaveBeenCalled()
  })

  it('retains the supported target species', () => {
    expect(assistantSpeciesForScan(accepted)?.species_id).toBe('mikania-micrantha')
  })

  it('keeps an unknown target name unavailable', () => {
    expect(assistantSpeciesForScan({ ...accepted, speciesId: 'unknown', scientificName: 'Unknown' })).toBeNull()
  })
})
