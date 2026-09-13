import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import runtimeCatalog from '../../public/models/pulih-model1-v4/species_31.json'
import {
  approvedSpeciesDataset,
  approvedCatalogueAsset,
  approvedCatalogueAssetForSpecies,
  catalogueManifest,
  catalogueSourceById,
  findPlantStatus,
  plantStatusChecksum,
  plantStatusDataset,
  type PlantUiState,
  findApprovedSpecies,
} from './index'
import approvedSpeciesSchema from './approved-species.schema.json'
import plantStatusSchema from './schemas/plant-status.schema.json'
import manifestSchema from './schemas/catalogue-manifest.schema.json'
import referenceImagesSchema from './schemas/reference-images.schema.json'
import referenceImages from './reference-images.json'

const STATUS_PATH = fileURLToPath(new URL('./plant-status.json', import.meta.url))
const GUIDANCE_PATH = fileURLToPath(new URL('./plant-guidance.json', import.meta.url))
const APPROVED_PATH = fileURLToPath(new URL('./approved-species.json', import.meta.url))
const REFERENCE_IMAGES_PATH = fileURLToPath(new URL('./reference-images.json', import.meta.url))
const PUBLIC_ROOT = fileURLToPath(new URL('../../public/', import.meta.url))

function ajv() {
  const validator = new Ajv2020({ allErrors: true, strict: false })
  validator.addFormat('date', /^\d{4}-\d{2}-\d{2}$/)
  validator.addFormat('uri', {
    validate(value: string) {
      try {
        new URL(value)
        return true
      } catch {
        return false
      }
    },
  })
  return validator
}

describe('Iteration 2 approved species catalogue', () => {
  it('contains exactly the 32 unique evidence-reviewed plants', () => {
    const validate = ajv().compile(approvedSpeciesSchema)
    expect(validate(approvedSpeciesDataset), JSON.stringify(validate.errors)).toBe(true)
    expect(approvedSpeciesDataset.records).toHaveLength(32)
    expect(new Set(approvedSpeciesDataset.records.map((record) => record.species_id)).size).toBe(32)
    expect(new Set(approvedSpeciesDataset.records.map((record) => record.scientific_name)).size).toBe(32)
  })

  it('excludes Ageratina adenophora and legacy model-only plants', () => {
    expect(findApprovedSpecies({ scientificName: 'Ageratina adenophora' })).toBeNull()
    expect(findApprovedSpecies({ speciesId: 'alternanthera-philoxeroides' })).toBeNull()
    expect(findApprovedSpecies({ speciesId: 'lantana-camara' })).toBeNull()
  })

  it('resolves IDs, recorded names, and accepted-name synonyms', () => {
    expect(findApprovedSpecies({ speciesId: 'salvinia_molesta' })?.scientific_name)
      .toBe('Salvinia molesta')
    expect(findApprovedSpecies({ scientificName: 'Cenchrus polystachios' })?.species_id)
      .toBe('pennisetum-polystachyum')
    expect(findApprovedSpecies({ scientificName: 'Brachiaria mutica' })?.species_id)
      .toBe('urochloa-mutica')
  })
})

describe('shared catalogue plant-status.json', () => {
  it('conforms to plant-status.schema.json', () => {
    const validate = ajv().compile(plantStatusSchema)
    const ok = validate(plantStatusDataset)
    if (!ok) {
      const message = (validate.errors ?? [])
        .slice(0, 10)
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('\n')
      throw new Error(`plant-status.json failed schema validation:\n${message}`)
    }
    expect(ok).toBe(true)
  })

  it('has exactly one record per released model class', () => {
    expect(plantStatusDataset.records).toHaveLength(runtimeCatalog.class_count)
    const modelLabels = new Set(runtimeCatalog.classes.map((entry) => entry.machine_label))
    for (const record of plantStatusDataset.records) {
      expect(modelLabels.has(record.model_label)).toBe(true)
    }
  })

  it('routes unknown labels to null (never a permissive default)', () => {
    expect(findPlantStatus({ modelLabel: 'no_such_label' })).toBeNull()
    expect(findPlantStatus({ speciesId: 'nonexistent-species' })).toBeNull()
    expect(findPlantStatus({})).toBeNull()
  })

  it('resolves every model label case-insensitively', () => {
    for (const entry of runtimeCatalog.classes) {
      const record = findPlantStatus({ modelLabel: entry.machine_label })
      expect(record).not.toBeNull()
      expect(record?.model_label).toBe(entry.machine_label)
      const upper = findPlantStatus({ modelLabel: entry.machine_label.toUpperCase() })
      expect(upper?.model_label).toBe(entry.machine_label)
    }
  })

  it('references only known source IDs from status_source_ids', () => {
    const knownSources = new Set(plantStatusDataset.sources.map((s) => s.source_id))
    for (const record of plantStatusDataset.records) {
      for (const id of record.status_source_ids) {
        expect(knownSources.has(id)).toBe(true)
      }
    }
    // Every invasive record cites at least one source.
    for (const record of plantStatusDataset.records) {
      if (record.ui_state === 'invasive') {
        expect(record.status_source_ids.length).toBeGreaterThan(0)
        expect(record.report_eligible).toBe(true)
      } else {
        expect(record.report_eligible).toBe(false)
      }
    }
  })

  it('routes the three previously conflicting classes to status_uncertain', () => {
    const deferred: Array<[string, PlantUiState]> = [
      ['miconia_crenata', 'status_uncertain'],
      ['sphagneticola_trilobata', 'status_uncertain'],
      ['lantana_camara', 'status_uncertain'],
    ]
    for (const [label, expected] of deferred) {
      const record = findPlantStatus({ modelLabel: label })
      expect(record?.ui_state).toBe(expected)
    }
  })

  it('catalogueSourceById returns a source or undefined', () => {
    expect(catalogueSourceById('griis-malaysia-v1_3')?.title).toContain('GRIIS')
    expect(catalogueSourceById('does-not-exist')).toBeUndefined()
  })
})

