// Species catalog for the on-device Student33 model that ships with the app.
//
// I only trust the model manifest for the ordered list of classes - anything
// the UI actually branches on for Malaysian status comes from shared/catalogue
// instead. Set it up this way so swapping the model can't silently relabel a
// class in the UI; the shared catalogue has to be updated (and its sha256
// rechecked against the backend) as a separate, deliberate step.
import modelManifest from '../../public/models/invatrace-student33-v1/student33_species.json'
import {
  findPlantStatus,
  findApprovedSpecies,
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
  /** Whether this legacy model class is in the Iteration 2 business allowlist. */
  catalogue_approved: boolean
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
  unknown_index?: number
  classes: RawModelManifestClass[]
}

const rawManifest = modelManifest as RawModelManifest
const coreClasses = rawManifest.unknown_index === undefined
  ? rawManifest.classes
  : rawManifest.classes.filter((entry) => entry.class_index !== rawManifest.unknown_index)

export const modelSpeciesCatalog: ModelSpeciesCatalog = {
  schema_version: rawManifest.schema_version,
  model_version: rawManifest.model_version,
  class_count: coreClasses.length,
  classes: coreClasses.map((entry) => {
    const record = findPlantStatus({ modelLabel: entry.machine_label })
    const approved = findApprovedSpecies({ scientificName: entry.scientific_name })
    return {
      class_index: entry.class_index,
      machine_label: entry.machine_label,
      scientific_name: entry.scientific_name,
      display_name: entry.display_name,
      malaysia_status: approved ? 'invasive' : 'status_uncertain',
      status_source: approved?.evidence_source_ids[0] ?? record?.status_source_ids[0] ?? '',
      catalogue_approved: approved !== null,
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
