// Canned Plant Assistant responses for the mock/UI-contract layer of Epic 8.
//
// Every shape here mirrors AskResponse / AnswerSection / Source in
// backend/app/api/routers/plant_assistant.py as the API serialises them
// (camelCase), and the section titles, warning and boundary are the literal
// strings the backend emits (assistant_conversation.section, AI_WARNING,
// SAFETY_BOUNDARY). Source names and URLs are real records from
// backend/app/data/plant-assistant-knowledge.json. Nothing here proves the
// backend chose the right response: that is the real-stack spec's job.
import { expect, type BrowserContext, type Page, type Route } from '@playwright/test'
import { stubAssistant } from './app'

export type Depth = 'standard' | 'simpler' | 'detailed'

export interface Source {
  chunkId: string
  sourceName: string
  sourceUrl: string
  jurisdiction: string
  sourceDate: string | null
  attribution: string | null
  sourceLicense: string | null
  sourceLicenseUrl: string | null
}

export interface Section {
  kind: 'grounded' | 'ai' | 'conversation' | 'unavailable'
  title: string
  answer: string
  depth: Depth
  sources: Source[]
  warning: string | null
}

export interface AskResponse {
  status: 'answer' | 'fallback' | 'insufficient_evidence' | 'unsupported_scan'
  answerability: 'answerable' | 'insufficient_evidence'
  answer: string
  sources: Source[]
  safetyBoundary: string
  coveredTopics: string[]
  answerMode: 'grounded' | 'general_knowledge' | 'fallback'
  coverage: 'fully_supported' | 'partially_supported' | 'unsupported' | 'uncertain'
  intent: 'botanical' | 'catalogue' | 'greeting' | 'off_topic' | 'ambiguous' | 'restricted'
  sections: Section[]
  mixedDepthNotice: string | null
}

/** What the panel posts. Scan sends classifier fields, Guide a species ID and
 *  Map only a sighting ID; the rest is shared. */
export interface AskBody {
  question: string
  depth: Depth
  allowGeneralKnowledge: boolean
  sectionAware: boolean
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  previousAnswer?: string
  speciesId?: string | null
  classifierConfidence?: number
  classifierOutcome?: string
  sightingId?: string
}

export interface Asked { path: string; body: AskBody }

export const SAFETY_BOUNDARY = 'This assistant does not grant permission to touch, collect, transport or remove a plant, '
  + 'or to enter restricted areas. Follow the existing safety, site-permission and protected-area '
  + 'checks. If permission or protection is uncertain, leave the plant undisturbed and observe '
  + 'from a safe, permitted location.'
export const AI_WARNING = 'This information was generated using AI knowledge and has not been verified against '
  + "InvaTrace's reviewed sources. It may contain inaccuracies."
export const REDIRECT = 'I can help with plants. Ask about their appearance, habitats or botanical concepts.'

const QLD_URL = 'https://www.business.qld.gov.au/industries/farms-fishing-forestry/agriculture/biosecurity/plants/invasive/restricted/mikania-vine'

/** CAT-mikania-micrantha-habitat: the catalogue summary citation. */
export const HABITAT_SOURCE: Source = {
  chunkId: 'CAT-mikania-micrantha-habitat', sourceName: 'Mikania vine', sourceUrl: QLD_URL,
  jurisdiction: 'Malaysia project-reviewed summary', sourceDate: null,
  attribution: null, sourceLicense: null, sourceLicenseUrl: null,
}
/** CAT-mikania-micrantha-safe_response: the Malaysian action-plan citation. */
export const SAFE_RESPONSE_SOURCE: Source = {
  chunkId: 'CAT-mikania-micrantha-safe_response',
  sourceName: 'National Action Plan on Invasive Alien Species 2021–2025',
  sourceUrl: 'https://www.doa.gov.my/doa/resources/aktiviti_sumber/sumber_awam/penerbitan/buku/national_action_plan_on_invasive_alien_species_2021-2025.pdf',
  jurisdiction: 'Malaysia project-reviewed summary', sourceDate: null,
  attribution: null, sourceLicense: null, sourceLicenseUrl: null,
}
/** CAT-asclepias-curassavica-hazard-contact: a reviewed hazard record. */
export const HAZARD_SOURCE: Source = {
  chunkId: 'CAT-asclepias-curassavica-hazard-contact', sourceName: 'Asclepias curassavica',
  sourceUrl: 'https://www.nparks.gov.sg/florafaunaweb/flora/1/6/1693',
  jurisdiction: 'Malaysia project-reviewed summary', sourceDate: null,
  attribution: null, sourceLicense: null, sourceLicenseUrl: null,
}

