// Epic 3 - safe guidance, permission gates and protected-area context. One test
// per acceptance criterion, run against the mock service worker and the
// development model (playwright.config.ts).
//
// Guidance content is read from the bundled catalogue, so these tests compare
// what is on screen with shared/catalogue/plant-guidance.json for the scanned
// species. The location-context states come from POST /api/v1/location-context;
// the mock only ever answers "no intersection" or "uncertain", so the other
// answers are stubbed, and none of this proves the backend's polygon lookup.
import { test, expect, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  atLocation, KL_FIX, pinModelSpecies, scanPhoto, startPrivateAccess,
} from '../fixtures/app'

// Set AC_RUN_FIXME=1 to run the fixme tests and re-check each finding.
const KNOWN_GAP = !process.env.AC_RUN_FIXME

interface SourcedItem { text: string; source_ids: string[] }
interface ActionPath { title: string; steps: SourcedItem[]; stop_conditions: SourcedItem[]; disposal: SourcedItem[] }
interface PlantGuidance {
  plant_id: string
  scientific_name: string
  guidance_mode: 'general_information' | 'active_guidance' | 'site_manager_confirmation_required' | 'report_only'
  actions?: { protected_or_permission_unknown: ActionPath; authorised_site: ActionPath }
  spread_prevention: SourcedItem[]
  do_not_do: SourcedItem[]
  follow_up: SourcedItem[]
}
interface GuidanceCatalogue {
  content_version: string
  last_reviewed: string
  safety_policy: { never_recommend: string[] }
  sources: Array<{ source_id: string; title: string; publisher: string; url: string }>
  plants: PlantGuidance[]
}

const catalogue = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'shared/catalogue/plant-guidance.json'), 'utf8'),
) as GuidanceCatalogue
const plantRecord = (plantId: string) => catalogue.plants.find((plant) => plant.plant_id === plantId)!

const MODE_LABEL: Record<PlantGuidance['guidance_mode'], string> = {
  general_information: 'Identification only',
  active_guidance: 'Check before acting',
  site_manager_confirmation_required: 'Land manager approval needed',
  report_only: 'Report this plant. Do not remove it.',
}
const STATE_TITLES = [
  'Inside a mapped protected area',
  'No mapped protected-area intersection found',
  'Boundary unavailable or uncertain',
]
const UNSURE = 'This is protected land, or I am not sure'
const HAS_PERMISSION = 'I have permission from the land manager'
const ACTIVE_HEADING = 'If the land manager has approved it'
const PROTECTED_HEADING = 'Protected land or no permission'

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A rendered list item is the catalogue text followed by its source markers. */
const startsWith = (item: SourcedItem) => new RegExp(`^${escapeRegExp(item.text)}`)

interface ApiStub { method: string; path: string; status?: number; json: unknown }

/** Local helper (not in the shared fixture): answers one API call with a fixed
 *  response. The mock service worker answers API calls before page.route or
 *  context.route can see them, so the stub wraps window.fetch instead. It is
 *  installed by an init script, so it applies from the next navigation; a
 *  later stub for the same path wins over an earlier one. */
async function stubApi(page: Page, stub: ApiStub) {
  await page.addInitScript((s) => {
    const real = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(raw, window.location.origin)
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (url.pathname === s.path && method === s.method) {
        return new Response(JSON.stringify(s.json), {
          status: s.status ?? 200, headers: { 'content-type': 'application/json' },
        })
      }
      return real(input, init)
    }
  }, stub)
}

const locationContext = (overrides: Record<string, unknown>) => ({
  method: 'POST',
  path: '/api/v1/location-context',
  json: {
    contextState: 'no_protected_area_intersection',
    insideProtectedArea: false,
    boundarySource: 'Stubbed boundary source',
    boundaryVersion: 'stub-1',
    boundaryUpdatedAt: '2026-01-15T12:00:00Z',
    protectedAreaName: null,
    accuracyM: 15,
    actionEligible: true,
    permissionConfirmationRequired: true,
    disclaimer: 'Stubbed disclaimer.',
    ...overrides,
  },
})

/** Pins the development model after the first navigation, so one identity can
 *  scan several species. The fixture's pinModelSpecies is an init script and
 *  would overwrite this on the reload scanPhoto() does. */
async function scanSpecies(page: Page, plantId: string) {
  await page.evaluate((id) => localStorage.setItem('invatrace.development-model-species', id), plantId)
  await scanPhoto(page)
  const guidance = page.getByRole('region', { name: 'Guidance for Malaysia' })
  await expect(guidance).toBeVisible()
  return guidance
}

/** The species API can veto active steps (actionEligible=false), and both the
 *  mock and the backend seed do so for most species - in the mock, for every
 *  species but Mikania. To exercise the client's own gates on another species
 *  the veto is lifted by answering that one species call with
 *  actionEligible=true. Applies from the next scan. */
