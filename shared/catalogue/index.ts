// InvaTrace Iteration 1 authoritative offline catalogue.
//
// This module is the ONLY sanctioned way for either the frontend or the
// backend-facing tests to read Malaysian plant status. Do not import the
// raw JSON directly from anywhere else, and do not re-derive status from
// the model manifest.
import manifestJson from './catalogue-manifest.json'
import statusJson from './plant-status.json'
import guidanceJson from './plant-guidance.json'
import approvedSpeciesJson from './approved-species.json'
import catalogueDetailsJson from './catalogue-details.json'

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
  reuse_status?: string
}

export interface CatalogueDetailRecord {
  species_id: string
  identifying_characteristics: string
  typical_habitat: string
  documented_impacts: string
  safe_response_guidance: string[]
  source_ids: {
    identification: string[]
    habitat: string[]
    impacts: string[]
    guidance: string[]
  }
  reviewed_at: string
}

export interface CatalogueDetailsDataset {
  schema_version: 'invatrace.catalogue.details.v1'
  catalogue_version: string
  reviewed_at: string
  record_count: 32
  sources: Array<CatalogueSource & { reuse_status: string }>
  records: CatalogueDetailRecord[]
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

export interface PendingCatalogueAsset {
  species_id: string
  url: string
  sha256: string
  byte_length: number
  review_status: 'provenance_pending'
}

export interface ApprovedCatalogueAsset {
  species_id: string
  url: string
  sha256: string
  byte_length: number
  review_status: 'approved'
  creator: string
  licence: string
  licence_url: string
  source_title: string
  source_url_or_identifier: string
  reviewed_at: string
  retrieved_at: string
  attribution_text: string
}

export type CatalogueAsset = PendingCatalogueAsset | ApprovedCatalogueAsset

export interface CatalogueManifest {
  schema_version: string
  catalogue_version: string
  content_version: string
  model_version: string
  last_reviewed: string
  generated_at: string
  assets: CatalogueAsset[]
  files: {
    'approved-species.json': { sha256: string; byte_length: number; schema_version: string; record_count?: number }
    'plant-status.json': { sha256: string; byte_length: number; schema_version: string; record_count?: number }
    'plant-guidance.json': { sha256: string; byte_length: number; schema_version: string; record_count?: number }
    'reference-images.json': { sha256: string; byte_length: number; schema_version: string; record_count?: number }
    'catalogue-details.json': { sha256: string; byte_length: number; schema_version: string; record_count?: number }
  }
}

export interface ApprovedSpeciesRecord {
  species_id: string
  scientific_name: string
  accepted_scientific_name?: string
  common_names: string[]
  malaysia_status: 'Present'
  evidence_source_ids: string[]
  evidence_summary: string
  habitats: Array<'terrestrial' | 'freshwater'>
  water_dispersed: boolean
  status_reviewed_at: string
}

export interface ApprovedSpeciesDataset {
  schema_version: 'invatrace.approved-species.v1'
  catalogue_version: string
  reviewed_at: string
  jurisdiction: 'Malaysia'
  record_count: 32
  records: ApprovedSpeciesRecord[]
  sources: CatalogueSource[]
}

export const catalogueManifest = manifestJson as CatalogueManifest
export const plantStatusDataset = statusJson as unknown as PlantStatusDataset
export const approvedSpeciesDataset = approvedSpeciesJson as unknown as ApprovedSpeciesDataset
export const catalogueDetailsDataset = catalogueDetailsJson as unknown as CatalogueDetailsDataset

// Deliberately re-exported as `unknown` to keep the frontend's richer
// PlantGuidanceDataset type as the single typed shape for guidance.
export const rawGuidanceJson = guidanceJson as unknown

export function isApprovedCatalogueAsset(
  asset: CatalogueAsset,
): asset is ApprovedCatalogueAsset {
  return asset.review_status === 'approved'
}

export function approvedCatalogueAsset(url: string | null | undefined): ApprovedCatalogueAsset | null {
  if (!url) return null
  const asset = catalogueManifest.assets.find((candidate) => candidate.url === url)
  return asset && isApprovedCatalogueAsset(asset) ? asset : null
}

export function approvedCatalogueAssetForSpecies(speciesId: string): ApprovedCatalogueAsset | null {
  const normalizedId = speciesIdKey(speciesId)
  const asset = catalogueManifest.assets.find((candidate) => candidate.species_id === normalizedId)
  return asset && isApprovedCatalogueAsset(asset) ? asset : null
}

const normalize = (value: string): string => value.trim().toLowerCase()
const speciesIdKey = (value: string): string => normalize(value).replace(/_/g, '-')

const byModelLabel = new Map<string, PlantStatusRecord>()
const bySpeciesId = new Map<string, PlantStatusRecord>()
const byScientificName = new Map<string, PlantStatusRecord>()
const approvedBySpeciesId = new Map<string, ApprovedSpeciesRecord>()
const approvedByScientificName = new Map<string, ApprovedSpeciesRecord>()

for (const record of plantStatusDataset.records) {
  byModelLabel.set(normalize(record.model_label), record)
  bySpeciesId.set(speciesIdKey(record.species_id), record)
  byScientificName.set(normalize(record.scientific_name), record)
}

for (const record of approvedSpeciesDataset.records) {
  approvedBySpeciesId.set(speciesIdKey(record.species_id), record)
  approvedByScientificName.set(normalize(record.scientific_name), record)
  if (record.accepted_scientific_name) {
    approvedByScientificName.set(normalize(record.accepted_scientific_name), record)
  }
}

export function findApprovedSpecies(query: {
  speciesId?: string | null
  scientificName?: string | null
}): ApprovedSpeciesRecord | null {
  if (query.speciesId) {
    const hit = approvedBySpeciesId.get(speciesIdKey(query.speciesId))
    if (hit) return hit
  }
  if (query.scientificName) {
    const hit = approvedByScientificName.get(normalize(query.scientificName))
    if (hit) return hit
  }
  return null
}

export function isApprovedSpecies(query: {
  speciesId?: string | null
  scientificName?: string | null
}): boolean {
  return findApprovedSpecies(query) !== null
}

export function findPlantStatus(query: {
  modelLabel?: string | null
  speciesId?: string | null
  scientificName?: string | null
}): PlantStatusRecord | null {
  // Match model label first - the model manifest is the only guaranteed
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

export function approvedSpeciesChecksum(): string {
  return catalogueManifest.files['approved-species.json'].sha256
}

export function plantStatusChecksum(): string {
  return catalogueManifest.files['plant-status.json'].sha256
}
