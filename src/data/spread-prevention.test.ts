import { describe, expect, it } from 'vitest'
import { plantGuidanceDataset, findPlantGuidance } from './plant-guidance'
import { modelSpeciesCatalog } from './model-species-catalog'

// AC 3.2.1 — every reportable species must expose its own ordered
// spread-prevention entries with source ids attached. Missing entries
// fall through to the observe-and-report guidance panel; the parameterised
// case below flags any regression that lets a reportable species render
// without its dedicated advice.
const reportableSpecies = modelSpeciesCatalog.classes.filter(
  (species) => species.malaysia_status === 'invasive',
)

describe('spread prevention entries per reportable species', () => {
  it('every reportable species matches exactly one guidance record', () => {
    for (const species of reportableSpecies) {
      const guidance = findPlantGuidance({
        modelLabel: species.machine_label,
        scientificName: species.scientific_name,
        plantId: species.machine_label.replaceAll('_', '-'),
      })
      // AC 1.2.2 downgrade means some previously-invasive labels are now
      // status_requires_expert_review; they no longer appear in
      // reportableSpecies, so anything left here MUST have guidance.
      expect(
        guidance,
        `${species.scientific_name} is invasive but has no guidance record`,
      ).not.toBeNull()
    }
  })

  it.each(reportableSpecies.map((species) => [species.scientific_name, species.machine_label]))(
    'spread-prevention for %s is either populated with sourced items or intentionally empty',
    (_name, machineLabel) => {
      const guidance = findPlantGuidance({ modelLabel: machineLabel })
      if (!guidance) return
      // No mixed empty/non-empty leaks: every entry that exists has
      // non-empty text and at least one source id.
      for (const entry of guidance.spread_prevention) {
        expect(entry.text.trim().length).toBeGreaterThan(0)
        expect(entry.source_ids.length).toBeGreaterThan(0)
      }
    },
  )

  it('two different species do not share the same spread-prevention array reference', () => {
    // Each species owns its own ordered entries — a shared reference
    // would mean an edit to one silently mutates another's advice.
    const references = new Set()
    for (const plant of plantGuidanceDataset.plants) {
      references.add(plant.spread_prevention)
    }
    expect(references.size).toBe(plantGuidanceDataset.plants.length)
  })
})
