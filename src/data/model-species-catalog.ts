// Species catalog for the on-device PULIH model that ships with the app
// (see vendor/PULIH_Model1_v4_FP16_Web_Kit).
//
// I only trust the model manifest for the ordered list of classes - anything
// the UI actually branches on for Malaysian status comes from shared/catalogue
// instead. Set it up this way so swapping the model can't silently relabel a
// class in the UI; the shared catalogue has to be updated (and its sha256
// rechecked against the backend) as a separate, deliberate step.
import modelManifest from '../../vendor/PULIH_Model1_v4_FP16_Web_Kit/model/species_31.json'
import {
  findPlantStatus,
  plantStatusDataset,
  type PlantStatusRecord,
} from '@shared/catalogue'

export interface ModelSpeciesClass {
  class_index: number
  machine_label: string
  scientific_name: string
  display_name: string
  /** The reviewed Malaysian status, pulled from the shared catalogue. */
  malaysia_status: PlantStatusRecord['ui_state']
  /** First reviewed status source ID from the shared catalogue, if there is one. */
  status_source: string
}

export interface ModelSpeciesCatalog {
  schema_version: string
  model_version: string
  class_count: number
  classes: ModelSpeciesClass[]
}

interface RawModelManifestClass {
  class_index: number
  machine_label: string
  scientific_name: string
  display_name: string
}

interface RawModelManifest {
  schema_version: string
  model_version: string
  class_count: number
  classes: RawModelManifestClass[]
}

const rawManifest = modelManifest as RawModelManifest

if (rawManifest.class_count !== plantStatusDataset.records.length) {
  // this should never actually happen, but if the model manifest and the
  // catalogue ever disagree on class count I'd rather the build just fail
  // loudly than ship something with silently mismatched species data
  throw new Error(
    'InvaTrace catalogue and model manifest disagree on class count ' +
      `(manifest=${rawManifest.class_count}, catalogue=${plantStatusDataset.records.length}).`,
  )
}

export const modelSpeciesCatalog: ModelSpeciesCatalog = {
  schema_version: rawManifest.schema_version,
  model_version: rawManifest.model_version,
  class_count: rawManifest.class_count,
  classes: rawManifest.classes.map((entry) => {
    const record = findPlantStatus({ modelLabel: entry.machine_label })
    if (!record) {
      throw new Error(
        `InvaTrace catalogue is missing a plant-status record for model class "${entry.machine_label}".`,
      )
    }
    return {
      class_index: entry.class_index,
      machine_label: entry.machine_label,
      scientific_name: entry.scientific_name,
      display_name: entry.display_name,
      malaysia_status: record.ui_state,
      status_source: record.status_source_ids[0] ?? '',
    }
  }),
}

const bySpeciesId = new Map(
  modelSpeciesCatalog.classes.map((item) => [item.machine_label.replaceAll('_', '-'), item]),
)
const byScientificName = new Map(
  modelSpeciesCatalog.classes.map((item) => [item.scientific_name.toLowerCase(), item]),
)

export function findModelSpecies(query: {
  speciesId?: string | null
  scientificName?: string | null
}): ModelSpeciesClass | null {
  if (query.speciesId) {
    const hit = bySpeciesId.get(query.speciesId.trim().toLowerCase().replaceAll('_', '-'))
    if (hit) return hit
  }
  if (query.scientificName) {
    const hit = byScientificName.get(query.scientificName.trim().toLowerCase())
    if (hit) return hit
  }
  return null
}

export function modelReferenceImageUrl(modelSpecies: ModelSpeciesClass): string {
  return `/reference-images/${modelSpecies.machine_label}.jpg`
}
