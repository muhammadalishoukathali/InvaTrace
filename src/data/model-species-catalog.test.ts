import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import runtimeCatalog from '../../public/models/invatrace-student33-v1/student33_species.json'
import { approvedSpeciesDataset, findApprovedSpecies } from '@shared/catalogue'
import {
  findModelSpecies, modelReferenceImageUrl, modelSpeciesCatalog,
} from './model-species-catalog'

describe('shared model species catalogue', () => {
  it('exposes the 32 core-target classes and hides the Unknown bucket', () => {
    expect(runtimeCatalog.class_count).toBe(33)
    expect(runtimeCatalog.unknown_index).toBe(32)
    expect(modelSpeciesCatalog.class_count).toBe(32)
    expect(modelSpeciesCatalog.classes).toHaveLength(32)
    expect(approvedSpeciesDataset.records).toHaveLength(32)
  })

  it('only marks model classes invasive when they are approved', () => {
    const allowed = new Set(['invasive', 'information_only', 'status_uncertain'])
    for (const cls of modelSpeciesCatalog.classes) {
      expect(allowed.has(cls.malaysia_status)).toBe(true)
      const approved = findApprovedSpecies({ scientificName: cls.scientific_name })
      expect(cls.catalogue_approved).toBe(approved !== null)
      expect(cls.malaysia_status).toBe(approved ? 'invasive' : 'status_uncertain')
    }
  })

  it('every core-target class matches a shared-catalogue record', () => {
    for (const cls of modelSpeciesCatalog.classes) {
      expect(cls.catalogue_approved).toBe(true)
      expect(cls.malaysia_status).toBe('invasive')
    }
  })

  it('contains unique class indexes and machine labels', () => {
    expect(new Set(modelSpeciesCatalog.classes.map((item) => item.class_index)).size).toBe(32)
    expect(new Set(modelSpeciesCatalog.classes.map((item) => item.machine_label)).size).toBe(32)
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