async function liftServerActionVeto(page: Page, plantId: string) {
  const speciesId = plantId.replaceAll('_', '-')
  const base = await page.evaluate(
    async (id) => (await fetch(`/api/v1/species/${id}`)).json() as Promise<Record<string, unknown>>,
    speciesId,
  )
  await stubApi(page, { method: 'GET', path: `/api/v1/species/${speciesId}`, json: { ...base, actionEligible: true } })
}

function guidancePanel(page: Page) {
  return page.getByRole('region', { name: 'Guidance for Malaysia' })
}

/** The "Location context" card inside the guidance panel. */
function locationCard(guidance: Locator) {
  return guidance.locator('section').filter({ has: guidance.page().getByRole('heading', { name: 'Location context' }) })
}

async function checkLocation(guidance: Locator) {
  await guidance.getByRole('button', { name: /Check current location|Check location again/ }).click()
  await expect(locationCard(guidance).getByRole('status')).toBeVisible()
}

/** Opens one of the collapsed reading sections and returns it. */
async function openSection(guidance: Locator, title: string) {
  const section = guidance.locator('details').filter({ has: guidance.page().locator('summary', { hasText: title }) })
  await section.locator('summary').click()
  return section
}

/** Every catalogue source ID a plant's guidance content cites. */
function citedSourceIds(plant: PlantGuidance) {
  const items = [...plant.spread_prevention, ...plant.do_not_do, ...plant.follow_up]
  for (const actionPath of Object.values(plant.actions ?? {})) {
    items.push(...actionPath.steps, ...actionPath.stop_conditions, ...actionPath.disposal)
  }
  return [...new Set(items.flatMap((item) => item.source_ids))]
}

test('AC 3.1.1 Exact guidance-record lookup', async ({ page }) => {
  // Proves: the guidance shown is the scanned species' own bundled record
  // (mode, general information, permitted actions, stop conditions, spread
  // prevention, sources), fetched without a guidance API call, and a species
  // with no record falls back to observe-and-report with no removal steps.
  // Not proven: availability from the offline cache (a production PWA build).
  const guidanceCalls: string[] = []
  page.on('request', (request) => {
    if (/\/api\/v1\/species\/[^/]+\/guidance/.test(new URL(request.url()).pathname)) guidanceCalls.push(request.url())
  })
  await startPrivateAccess(page)

  const mikania = plantRecord('mikania_micrantha')
  const mimosa = plantRecord('mimosa_pigra')
  for (const plant of [mikania, mimosa]) {
    const other = plant === mikania ? mimosa : mikania
    const guidance = await scanSpecies(page, plant.plant_id)
    const defaultPath = plant.actions!.protected_or_permission_unknown

    // Guidance mode.
    await expect(guidance.getByText(MODE_LABEL[plant.guidance_mode], { exact: true })).toBeVisible()
    // General information.
    const about = await openSection(guidance, 'About this plant')
    expect((await about.locator('p').innerText()).length).toBeGreaterThan(40)
    // Permitted actions: this species' own steps, in order, and no others.
    await expect(guidance.getByText(defaultPath.title, { exact: true })).toBeVisible()
    await expect(guidance.locator('ol > li')).toHaveText(defaultPath.steps.map(startsWith))
    for (const step of other.actions!.protected_or_permission_unknown.steps) {
      if (!defaultPath.steps.some((own) => own.text === step.text)) {
        await expect(guidance.getByText(step.text)).toHaveCount(0)
      }
    }
    // Stop conditions.
    for (const condition of defaultPath.stop_conditions) await expect(guidance.getByText(condition.text)).toBeVisible()
    // Spread-prevention steps.
    const spread = await openSection(guidance, 'Prevent accidental spread')
    await expect(spread.locator('li')).toHaveText(plant.spread_prevention.map(startsWith))
    // Sources.
    const sources = await openSection(guidance, 'Safety notes and sources')
    await expect(sources.getByText(`Plant ${plant.plant_id}`)).toBeVisible()
    for (const sourceId of citedSourceIds(plant)) {
      await expect(sources.locator('li', { hasText: `[${sourceId}]` })).toHaveCount(1)
    }
  }

  // A species with no guidance record: observe and report only, nothing built.
  expect(catalogue.plants.some((plant) => plant.plant_id === 'acacia_mangium')).toBe(false)
  const fallback = await scanSpecies(page, 'acacia_mangium')
  await expect(fallback.getByText('Observe and report only')).toBeVisible()
  await expect(fallback.locator('ol')).toHaveCount(0)
  await expect(fallback.getByRole('group', { name: 'Permission and safety gate' })).toHaveCount(0)
  await expect(fallback.getByText(ACTIVE_HEADING)).toHaveCount(0)
  await expect(fallback.getByRole('radio')).toHaveCount(0)

  // The lookup is local: no guidance endpoint was called for any of the three.
  expect(guidanceCalls).toEqual([])
})