export const HABITAT_TEXT = 'Plantations, forest edges, riverbanks, roadsides and moist disturbed vegetation.'
export const SAFE_RESPONSE_TEXT = 'Do not pull vines through vegetation or leave stem fragments on moist soil. Photograph, map and report the patch for authorised management.'
export const HAZARD_TEXT = 'Milky sap can irritate skin.'
export const RHIZOME_TEXT = 'A rhizome is a horizontal underground stem that can produce new shoots.'

const TITLES: Record<Section['kind'], string> = {
  grounded: 'From reviewed sources', ai: 'AI knowledge',
  conversation: 'Plant conversation', unavailable: 'Information unavailable',
}

export function section(kind: Section['kind'], answer: string, depth: Depth = 'standard', sources: Source[] = []): Section {
  return {
    kind, title: TITLES[kind], answer, depth,
    sources: kind === 'grounded' ? sources : [],
    warning: kind === 'ai' ? AI_WARNING : null,
  }
}

/** Same derivation as assistant_conversation.response(): the mode, top-level
 *  sources and coverage follow from the sections, never set independently. */
export function answered(sections: Section[], overrides: Partial<AskResponse> = {}): AskResponse {
  const reviewed = sections.filter(item => item.kind === 'grounded')
  const ai = sections.some(item => item.kind === 'ai')
  return {
    status: 'answer', answerability: 'answerable', intent: 'botanical',
    coverage: reviewed.length && ai ? 'partially_supported' : reviewed.length ? 'fully_supported' : 'unsupported',
    answerMode: reviewed.length ? 'grounded' : ai ? 'general_knowledge' : 'grounded',
    sources: reviewed.flatMap(item => item.sources),
    sections,
    answer: sections.map(item => (item.warning ? `${item.warning}\n` : '') + item.answer).join('\n\n'),
    safetyBoundary: SAFETY_BOUNDARY, coveredTopics: [], mixedDepthNotice: null,
    ...overrides,
  }
}

export const grounded = (text = HABITAT_TEXT, depth: Depth = 'standard', sources = [HABITAT_SOURCE]) =>
  answered([section('grounded', text, depth, sources)])
export const aiOnly = (text = RHIZOME_TEXT, depth: Depth = 'standard') =>
  answered([section('ai', text, depth)])
export const mixed = (groundedDepth: Depth = 'standard', aiDepth: Depth = groundedDepth, overrides: Partial<AskResponse> = {}) =>
  answered([section('grounded', HABITAT_TEXT, groundedDepth, [HABITAT_SOURCE]), section('ai', RHIZOME_TEXT, aiDepth)], overrides)
export const conversation = (text: string, intent: AskResponse['intent']) =>
  answered([section('conversation', text)], { intent })

/** Router defaults for a limitation: nothing answerable, no sections, no sources. */
export function limitation(status: 'insufficient_evidence' | 'unsupported_scan', answer: string, overrides: Partial<AskResponse> = {}): AskResponse {
  return {
    status, answerability: 'insufficient_evidence', answer, sources: [],
    safetyBoundary: SAFETY_BOUNDARY, coveredTopics: [], answerMode: 'fallback',
    coverage: 'uncertain', intent: 'botanical', sections: [], mixedDepthNotice: null,
    ...overrides,
  }
}

