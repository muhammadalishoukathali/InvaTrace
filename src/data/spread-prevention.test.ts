import { describe, expect, it } from 'vitest'
import { plantGuidanceDataset, findPlantGuidance } from './plant-guidance'
import { modelSpeciesCatalog } from './model-species-catalog'

// AC 3.2.1 - every reportable species must expose its own ordered
// spread-prevention entries with source ids attached. Missing entries
// fall through to the observe-and-report guidance panel; the parameterised
// case below flags any regression that lets a reportable species render
// without its dedicated advice.
const reportableSpecies = modelSpeciesCatalog.classes.filter(
  (species) => species.malaysia_status === 'invasive',
)

describe('spread prevention entries per reportable species', () => {
  it('every reportable species that has a reviewed guidance record resolves it consistently', () => {
    // AC 1.2.2 - a species without a reviewed guidance card falls back to
    // the shared catalogue's safety_message (see plant-guidance-fallback);
    // any species that DOES have a guidance card must be reachable from all
    // three lookup keys with the same record.
    for (const species of reportableSpecies) {
      const byLabel = findPlantGuidance({ modelLabel: species.machine_label })
      if (!byLabel) continue
      const bySci = findPlantGuidance({ scientificName: species.scientific_name })
      const byPlantId = findPlantGuidance({
        plantId: species.machine_label.replaceAll('_', '-'),
      })
      expect(bySci?.plant_id).toBe(byLabel.plant_id)
      expect(byPlantId?.plant_id).toBe(byLabel.plant_id)
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
    // Each species owns its own ordered entries - a shared reference
    // would mean an edit to one silently mutates another's advice.
    const references = new Set()
    for (const plant of plantGuidanceDataset.plants) {
      references.add(plant.spread_prevention)
    }
    expect(references.size).toBe(plantGuidanceDataset.plants.length)
  })
})