test('AC 3.1.2 Protected or permission-unknown default', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  const plant = plantRecord('mikania_micrantha')
  const guidance = guidancePanel(page)

  // Nothing has been confirmed, and the cautious option is already selected.
  const unsure = guidance.getByRole('radio', { name: UNSURE })
  await expect(unsure).toBeChecked()
  await expect(guidance.getByRole('radio', { checked: true })).toHaveCount(1)

  // Only the observe / photograph / record location / report instructions.
  const shownOnlyObserveAndReport = async () => {
    await expect(guidance.getByRole('heading', { name: PROTECTED_HEADING })).toBeVisible()
    await expect(guidance.locator('ol > li')).toHaveText(plant.actions!.protected_or_permission_unknown.steps.map(startsWith))
    await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toHaveCount(0)
    for (const step of plant.actions!.authorised_site.steps) await expect(guidance.getByText(step.text)).toHaveCount(0)
  }
  await shownOnlyObserveAndReport()
  const steps = guidance.locator('ol')
  await expect(steps).toContainText(/Stay on the existing path/)
  await expect(steps).toContainText(/Take clear photos/)
  await expect(steps).toContainText(/record GPS coordinates and time/)
  await expect(steps).toContainText(/Submit the sighting/)

  // A map boundary result grants nothing: with "no mapped intersection" back
  // from the location check the default is unchanged and no step is unlocked.
  await checkLocation(guidance)
  await expect(locationCard(guidance).getByText('No mapped protected-area intersection found')).toBeVisible()
  await expect(unsure).toBeChecked()
  await expect(guidance.getByRole('radio', { name: HAS_PERMISSION })).not.toBeChecked()
  await shownOnlyObserveAndReport()
  await expect(guidance.getByText('A map boundary does not prove that you have permission.')).toBeVisible()
})

test('AC 3.1.3 Authorised-action gate', async ({ page, context, baseURL }) => {
  // The permission choice is a client-side gate for the view in front of the
  // user: it must not write to the species record or the public map.
  await atLocation(context, baseURL)
  await startPrivateAccess(page)
  const writes: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (!pathname.startsWith('/api/v1/') || request.method() === 'GET') return
    // A scan and its location check are expected; anything else is a write
    // caused by the guidance view.
    if (pathname === '/api/v1/scans' || pathname === '/api/v1/location-context') return
    if (pathname === '/api/v1/profiles/bootstrap') return
    writes.push(`${request.method()} ${pathname}`)
  })

  // active_guidance: explicit permission (and a clear safety check) is enough.
  const active = plantRecord('mikania_micrantha')
  expect(active.guidance_mode).toBe('active_guidance')
  let guidance = await scanSpecies(page, active.plant_id)
  await checkLocation(guidance)
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toHaveCount(0)
  await guidance.getByRole('radio', { name: HAS_PERMISSION }).check()
  await expect(guidance.getByText(/land manager has approved removal of/)).toHaveCount(0)
  await guidance.getByRole('checkbox', { name: 'None of these apply here.' }).check()
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toBeVisible()
  await expect(guidance.locator('ol > li')).toHaveText(active.actions!.authorised_site.steps.map(startsWith))
  // Withdrawing the permission hides the active steps again.
  await guidance.getByRole('radio', { name: UNSURE }).check()
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toHaveCount(0)
  await expect(guidance.locator('ol > li')).toHaveText(active.actions!.protected_or_permission_unknown.steps.map(startsWith))

  // site_manager_confirmation_required: a second confirmation is needed. The
  // new scan also starts from the cautious default - the earlier choice
  // belonged to the earlier view.
  const managed = plantRecord('chromolaena_odorata')
  expect(managed.guidance_mode).toBe('site_manager_confirmation_required')
  await liftServerActionVeto(page, managed.plant_id)
  guidance = await scanSpecies(page, managed.plant_id)
  await expect(guidance.getByRole('radio', { name: UNSURE })).toBeChecked()
  await checkLocation(guidance)
  await guidance.getByRole('radio', { name: HAS_PERMISSION }).check()
  await guidance.getByRole('checkbox', { name: 'None of these apply here.' }).check()
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toHaveCount(0)
  for (const step of managed.actions!.authorised_site.steps) await expect(guidance.getByText(step.text)).toHaveCount(0)
  await expect(guidance.getByText(/and the land manager has approved this plant for removal/)).toBeVisible()
  const secondConfirmation = guidance.getByRole('checkbox', {
    name: `The land manager has approved removal of ${managed.scientific_name} at this exact site.`,
  })
  await expect(secondConfirmation).not.toBeChecked()
  await secondConfirmation.check()
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toBeVisible()
  await expect(guidance.locator('ol > li')).toHaveText(managed.actions!.authorised_site.steps.map(startsWith))

  // report_only: active steps are never exposed, whatever the location says.
  const reportOnly = plantRecord('mimosa_pigra')
  expect(reportOnly.guidance_mode).toBe('report_only')
  guidance = await scanSpecies(page, reportOnly.plant_id)
  await checkLocation(guidance)
  await expect(locationCard(guidance).getByText('No mapped protected-area intersection found')).toBeVisible()
  const refused = guidance.getByRole('radio', { name: 'Removal is not allowed for this species' })
  await expect(refused).toBeDisabled()
  await expect(guidance.getByRole('radio', { name: HAS_PERMISSION })).toHaveCount(0)
  await expect(guidance.getByRole('radio', { name: UNSURE })).toBeChecked()
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toHaveCount(0)
  await expect(guidance.getByText(reportOnly.actions!.authorised_site.title, { exact: true })).toHaveCount(0)
  await expect(guidance.locator('ol > li')).toHaveText(reportOnly.actions!.protected_or_permission_unknown.steps.map(startsWith))

  expect(writes).toEqual([])
})

