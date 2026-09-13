import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import runtimeCatalog from '../../public/models/pulih-model1-v4/species_31.json'
import { approvedSpeciesDataset, findApprovedSpecies } from '@shared/catalogue'
import {
  findModelSpecies, modelReferenceImageUrl, modelSpeciesCatalog,
} from './model-species-catalog'

describe('shared model species catalogue', () => {
  it('keeps the pending business catalogue separate from the shipped model', () => {
    expect(modelSpeciesCatalog.class_count).toBe(runtimeCatalog.class_count)
    expect(modelSpeciesCatalog.classes).toHaveLength(runtimeCatalog.class_count)
    expect(approvedSpeciesDataset.records).toHaveLength(32)
  })

  it('only marks old model classes invasive when they are approved', () => {
    const allowed = new Set(['invasive', 'information_only', 'status_uncertain'])
    for (const cls of modelSpeciesCatalog.classes) {
      expect(allowed.has(cls.malaysia_status)).toBe(true)
      const approved = findApprovedSpecies({ scientificName: cls.scientific_name })
      expect(cls.catalogue_approved).toBe(approved !== null)
      expect(cls.malaysia_status).toBe(approved ? 'invasive' : 'status_uncertain')
    }
  })

  it('routes the three previously conflicting classes to their catalogue status', () => {
    // AC Iteration 1 P1 required tests - Miconia crenata, Sphagneticola
    // trilobata, and Lantana camara currently show the catalogue's
    // status_uncertain rather than the model manifest's "invasive".
    const deferred = ['miconia_crenata', 'sphagneticola_trilobata', 'lantana_camara']
    for (const machineLabel of deferred) {
      const runtimeEntry = runtimeCatalog.classes.find((item) => item.machine_label === machineLabel)
      const wrapperEntry = modelSpeciesCatalog.classes.find((item) => item.machine_label === machineLabel)
      expect(runtimeEntry?.malaysia_status).toBe('invasive')
      expect(wrapperEntry?.malaysia_status).toBe('status_uncertain')
      expect(wrapperEntry?.status_source).toBe('')
    }
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