export const UNSUPPORTED_SCAN_TEXT = 'The scan does not identify one of the supported plant categories with sufficient confidence, so species-specific assistant guidance is unavailable. Try a clearer scan or browse the catalogue.'
export const MAP_LIMITATION_TEXT = 'This public map record does not have a supported, consistent catalogue mapping. Select another supported public plant record. Private, withdrawn and uncertain records cannot provide assistant context.'
export const GUIDE_LIMITATION_TEXT = 'This guide does not have a supported catalogue reference. Browse a supported plant guide. This is not a plant identification.'
export const PRIVATE_DETAILS_TEXT = 'Please ask about plants without personal details or credentials.'
export const PROVIDER_FAILURE_TEXT = 'The AI explanation could not be completed. Please try again. This does not mean your question is unclear or unrelated to plants.'

/** answer_for_species() when no provider completes: an honest notice, plus
 *  the retrieved reviewed excerpts when the species has any. */
export function providerFailure(depth: Depth = 'standard', excerpts: Array<{ text: string; source: Source }> = [{ text: HABITAT_TEXT, source: HABITAT_SOURCE }]): AskResponse {
  const sections: Section[] = [{ kind: 'unavailable', title: 'AI explanation unavailable', answer: PROVIDER_FAILURE_TEXT, depth, sources: [], warning: null }]
  if (excerpts.length) sections.push({
    kind: 'grounded', title: 'Related source excerpts', depth, warning: null,
    answer: excerpts.map(item => item.text).join('\n\n'), sources: excerpts.map(item => item.source),
  })
  return limitation('insufficient_evidence', PROVIDER_FAILURE_TEXT, { sections, sources: excerpts.map(item => item.source) })
}

/** Stubs every assistant endpoint with `reply` and records what the panel
 *  sent, so a test can assert both halves of the contract. */
export async function recordAssistant(context: BrowserContext, reply: (asked: Asked, index: number) => AskResponse | { status: number }) {
  const calls: Asked[] = []
  await stubAssistant(context, async (route: Route) => {
    const asked = { path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() as AskBody }
    calls.push(asked)
    const result = reply(asked, calls.length - 1)
    if ('answer' in result) await route.fulfill({ json: result })
    else await route.fulfill({ status: result.status, json: { detail: 'stubbed failure' } })
  })
  return calls
}

/** The newest turn; earlier turns stay in the log above it. */
export const latestTurn = (page: Page) => page.locator('.plant-assistant__response')

/** Types a question and waits until its own turn is the newest one. */
export async function ask(page: Page, question: string) {
  await page.getByLabel('Your question', { exact: true }).fill(question)
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  await expect(latestTurn(page).locator('.plant-assistant__asked')).toHaveText(question.trim())
  await expect(page.getByRole('log', { name: 'Plant questions and answers' })).toHaveAttribute('aria-busy', 'false')
}

/** The scan panel is inline on the result page, so it is a region, not a dialog. */
export const scanPanel = (page: Page) => page.getByRole('region', { name: 'Plant assistant', exact: true })

/** Opens a catalogue guide and its assistant dialog. Needs a signed-in page. */
export async function openGuideAssistant(page: Page, speciesId = 'mikania-micrantha') {
  await page.goto(`/catalogue/${speciesId}`)
  await page.getByRole('button', { name: /^Ask Plant Assistant/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Guide Plant Assistant', exact: true })
  await expect(dialog.getByLabel('Your question', { exact: true })).toBeVisible()
  return dialog
}

/** Opens a public sighting from the map and its assistant dialog. Needs a signed-in page. */
export async function openMapAssistant(page: Page, sightingId = 's-01') {
  await page.goto(`/map?sighting=${sightingId}`)
  await page.getByRole('dialog', { name: 'Sighting details', exact: true })
    .getByRole('button', { name: 'Ask Plant Assistant', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Map Plant Assistant', exact: true })
  await expect(dialog.getByLabel('Your question', { exact: true })).toBeVisible()
  return dialog
}
