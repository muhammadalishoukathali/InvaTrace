import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import runtimeCatalog from '../../public/models/pulih-model1-v4/species_31.json'
import {
  findModelSpecies, modelReferenceImageUrl, modelSpeciesCatalog,
} from './model-species-catalog'

describe('shared model species catalogue', () => {
  it('matches the browser-model catalogue apart from AC 1.2.2 status downgrades', () => {
    // The wrapper downgrades three deferred labels' malaysia_status to
    // status_requires_expert_review at load time (see model-species-catalog.ts).
    // Everything else must remain identical to the bundled model kit so
    // class indexes, names, and reference filenames never drift.
    const deferred = new Set([
      'miconia_crenata', 'sphagneticola_trilobata', 'lantana_camara',
    ])
    expect({
      ...modelSpeciesCatalog,
      classes: modelSpeciesCatalog.classes.filter((item) => !deferred.has(item.machine_label)),
    }).toEqual({
      ...runtimeCatalog,
      classes: runtimeCatalog.classes.filter((item) => !deferred.has(item.machine_label)),
    })
    for (const machineLabel of deferred) {
      const runtimeEntry = runtimeCatalog.classes.find((item) => item.machine_label === machineLabel)
      const wrapperEntry = modelSpeciesCatalog.classes.find((item) => item.machine_label === machineLabel)
      expect(runtimeEntry?.malaysia_status).toBe('invasive')
      expect(wrapperEntry?.malaysia_status).toBe('status_requires_expert_review')
      expect(wrapperEntry?.status_source).toBe('')
    }
    expect(modelSpeciesCatalog.class_count).toBe(modelSpeciesCatalog.classes.length)
  })

  it('contains unique class indexes and machine labels', () => {
    expect(new Set(modelSpeciesCatalog.classes.map((item) => item.class_index)).size).toBe(31)
    expect(new Set(modelSpeciesCatalog.classes.map((item) => item.machine_label)).size).toBe(31)
  })

  it('resolves every model class and has a bundled general reference image', () => {
    for (const modelClass of modelSpeciesCatalog.classes) {
      const speciesId = modelClass.machine_label.replaceAll('_', '-')
      expect(findModelSpecies({ speciesId })).toBe(modelClass)
      expect(findModelSpecies({ scientificName: modelClass.scientific_name })).toBe(modelClass)
      const imageUrl = modelReferenceImageUrl(modelClass)
      const imagePath = fileURLToPath(new URL(`../../public${imageUrl}`, import.meta.url))
      expect(existsSync(imagePath), `${modelClass.machine_label} reference image`).toBe(true)
    }
  })
})