describe('shared catalogue manifest', () => {
  it('conforms to catalogue-manifest.schema.json', () => {
    const validate = ajv().compile(manifestSchema)
    const ok = validate(catalogueManifest)
    expect(ok, JSON.stringify(validate.errors)).toBe(true)
  })

  it('records the actual sha256 and byte length of every offline catalogue file', () => {
    const statusBytes = readFileSync(STATUS_PATH)
    const guidanceBytes = readFileSync(GUIDANCE_PATH)
    const approvedBytes = readFileSync(APPROVED_PATH)
    const referenceImageBytes = readFileSync(REFERENCE_IMAGES_PATH)
    expect(createHash('sha256').update(approvedBytes).digest('hex'))
      .toBe(catalogueManifest.files['approved-species.json'].sha256)
    expect(approvedBytes.length).toBe(catalogueManifest.files['approved-species.json'].byte_length)
    expect(createHash('sha256').update(statusBytes).digest('hex'))
      .toBe(catalogueManifest.files['plant-status.json'].sha256)
    expect(createHash('sha256').update(guidanceBytes).digest('hex'))
      .toBe(catalogueManifest.files['plant-guidance.json'].sha256)
    expect(createHash('sha256').update(referenceImageBytes).digest('hex'))
      .toBe(catalogueManifest.files['reference-images.json'].sha256)
    expect(referenceImageBytes.length)
      .toBe(catalogueManifest.files['reference-images.json'].byte_length)
    expect(plantStatusChecksum())
      .toBe(catalogueManifest.files['plant-status.json'].sha256)
  })

  it('uses approved catalogue release metadata and keeps model version separate', () => {
    expect(catalogueManifest.catalogue_version).toBe(approvedSpeciesDataset.catalogue_version)
    expect(catalogueManifest.model_version).toBe(plantStatusDataset.model_version)
    expect(catalogueManifest.last_reviewed).toBe(approvedSpeciesDataset.reviewed_at)
  })

  it('approves exactly one locally verified provenance image for each approved species', () => {
    const validateReferenceImages = ajv().compile(referenceImagesSchema)
    expect(validateReferenceImages(referenceImages), JSON.stringify(validateReferenceImages.errors))
      .toBe(true)
    expect(catalogueManifest.assets).toHaveLength(32)
    expect(catalogueManifest.assets.every((asset) => asset.review_status === 'approved')).toBe(true)
    expect(new Set(catalogueManifest.assets.map((asset) => asset.species_id)).size).toBe(32)
    expect(new Set(catalogueManifest.assets.map((asset) => asset.url)).size).toBe(32)

    for (const record of approvedSpeciesDataset.records) {
      const asset = approvedCatalogueAssetForSpecies(record.species_id)
      expect(asset).not.toBeNull()
      if (!asset) continue
      const bytes = readFileSync(`${PUBLIC_ROOT}${asset.url}`)
      expect(bytes.length).toBe(asset.byte_length)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
      expect(asset.creator).not.toBe('')
      expect(asset.licence_url).toMatch(/^https?:\/\//)
      expect(asset.source_url_or_identifier).toMatch(/^https:\/\/commons\.wikimedia\.org\//)
      expect(asset.attribution_text).toContain('Wikimedia Commons')
    }
    expect(approvedCatalogueAsset('/reference-images/mikania_micrantha.jpg')?.species_id)
      .toBe('mikania-micrantha')
  })

  it('rejects an approved image when provenance metadata is incomplete', () => {
    const validate = ajv().compile(manifestSchema)
    const invalid = structuredClone(catalogueManifest) as unknown as {
      assets: Array<Record<string, unknown>>
    }
    invalid.assets = [{
      ...invalid.assets[0],
      creator: '',
    }]
    expect(validate(invalid)).toBe(false)
  })
})
