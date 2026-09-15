import { describe, it, expect } from 'vitest'
import { findPlantStatus, catalogueSourceById, plantStatusDataset } from '@shared/catalogue'
import { findPlantGuidance } from '@/data/plant-guidance'

// AC Iteration 1 P6 - the PlantGuidancePanel's MissingGuidanceFallback must
// still surface authoritative Malaysian status + safety message + source
// provenance from the shared catalogue when the reviewed guidance card is
// absent for a class. Guidance content ships from disk; nothing here should
// depend on the network. These tests confirm the underlying catalogue lookup
// the fallback uses actually produces the fields it renders.

// Species in the new model release whose reviewed guidance card has not been
// authored yet - the fallback must render the shared catalogue's own
// safety_message for these instead of a bland placeholder.
const MISSING_GUIDANCE_SPECIES = ['acacia-auriculiformis', 'salvinia-molesta', 'urochloa-mutica']

describe('offline guidance fallback', () => {
  it('every species in plant-status has a resolvable catalogue record', () => {
    for (const record of plantStatusDataset.records) {
      const looked = findPlantStatus({
        speciesId: record.species_id,
        scientificName: record.scientific_name,
        modelLabel: record.model_label,
      })
      expect(looked?.species_id).toBe(record.species_id)
    }
  })

  it.each(MISSING_GUIDANCE_SPECIES)(
    'catalogue record for %s carries a safety_message the fallback can render',
    (speciesId) => {
      const record = findPlantStatus({ speciesId, scientificName: null })
      expect(record).not.toBeNull()
      // The fallback's `role="note"` body substitutes the catalogue's own
      // safety_message when present, so the absence of one would strand
      // offline users on a bland "no reviewed guidance" placeholder.
      expect(record?.safety_message.length).toBeGreaterThan(0)
      // Sources are optional at the record level (some pending-expert
      // records ship with an empty list), but every listed source must
      // resolve in the catalogue so the fallback's rendered <a href> never
      // points at a dangling id.
      for (const sourceId of record?.status_source_ids ?? []) {
        expect(catalogueSourceById(sourceId), `source ${sourceId} must resolve`).toBeDefined()
      }
    },
  )

  it('every catalogue-listed status_source_id resolves to a source entry', () => {
    for (const record of plantStatusDataset.records) {
      for (const sourceId of record.status_source_ids) {
        expect(
          catalogueSourceById(sourceId),
          `source ${sourceId} referenced by ${record.species_id} must resolve`,
        ).toBeDefined()
      }
    }
  })

  it.each(MISSING_GUIDANCE_SPECIES)(
    '%s has no reviewed guidance card, so the fallback path is the one that renders',
    (speciesId) => {
      const guidance = findPlantGuidance({ plantId: speciesId, scientificName: null })
      expect(guidance).toBeNull()
    },
  )
})
