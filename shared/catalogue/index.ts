// InvaTrace Iteration 1 authoritative offline catalogue.
//
// This module is the ONLY sanctioned way for either the frontend or the
// backend-facing tests to read Malaysian plant status. Do not import the
// raw JSON directly from anywhere else, and do not re-derive status from
// the model manifest.
import manifestJson from './catalogue-manifest.json'
import statusJson from './plant-status.json'
import guidanceJson from './plant-guidance.json'

export type PlantUiState = 'invasive' | 'information_only' | 'status_uncertain'

export interface PlantStatusRecord {
  species_id: string
  model_label: string
  class_index: number
  scientific_name: string
  common_name?: string
  ui_state: PlantUiState
  general_information: string
  safety_message: string
  status_source_ids: string[]
  status_reviewed_at: string
  report_eligible: boolean
}

export interface CatalogueSource {
  source_id: string
  title: string
  publisher: string
  url: string
  accessed: string
}

export interface PlantStatusDataset {
  schema_version: string
  catalogue_version: string
  model_version: string
  last_reviewed: string
  class_count: number
  records: PlantStatusRecord[]
  sources: CatalogueSource[]
}

export interface CatalogueManifest {
  schema_version: string
  catalogue_version: string
  content_version: string
  model_version: string
  last_reviewed: string
  files: {
    'plant-status.json': { sha256: string; byte_length: number; schema_version: string; record_count?: number }
    'plant-guidance.json': { sha256: string; byte_length: number; schema_version: string; record_count?: number }
  }
}

export const catalogueManifest = manifestJson as CatalogueManifest
export const plantStatusDataset = statusJson as unknown as PlantStatusDataset

// Deliberately re-exported as `unknown` to keep the frontend's richer
// PlantGuidanceDataset type as the single typed shape for guidance.
export const rawGuidanceJson = guidanceJson as unknown

const normalize = (value: string): string => value.trim().toLowerCase()
const speciesIdKey = (value: string): string => normalize(value).replace(/_/g, '-')

const byModelLabel = new Map<string, PlantStatusRecord>()
const bySpeciesId = new Map<string, PlantStatusRecord>()
const byScientificName = new Map<string, PlantStatusRecord>()

for (const record of plantStatusDataset.records) {
  byModelLabel.set(normalize(record.model_label), record)
  bySpeciesId.set(speciesIdKey(record.species_id), record)
  byScientificName.set(normalize(record.scientific_name), record)
}

export function findPlantStatus(query: {
  modelLabel?: string | null
  speciesId?: string | null
  scientificName?: string | null
}): PlantStatusRecord | null {
  // Match model label first — the model manifest is the only guaranteed
  // stable identifier for a class the ONNX model can output.
  if (query.modelLabel) {
    const hit = byModelLabel.get(normalize(query.modelLabel))
    if (hit) return hit
  }
  if (query.speciesId) {
    const hit = bySpeciesId.get(speciesIdKey(query.speciesId))
    if (hit) return hit
  }
  // Scientific-name fallback is documented as a last resort. Callers that
  // reach it should log the lookup so we can spot systematic drift.
  if (query.scientificName) {
    const hit = byScientificName.get(normalize(query.scientificName))
    if (hit) return hit
  }
  return null
}

export function catalogueSourceById(sourceId: string): CatalogueSource | undefined {
  return plantStatusDataset.sources.find((entry) => entry.source_id === sourceId)
}

export function catalogueVersion(): string {
  return catalogueManifest.catalogue_version
}

export function plantStatusChecksum(): string {
  return catalogueManifest.files['plant-status.json'].sha256
}