test('AC 3.1.4 Guidance schema and version display', async ({ page }) => {
  // Proves the display half: plant name, mode, reviewed actions, stop
  // conditions, spread prevention, source links, catalogue version and
  // last-reviewed date, all taken from the bundled catalogue.
  // Not an e2e concern: the JSON-schema check and the invalid-record fallback
  // are build-time tests (src/data/plant-guidance.schema.test.ts,
  // src/features/scan/plant-guidance-fallback.test.ts).
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  const plant = plantRecord('mikania_micrantha')
  const guidance = guidancePanel(page)

  // Plant name.
  await expect(page.locator('.scan-result p', { hasText: new RegExp(`^${plant.scientific_name}$`) })).toBeVisible()
  // Guidance mode.
  await expect(guidance.getByText(MODE_LABEL[plant.guidance_mode], { exact: true })).toBeVisible()
  // Reviewed actions and stop conditions, each with a source link.
  const defaultPath = plant.actions!.protected_or_permission_unknown
  await expect(guidance.locator('ol > li')).toHaveText(defaultPath.steps.map(startsWith))
  for (const [index, step] of defaultPath.steps.entries()) {
    for (const sourceId of step.source_ids) {
      const source = catalogue.sources.find((entry) => entry.source_id === sourceId)!
      await expect(guidance.locator('ol > li').nth(index).getByRole('link', { name: `[${sourceId}]` }))
        .toHaveAttribute('href', source.url)
    }
  }
  await expect(guidance.getByText(defaultPath.stop_conditions[0].text)).toBeVisible()
  // Spread-prevention steps.
  const spread = await openSection(guidance, 'Prevent accidental spread')
  await expect(spread.locator('li')).toHaveText(plant.spread_prevention.map(startsWith))
  // Catalogue version and last-reviewed date.
  const notes = await openSection(guidance, 'Safety notes and sources')
  await expect(notes.getByText(`Guidance last reviewed ${catalogue.last_reviewed}`)).toBeVisible()
  await expect(notes).toContainText(`Content version ${catalogue.content_version}`)
  expect(catalogue.content_version).toMatch(/^\d+\.\d+\.\d+$/)
  expect(catalogue.last_reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('AC 3.2.1 Plant-specific spread-prevention display', async ({ page }) => {
  await startPrivateAccess(page)

  // A species with reviewed entries: its own, in catalogue order, with their
  // source IDs, and none borrowed from another species.
  const plant = plantRecord('mikania_micrantha')
  let guidance = await scanSpecies(page, plant.plant_id)
  let spread = await openSection(guidance, 'Prevent accidental spread')
  const entries = spread.locator('li')
  await expect(entries).toHaveText(plant.spread_prevention.map(startsWith))
  for (const [index, entry] of plant.spread_prevention.entries()) {
    for (const sourceId of entry.source_ids) {
      await expect(entries.nth(index).getByRole('link', { name: `[${sourceId}]` })).toBeVisible()
    }
    await expect(entries.nth(index).getByRole('link')).toHaveCount(entry.source_ids.length)
  }
  const ownTexts = new Set(plant.spread_prevention.map((entry) => entry.text))
  const foreignTexts = catalogue.plants
    .filter((other) => other.plant_id !== plant.plant_id)
    .flatMap((other) => other.spread_prevention.map((entry) => entry.text))
    .filter((text) => !ownTexts.has(text))
  expect(foreignTexts.length).toBeGreaterThan(10)
  const shown = await spread.innerText()
  for (const text of foreignTexts) expect(shown).not.toContain(text)

  // A second species shows its own list, not the first one's.
  const second = plantRecord('eichhornia_crassipes')
  guidance = await scanSpecies(page, second.plant_id)
  spread = await openSection(guidance, 'Prevent accidental spread')
  await expect(spread.locator('li')).toHaveText(second.spread_prevention.map(startsWith))

  // A guidance record with no reviewed spread entry: the fixed safe line.
  const none = plantRecord('oxalis_corniculata')
  expect(none.spread_prevention).toEqual([])
  guidance = await scanSpecies(page, none.plant_id)
  spread = await openSection(guidance, 'Prevent accidental spread')
  await expect(spread.getByText('Do not disturb; report the sighting instead.')).toBeVisible()
  await expect(spread.locator('li')).toHaveCount(0)
})

test('AC 3.2.2 Stop-condition acknowledgement', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  const plant = plantRecord('mikania_micrantha')
  const stopCondition = plant.actions!.authorised_site.stop_conditions[0].text
  const guidance = guidancePanel(page)

  // The safety gate is not permission: without the permission choice there is
  // no stop-condition confirmation to tick at all.
  await checkLocation(guidance)
  await expect(guidance.getByRole('group', { name: 'Stop conditions' })).toHaveCount(0)

  // Active steps are otherwise available: the species' stop conditions come
  // first, and the steps stay hidden until the user confirms none applies.
  await guidance.getByRole('radio', { name: HAS_PERMISSION }).check()
  const gate = guidance.getByRole('group', { name: 'Stop conditions' })
  await expect(gate).toBeVisible()
  await expect(gate.getByText(stopCondition)).toBeVisible()
  const noneApply = gate.getByRole('checkbox', { name: 'None of these apply here.' })
  await expect(noneApply).not.toBeChecked()
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toHaveCount(0)
  await expect(guidance.getByText(/Removal steps will appear after you confirm every safety check/)).toBeVisible()

  await noneApply.check()
  const activeHeading = guidance.getByRole('heading', { name: ACTIVE_HEADING })
  await expect(activeHeading).toBeVisible()
  await expect(guidance.locator('ol > li')).toHaveText(plant.actions!.authorised_site.steps.map(startsWith))
  // The stop conditions sit above the steps on the page.
  const gateTop = (await gate.boundingBox())!.y
  const stepsTop = (await activeHeading.boundingBox())!.y
  expect(gateTop).toBeLessThan(stepsTop)

  // Selecting a stop condition: the active steps go, and the user is told to
  // leave the plant and report it. The "none apply" confirmation is locked.
  await gate.getByRole('checkbox', { name: `This condition applies: ${stopCondition}` }).check()
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toHaveCount(0)
  for (const step of plant.actions!.authorised_site.steps) await expect(guidance.getByText(step.text)).toHaveCount(0)
  await expect(gate.getByRole('alert'))
    .toHaveText('A stop condition applies. Do not disturb the plant. Report the sighting for review.')
  await expect(noneApply).toBeDisabled()
  await expect(noneApply).not.toBeChecked()
  await expect(page.getByRole('button', { name: /Report sighting/ })).toBeVisible()
})

test('AC 3.2.3 Universal high-risk-action exclusion', async ({ page, context, baseURL }) => {
  // Proves the rendered half: for every species that can show active steps,
  // no step on screen - cautious path or active path - recommends burning,
  // herbicide, power tools, climbing, entering water, handling mature trees
  // or entering dense thickets. "Do not ..." warnings are allowed.
  // Not an e2e concern: the build-time content test that fails the release
  // (src/data/plant-guidance.test.ts).
  test.setTimeout(120_000)
  await atLocation(context, baseURL)
  await startPrivateAccess(page)

  const prohibited = /\b(burn\w*|fire|herbicide\w*|pesticide\w*|chemical\w*|spray\w*|chainsaw\w*|power(ed)?[ -](tool|cutter)s?|brush ?cutter\w*|machinery|climb\w*|wad(e|ing)|enter\w* [\w ]*water|mature trees?|dense (thorny )?thickets?)\b/i
  const warning = /\b(do not|never|avoid|without|stop if)\b/i
  const recommendations = (stepText: string) => stepText
    .split(/(?<=[.;])\s+/)
    .filter((sentence) => prohibited.test(sentence) && !warning.test(sentence))
  // The check itself must be able to fail.
  expect(recommendations('Spray the regrowth with herbicide.')).toHaveLength(1)
  expect(recommendations('Do not enter the water to reach the plant.')).toHaveLength(0)

  const actionable = catalogue.plants.filter((plant) =>
    plant.guidance_mode === 'active_guidance' || plant.guidance_mode === 'site_manager_confirmation_required')
  expect(actionable.length).toBeGreaterThanOrEqual(10)
  for (const plant of actionable) {
    // Without this most species never render their active steps at all (the
    // species API vetoes them), and the content would go unchecked.
    await liftServerActionVeto(page, plant.plant_id)
    const guidance = await scanSpecies(page, plant.plant_id)
    const steps = guidance.locator('ol > li')

    // Cautious path, shown by default.
    await expect(steps).toHaveText(plant.actions!.protected_or_permission_unknown.steps.map(startsWith))
    for (const text of await steps.allInnerTexts()) expect(recommendations(text), `${plant.plant_id}: ${text}`).toEqual([])

    // Active path, once every gate is passed.
    await checkLocation(guidance)
    await guidance.getByRole('radio', { name: HAS_PERMISSION }).check()
    if (plant.guidance_mode === 'site_manager_confirmation_required') {
      await guidance.getByRole('checkbox', { name: /The land manager has approved removal of/ }).check()
    }
    await guidance.getByRole('checkbox', { name: 'None of these apply here.' }).check()
    await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toBeVisible()
    await expect(steps).toHaveText(plant.actions!.authorised_site.steps.map(startsWith))
    for (const text of await steps.allInnerTexts()) expect(recommendations(text), `${plant.plant_id}: ${text}`).toEqual([])
  }

  // The panel states the exclusions it works to.
  const notes = await openSection(guidancePanel(page), 'Safety notes and sources')
  await expect(notes.getByText('InvaTrace does not provide instructions for')).toBeVisible()
  for (const excluded of catalogue.safety_policy.never_recommend) await expect(notes.getByText(excluded, { exact: true })).toBeVisible()
})

test('AC 3.2.4 Visible provenance', async ({ page }) => {
  // Proves: opening Sources lists, for the current plant, each source's
  // title, publisher/authority and link, with the dataset review date.
  // Not an e2e concern: the content validation that rejects a record with
  // missing source IDs runs at build time.
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  const plant = plantRecord('mikania_micrantha')
  const guidance = guidancePanel(page)

  // Closed until the user opens it.
  await expect(guidance.getByText('Sources used for this plant')).toBeHidden()
  const notes = await openSection(guidance, 'Safety notes and sources')
  await expect(notes.getByText('Sources used for this plant')).toBeVisible()
  // Dataset review date.
  await expect(notes.getByText(`Guidance last reviewed ${catalogue.last_reviewed}`)).toBeVisible()

  // Every source the plant's guidance cites: title, publisher and link.
  const cited = citedSourceIds(plant)
  expect(cited.length).toBeGreaterThan(0)
  const sourceList = notes.locator('ul').last()
  for (const sourceId of cited) {
    const source = catalogue.sources.find((entry) => entry.source_id === sourceId)!
    const row = sourceList.locator('li', { hasText: `[${sourceId}]` })
    await expect(row).toHaveCount(1)
    await expect(row.getByRole('link', { name: source.title, exact: true })).toHaveAttribute('href', source.url)
    await expect(row).toContainText(`- ${source.publisher}`)
  }
  // And every row shown, cited above or not, is complete.
  const rows = sourceList.locator('li')
  for (let index = 0; index < await rows.count(); index += 1) {
    const link = rows.nth(index).getByRole('link')
    await expect(link).toHaveAttribute('href', /^https?:\/\//)
    expect((await link.innerText()).trim().length).toBeGreaterThan(3)
    expect(await rows.nth(index).innerText()).toMatch(/^\[[\w-]+\] .+ - \S.+$/)
  }
})

test('AC 3.3.1 Three state location result', async ({ page, context, baseURL }) => {
  // Proves: with location allowed, the check posts latitude, longitude and
  // accuracy, the response carries the state, source and version, and exactly
  // one of the three states is displayed.
  // Naming: the app's API uses camelCase (accuracyM, contextState,
  // boundarySource, boundaryVersion) where the criterion writes snake_case.
  // Not proven: the backend endpoint itself.
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  const guidance = guidancePanel(page)
  const card = locationCard(guidance)
  for (const title of STATE_TITLES) await expect(card.getByText(title)).toHaveCount(0)

  const isContextCall = (url: string) => new URL(url).pathname === '/api/v1/location-context'
  const sent = page.waitForRequest((request) => isContextCall(request.url()) && request.method() === 'POST')
  const answered = page.waitForResponse((response) => isContextCall(response.url()))
  await guidance.getByRole('button', { name: 'Check current location' }).click()
  const body = (await sent).postDataJSON() as Record<string, number>
  expect(body.latitude).toBeCloseTo(KL_FIX.latitude, 4)
  expect(body.longitude).toBeCloseTo(KL_FIX.longitude, 4)
  expect(body.accuracyM ?? body.accuracy_m).toBe(KL_FIX.accuracy)

  const response = await answered
  expect(response.status()).toBe(200)
  const result = await response.json() as Record<string, unknown>
  expect(['inside_protected_area', 'no_protected_area_intersection', 'boundary_uncertain'])
    .toContain(result.contextState ?? result.context_state)
  expect(typeof (result.boundarySource ?? result.boundary_source)).toBe('string')
  expect(typeof (result.boundaryVersion ?? result.boundary_version)).toBe('string')

  // Exactly one state on screen.
  const status = card.getByRole('status')
  await expect(status).toBeVisible()
  const shown = []
  for (const title of STATE_TITLES) if (await status.getByText(title, { exact: true }).count() > 0) shown.push(title)
  expect(shown).toEqual(['No mapped protected-area intersection found'])
  await expect(status.locator('strong')).toHaveCount(1)
})

test('AC 3.3.2 Protected area intersection', async ({ page, context, baseURL }) => {
  // Proves the client half: given inside_protected_area and
  // action_eligible=false from the API, the app names the area and keeps the
  // user on observe-and-report with no way to reach active steps.
  // Not proven: that the backend returns this for coordinates inside a real
  // protected-area polygon (the response is stubbed).
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  await stubApi(page, locationContext({
    contextState: 'inside_protected_area',
    insideProtectedArea: true,
    protectedAreaName: 'Taman Negara Test Reserve',
    actionEligible: false,
    disclaimer: 'This location is inside a mapped protected area. Observe and report only.',
  }))
  await startPrivateAccess(page)
  await scanPhoto(page)
  const plant = plantRecord('mikania_micrantha')
  const guidance = guidancePanel(page)
  await checkLocation(guidance)

  const status = locationCard(guidance).getByRole('status')
  await expect(status.getByText('Inside a mapped protected area', { exact: true })).toBeVisible()
  await expect(status.getByText('Taman Negara Test Reserve')).toBeVisible()
  await expect(status.getByText('No mapped protected-area intersection found')).toHaveCount(0)

  // Observe and report only: the permission option cannot be chosen, and no
  // active removal step is shown.
  await expect(guidance.getByRole('radio', { name: UNSURE })).toBeChecked()
  await expect(guidance.getByRole('radio', { name: HAS_PERMISSION })).toHaveCount(0)
  const locked = guidance.getByRole('radio').nth(1)
  await expect(locked).toBeDisabled()
  await expect(locked).not.toBeChecked()
  await expect(guidance.getByRole('heading', { name: PROTECTED_HEADING })).toBeVisible()
  await expect(guidance.locator('ol > li')).toHaveText(plant.actions!.protected_or_permission_unknown.steps.map(startsWith))
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toHaveCount(0)
  for (const step of plant.actions!.authorised_site.steps) await expect(guidance.getByText(step.text)).toHaveCount(0)
})

test('AC 3.3.3 No mapped intersection', async ({ page, context, baseURL }) => {
  // Proves the client half against the mock's "no intersection" answer.
  // Not proven: the backend's polygon lookup.
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  const plant = plantRecord('mikania_micrantha')
  const guidance = guidancePanel(page)
  await checkLocation(guidance)

  const card = locationCard(guidance)
  await expect(card.getByRole('status').getByText('No mapped protected-area intersection found', { exact: true })).toBeVisible()
  // ...and that this does not establish ownership or permission.
  await expect(card).toContainText(/does not establish ownership, access rights, or removal permission/)

  // The explicit-permission confirmation is still required before any
  // beginner-safe active step appears.
  const permission = guidance.getByRole('radio', { name: HAS_PERMISSION })
  await expect(permission).toBeEnabled()
  await expect(permission).not.toBeChecked()
  await expect(guidance.getByRole('radio', { name: UNSURE })).toBeChecked()
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toHaveCount(0)
  for (const step of plant.actions!.authorised_site.steps) await expect(guidance.getByText(step.text)).toHaveCount(0)

  await permission.check()
  await guidance.getByRole('checkbox', { name: 'None of these apply here.' }).check()
  await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toBeVisible()
})

test('AC 3.3.4 Uncertain or unavailable boundary', async ({ page, context, baseURL }) => {
  // Proves the client half for each cause: poor GPS accuracy, an API answer
  // of boundary_uncertain with action_eligible=false, and a failed boundary
  // service all show "Boundary unavailable or uncertain", observe-and-report
  // only, and never the "no intersection" state.
  // Not proven: the backend's own handling of a failed boundary dataset or of
  // coordinates outside coverage. The 250 m rule is the fixme test below.
  await atLocation(context, baseURL, { ...KL_FIX, accuracy: 400 })
  await startPrivateAccess(page)
  const plant = plantRecord('mikania_micrantha')

  const observeAndReportOnly = async (guidance: Locator) => {
    const card = locationCard(guidance)
    await expect(card.getByRole('status').getByText('Boundary unavailable or uncertain', { exact: true })).toBeVisible()
    await expect(card.getByText('No mapped protected-area intersection found')).toHaveCount(0)
    await expect(card.getByText('Inside a mapped protected area')).toHaveCount(0)
    await expect(card).toContainText(/Observe and report only/)
    await expect(guidance.getByRole('radio', { name: UNSURE })).toBeChecked()
    await expect(guidance.getByRole('radio', { name: HAS_PERMISSION })).toHaveCount(0)
    await expect(guidance.getByRole('radio').nth(1)).toBeDisabled()
    await expect(guidance.getByRole('heading', { name: PROTECTED_HEADING })).toBeVisible()
    await expect(guidance.getByRole('heading', { name: ACTIVE_HEADING })).toHaveCount(0)
    for (const step of plant.actions!.authorised_site.steps) await expect(guidance.getByText(step.text)).toHaveCount(0)
  }

  // GPS accuracy far worse than the limit (400 m).
  let guidance = await scanSpecies(page, plant.plant_id)
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/location-context')
  await checkLocation(guidance)
  expect(await (await answered).json()).toMatchObject({ contextState: 'boundary_uncertain', actionEligible: false })
  await observeAndReportOnly(guidance)
  await expect(locationCard(guidance)).toContainText('GPS accuracy: ±400 m')

  // The API reports the coordinates as outside what the dataset can decide.
  await context.setGeolocation(KL_FIX)
  await stubApi(page, locationContext({
    contextState: 'boundary_uncertain',
    insideProtectedArea: null,
    boundarySource: null,
    boundaryVersion: null,
    boundaryUpdatedAt: null,
    actionEligible: false,
    disclaimer: 'Protected-area status is unavailable or uncertain. Observe and report only; do not touch, collect, cut or remove the plant.',
  }))
  guidance = await scanSpecies(page, plant.plant_id)
  await checkLocation(guidance)
  await observeAndReportOnly(guidance)

  // The boundary service fails outright: never treated as "outside".
  await stubApi(page, { method: 'POST', path: '/api/v1/location-context', status: 503, json: { detail: 'Boundary service unavailable' } })
  guidance = await scanSpecies(page, plant.plant_id)
  await checkLocation(guidance)
  await observeAndReportOnly(guidance)
  await expect(locationCard(guidance)).toContainText('Boundary data could not be checked. Observe and report only.')
})

test('AC 3.3.4 Uncertain or unavailable boundary - GPS accuracy worse than 250 metres is uncertain', async ({ page, context, baseURL }) => {
  test.fixme(KNOWN_GAP, 'Accuracy limit is 350 m (mock MSW_LOCATION_ACCURACY_MAX_M; backend screening_location_accuracy_max_m): a 300 m fix returns "no intersection".')
  await atLocation(context, baseURL, { ...KL_FIX, accuracy: 300 })
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  const guidance = guidancePanel(page)
  await checkLocation(guidance)
  const card = locationCard(guidance)
  await expect(card.getByRole('status').getByText('Boundary unavailable or uncertain', { exact: true })).toBeVisible()
  await expect(card.getByText('No mapped protected-area intersection found')).toHaveCount(0)
  await expect(guidance.getByRole('radio', { name: HAS_PERMISSION })).toHaveCount(0)
})

test('AC 3.3.5 Visible source information', async ({ page, context, baseURL }) => {
  // The values must come from the API response, so the response is stubbed
  // with values that exist nowhere in the app and each is looked for on
  // screen; a second, different response then replaces all of them.
  // The details are shown under the state as soon as it is displayed - there
  // is no separate control to open them.
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  await stubApi(page, locationContext({
    boundarySource: 'AC-335 boundary source alpha',
    boundaryVersion: 'ac335-version-alpha',
    boundaryUpdatedAt: '2024-02-03T12:00:00Z',
    accuracyM: 37,
    disclaimer: 'AC-335 alpha disclaimer: mapped status is not removal permission.',
  }))
  await startPrivateAccess(page)
  await scanPhoto(page)
  let guidance = guidancePanel(page)
  await checkLocation(guidance)
  let card = locationCard(guidance)
  await expect(card.getByRole('status').getByText('No mapped protected-area intersection found', { exact: true })).toBeVisible()
  await expect(card).toContainText('Boundary source: AC-335 boundary source alpha')
  await expect(card).toContainText('Dataset version: ac335-version-alpha')
  await expect(card).toContainText('Update date: 3 Feb 2024')
  await expect(card).toContainText('GPS accuracy: ±37 m')
  await expect(card).toContainText('AC-335 alpha disclaimer: mapped status is not removal permission.')

  // A different response, for a different state, replaces every value.
  await stubApi(page, locationContext({
    contextState: 'inside_protected_area',
    insideProtectedArea: true,
    actionEligible: false,
    boundarySource: 'AC-335 boundary source beta',
    boundaryVersion: 'ac335-version-beta',
    boundaryUpdatedAt: '2025-11-20T12:00:00Z',
    accuracyM: 82,
    disclaimer: 'AC-335 beta disclaimer: mapped status is not removal permission.',
  }))
  await scanPhoto(page)
  guidance = guidancePanel(page)
  await checkLocation(guidance)
  card = locationCard(guidance)
  await expect(card.getByRole('status').getByText('Inside a mapped protected area', { exact: true })).toBeVisible()
  await expect(card).toContainText('Boundary source: AC-335 boundary source beta')
  await expect(card).toContainText('Dataset version: ac335-version-beta')
  await expect(card).toContainText('Update date: 20 Nov 2025')
  await expect(card).toContainText('GPS accuracy: ±82 m')
  await expect(card).toContainText('AC-335 beta disclaimer: mapped status is not removal permission.')
  await expect(card).not.toContainText('alpha')
})
