// This is the static, curated per-species guidance that shows up after a scan
// result - what the plant is, its status in Malaysia, and what someone should
// (and shouldn't) do about it. Nothing here is user-generated, it's all
// reviewed reference content bundled with the app. Gets read by
// src/features/scan/PlantGuidancePanel.tsx (via ScanResultPage.tsx) and also
// referenced from the map's sighting details/filters for the status labels.
//
// The actual content lives in ./plant-guidance.json and is supposed to match
// ./plant-guidance.schema.json. Worth noting that contract is only checked by
// the sibling plant-guidance.schema.test.ts - it's not enforced at runtime
// here, so if someone edits the JSON and breaks the schema it won't actually
// fail until the tests run.
import guidanceJson from '../../shared/catalogue/plant-guidance.json'
import { findPlantStatus } from '@shared/catalogue'

export type GuidanceMode =
  | 'general_information'
  | 'active_guidance'
  | 'site_manager_confirmation_required'
  | 'report_only'

export type MalaysiaStatusCategory =
  | 'invasive'
  | 'naturalised'
  | 'native'
  | 'introduced'
  | 'cultivated'
  | string

export interface SourceRef {
  source_id: string
  title: string
  publisher: string
  url: string
  accessed: string
  use: string
}

export interface SourcedItem {
  text: string
  source_ids: string[]
}

export interface ActionPath {
  title: string
  eligibility: string
  steps: SourcedItem[]
  stop_conditions: SourcedItem[]
  disposal: SourcedItem[]
}

export interface MalaysiaStatus {
  category: MalaysiaStatusCategory
  display_label: string
  confidence: 'high' | 'medium' | 'low'
  note: string
  source_ids: string[]
}

export interface PlantGuidance {
  plant_id: string
  model_label: string
  scientific_name: string
  common_names: string[]
  malaysia_status: MalaysiaStatus
  guidance_mode: GuidanceMode
  general_information: string
  general_information_source_ids: string[]
  identification_note: string
  risk_flags: string[]
  actions: {
    protected_or_permission_unknown: ActionPath
    authorised_site: ActionPath
  } | null
  spread_prevention: SourcedItem[]
  do_not_do: SourcedItem[]
  follow_up: SourcedItem[]
  /** Public-domain / CC-BY-SA reference photo bundled with the app - shows
   *  next to the panel header so people can compare their scan against a
   *  known-good specimen photo. */
  reference_image?: string
  reference_image_credit?: string
}

export interface SafetyPolicy {
  permission_rule: string
  model_rule: string
  protected_land_rule?: string
  never_recommend: string[]
  decision_logic?: string[]
}

export interface PlantGuidanceDataset {
  schema_version: string
  content_version: string
  last_reviewed?: string
  next_review_due?: string
  jurisdiction: string
  locale: string
  safety_policy: SafetyPolicy
  sources: SourceRef[]
  plants: PlantGuidance[]
}

const rawPlantGuidanceDataset = guidanceJson as unknown as PlantGuidanceDataset

// For iteration 1, the Malaysian status shown to the user is derived from the
// shared catalogue, not whatever status hints happen to be in this file.
// shared/catalogue/plant-status.json is the only real source of truth for
// ui_state - the labels below just exist to turn that raw ui_state value
// into something readable as a heading.
const UI_STATE_PRESENTATION: Record<string, Pick<MalaysiaStatus, 'category' | 'display_label' | 'confidence'>> = {
  invasive: {
    category: 'invasive', display_label: 'Invasive in Malaysia', confidence: 'high',
  },
  information_only: {
    category: 'information_only', display_label: 'Information only', confidence: 'high',
  },
  status_uncertain: {
    category: 'status_uncertain', display_label: 'Status uncertain', confidence: 'low',
  },
}

/**
 * The written guidance stays as curated content, but the actual identification
 * status always comes from the shared catalogue bundled with the model. Set it
 * up this way so an outdated guidance review can't end up relabelling a model
 * class in the result UI.
 */
export const plantGuidanceDataset: PlantGuidanceDataset = {
  ...rawPlantGuidanceDataset,
  plants: rawPlantGuidanceDataset.plants.map((plant) => {
    const record = findPlantStatus({
      speciesId: plant.plant_id,
      scientificName: plant.scientific_name,
      modelLabel: plant.model_label,
    })
    if (!record) return plant
    const presentation = UI_STATE_PRESENTATION[record.ui_state] ?? UI_STATE_PRESENTATION.status_uncertain
    return {
      ...plant,
      malaysia_status: {
        ...presentation,
        note: record.safety_message || plant.malaysia_status.note,
        // keeping the plant's own source refs here (S01 etc) - the shared
        // catalogue uses a completely different source namespace (GRIIS/MyIAS)
        // that comes through the status record itself, not this guidance
        // sources index, so mixing the two would just be wrong
        source_ids: plant.malaysia_status.source_ids,
      },
    }
  }),
}


const byScientificName = new Map<string, PlantGuidance>()
const byModelLabel = new Map<string, PlantGuidance>()
const byPlantId = new Map<string, PlantGuidance>()

for (const plant of plantGuidanceDataset.plants) {
  byScientificName.set(plant.scientific_name.toLowerCase(), plant)
  byModelLabel.set(plant.model_label.toLowerCase(), plant)
  byPlantId.set(plant.plant_id, plant)
}

const sourceIndex = new Map<string, SourceRef>()
for (const src of plantGuidanceDataset.sources) {
  sourceIndex.set(src.source_id, src)
}

function normalizePlantId(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, '_')
}

export function findPlantGuidance(query: {
  scientificName?: string | null
  modelLabel?: string | null
  plantId?: string | null
}): PlantGuidance | null {
  const { scientificName, modelLabel, plantId } = query
  if (plantId) {
    const hit = byPlantId.get(normalizePlantId(plantId))
    if (hit) return hit
  }
  if (scientificName) {
    const hit = byScientificName.get(scientificName.toLowerCase())
    if (hit) return hit
  }
  if (modelLabel) {
    const hit = byModelLabel.get(modelLabel.toLowerCase())
    if (hit) return hit
  }
  return null
}

export function getSources(sourceIds: string[]): SourceRef[] {
  const seen = new Set<string>()
  const out: SourceRef[] = []
  for (const id of sourceIds) {
    if (seen.has(id)) continue
    const src = sourceIndex.get(id)
    if (src) {
      out.push(src)
      seen.add(id)
    }
  }
  return out
}

export function getSafetyPolicy(): SafetyPolicy {
  return plantGuidanceDataset.safety_policy
}
