import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020'
import runtimeCatalog from '../../public/models/pulih-model1-v4/species_31.json'
import {
  catalogueManifest,
  catalogueSourceById,
  findPlantStatus,
  plantStatusChecksum,
  plantStatusDataset,
  type PlantUiState,
} from './index'
import plantStatusSchema from './schemas/plant-status.schema.json'
import manifestSchema from './schemas/catalogue-manifest.schema.json'

const STATUS_PATH = fileURLToPath(new URL('./plant-status.json', import.meta.url))
const GUIDANCE_PATH = fileURLToPath(new URL('./plant-guidance.json', import.meta.url))

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

  it('records the actual sha256 of plant-status.json / plant-guidance.json', () => {
    const statusBytes = readFileSync(STATUS_PATH)
    const guidanceBytes = readFileSync(GUIDANCE_PATH)
    expect(createHash('sha256').update(statusBytes).digest('hex'))
      .toBe(catalogueManifest.files['plant-status.json'].sha256)
    expect(createHash('sha256').update(guidanceBytes).digest('hex'))
      .toBe(catalogueManifest.files['plant-guidance.json'].sha256)
    expect(plantStatusChecksum())
      .toBe(catalogueManifest.files['plant-status.json'].sha256)
  })

  it('agrees with plant-status.json on version + model_version', () => {
    expect(catalogueManifest.catalogue_version).toBe(plantStatusDataset.catalogue_version)
    expect(catalogueManifest.model_version).toBe(plantStatusDataset.model_version)
    expect(catalogueManifest.last_reviewed).toBe(plantStatusDataset.last_reviewed)
  })
})
