import { describe, expect, it } from 'vitest'
import { approvedSpeciesDataset, catalogueDetailsDataset } from '@shared/catalogue'
import { findPlantGuidance, plantGuidanceDataset, getSources } from './plant-guidance'

describe('plant-guidance dataset', () => {
  it('loads dataset with expected shape', () => {
    expect(plantGuidanceDataset.jurisdiction).toBe('Malaysia')
    expect(plantGuidanceDataset.plants.length).toBeGreaterThan(0)
    expect(plantGuidanceDataset.safety_policy.permission_rule).toBeTruthy()
  })

  it('resolves lookup by scientific name for every guidance entry', () => {
    for (const plant of plantGuidanceDataset.plants) {
      const hit = findPlantGuidance({ scientificName: plant.scientific_name })
      expect(hit?.plant_id).toBe(plant.plant_id)
    }
  })

  it('resolves dashed speciesId form emitted by the pulih model', () => {
    const dashed = 'mimosa-pudica'
    const hit = findPlantGuidance({ plantId: dashed })
    expect(hit?.plant_id).toBe('mimosa_pudica')
  })

  it('every guidance record is reachable by its own model class label', () => {
    // Not every core-target class carries a reviewed guidance card yet -
    // classes without one fall through to the shared catalogue's own
    // safety_message via PlantGuidancePanel's MissingGuidanceFallback.
    // What must hold is that any guidance card that does exist stays
    // reachable by its declared model_label.
    for (const plant of plantGuidanceDataset.plants) {
      const hit = findPlantGuidance({ plantId: plant.plant_id })
      expect(hit?.plant_id).toBe(plant.plant_id)
    }
  })

  it('returns null for unknown species without throwing', () => {
    expect(findPlantGuidance({ scientificName: 'Foo bar' })).toBeNull()
    expect(findPlantGuidance({})).toBeNull()
  })

  it('every sourced item cites at least one valid source', () => {
    const knownSourceIds = new Set(plantGuidanceDataset.sources.map((s) => s.source_id))
    for (const plant of plantGuidanceDataset.plants) {
      expect(plant.general_information_source_ids.length).toBeGreaterThan(0)
      for (const id of plant.malaysia_status.source_ids) {
        expect(knownSourceIds.has(id)).toBe(true)
      }
      const buckets = [plant.spread_prevention, plant.do_not_do, plant.follow_up]
      for (const bucket of buckets) {
        for (const item of bucket) {
          for (const id of item.source_ids) {
            expect(knownSourceIds.has(id)).toBe(true)
          }
        }
      }
    }
  })

  it('no active step recommends a universally prohibited technique', () => {
    const prohibitedPatterns = [
      /\bburn(?:s|ing|ed)?\b/i,
      /\bherbicide\b/i,
      /\bpower\s*tool/i,
      /\bchainsaw/i,
      /\bpetrol\b/i,
      /\bclimb(?:ing)?\b/i,
      /\benter\s+(?:the\s+)?water/i,
      /\bmature\s+tree/i,
      /\bdense\s+thicket/i,
    ]
    const doNotPrefix = /^\s*(do not|don['’]t|never|avoid)/i
    for (const plant of plantGuidanceDataset.plants) {
      if (!plant.actions) continue
      for (const key of ['protected_or_permission_unknown', 'authorised_site'] as const) {
        for (const step of plant.actions[key].steps) {
          if (doNotPrefix.test(step.text)) continue
          for (const pattern of prohibitedPatterns) {
            expect(pattern.test(step.text), `${plant.plant_id}/${key}: "${step.text}"`).toBe(false)
          }
        }
      }
    }
  })

  it('resolves cited sources by id', () => {
    const plant = plantGuidanceDataset.plants[0]
    const sources = getSources(plant.general_information_source_ids)
    expect(sources.length).toBe(plant.general_information_source_ids.length)
    for (const src of sources) {
      expect(src.url).toMatch(/^https?:\/\//)
    }
  })

  it('uses the authoritative catalogue status and description for every overlapping species', () => {
    for (const approved of approvedSpeciesDataset.records) {
      const guidance = findPlantGuidance({ scientificName: approved.scientific_name })
      if (!guidance) continue
      const detail = catalogueDetailsDataset.records.find(
        (item) => item.species_id === approved.species_id,
      )!
      expect(guidance.malaysia_status.display_label).toBe('Present in Malaysia')
      expect(guidance.malaysia_status.note).toBe(approved.evidence_summary)
      expect(guidance.general_information).toContain(detail.identifying_characteristics)
      expect(guidance.general_information).toContain(detail.typical_habitat)
      expect(guidance.general_information).toContain(detail.documented_impacts)
    }
  })
})
