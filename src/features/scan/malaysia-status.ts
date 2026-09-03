import type { IdentifyResult, MalaysiaStatusState } from '@/types'
import { findPlantStatus, plantStatusDataset, type PlantStatusRecord } from '@shared/catalogue'

/**
 * Iteration 1: Malaysian status is resolved once from the shared catalogue
 * (shared/catalogue/plant-status.json). The model manifest is trusted only
 * for the class list; the catalogue's ui_state is the source of truth here.
 *
 * A supported classification result carries a ui_state string from the
 * catalogue. If a lookup for the identified class fails at runtime (older
 * cached bundle, unknown label), the fallback is always status_uncertain —
 * never a permissive "safe/reportable" default.
 *
 * AC Iteration 1 P3 — the model manifest version and the catalogue version
 * must match. A model-version drift means the class list the classifier is
 * emitting may no longer align with what the catalogue was authored against,
 * so status is forced to `status_uncertain` and reporting is blocked until
 * the shipped catalogue catches up.
 */
const VALID_UI_STATES: ReadonlySet<MalaysiaStatusState> = new Set([
  'invasive',
  'information_only',
  'status_uncertain',
])

const CATALOGUE_MODEL_VERSION = plantStatusDataset.model_version

export type ResultPathway =
  | 'invasive_reportable'
  | 'invasive_unsupported'
  | 'information_only'
  | 'status_uncertain'
  | 'other_plant'
  | 'uncertain'

export interface ResolvedPathway {
  pathway: ResultPathway
  statusState: MalaysiaStatusState | null
  /** True when reporting is eligible from the catalogue's perspective —
   *  the trust/persistence/server gates still apply at the UI layer. */
  canReport: boolean
  /** True when in-panel removal/containment actions may be offered. */
  canAction: boolean
}

export function deriveMalaysiaStatusState(result: IdentifyResult): MalaysiaStatusState | null {
  if (result.outcome === 'uncertain') return null
  if (isVersionMismatch(result.modelVersion)) return 'status_uncertain'
  const catalogueRecord = resolveCatalogueRecord(result)
  if (catalogueRecord) return catalogueRecord.ui_state
  // Second-chance: the model adapter may already have attached a ui_state.
  const carried = result.malaysiaStatus
  if (carried && VALID_UI_STATES.has(carried as MalaysiaStatusState)) {
    return carried as MalaysiaStatusState
  }
  // Fail safe: no valid catalogue match ⇒ uncertain. Never derive invasive
  // or information-only from a missing lookup.
  return 'status_uncertain'
}

export function isReportEligible(state: MalaysiaStatusState | null): boolean {
  return state === 'invasive'
}

/**
 * Single decision point for what the result screen should render. Keeping
 * this pure (no store or DOM dependency) means the invasive / information-
 * only / status-uncertain pathways can be exercised in tests without
 * mounting the full page.
 */
export function resolveResultPathway(result: IdentifyResult): ResolvedPathway {
  if (result.outcome === 'uncertain') {
    return { pathway: 'uncertain', statusState: null, canReport: false, canAction: false }
  }
  if (result.outcome === 'other_plant') {
    // Other-plant already means "not on the tracked list" — status_uncertain
    // here is a convenience label; nothing to report or act on.
    return {
      pathway: 'other_plant',
      statusState: 'status_uncertain',
      canReport: false,
      canAction: false,
    }
  }
  const statusState = deriveMalaysiaStatusState(result)
  if (statusState === 'invasive') {
    // A reportable catalogue record is still the only invasive pathway that
    // offers action or reporting; unsupported target classes fall through.
    if (result.reportable) {
      return { pathway: 'invasive_reportable', statusState, canReport: true, canAction: true }
    }
    return { pathway: 'invasive_unsupported', statusState, canReport: false, canAction: false }
  }
  if (statusState === 'information_only') {
    return { pathway: 'information_only', statusState, canReport: false, canAction: false }
  }
  return { pathway: 'status_uncertain', statusState: 'status_uncertain', canReport: false, canAction: false }
}

function resolveCatalogueRecord(result: IdentifyResult): PlantStatusRecord | null {
  return findPlantStatus({
    speciesId: result.speciesId ?? null,
    scientificName: result.scientificName ?? null,
  })
}

function isVersionMismatch(resultVersion: string | undefined): boolean {
  if (!resultVersion || !CATALOGUE_MODEL_VERSION) return false
  return resultVersion !== CATALOGUE_MODEL_VERSION
}
