// Epic 7 acceptance criteria that e2e/guided-missions.spec.ts walks past
// without asserting in full: the legend (7.2.2), scanning and reporting from
// a mission (7.4.2, 7.4.3), the no-find outcome (7.5.2), the progress totals
// (7.5.3) and the summary wording (7.6.3). Dev MSW mocks plus the shipped
// static habitat overlay for Taman Tasik Titiwangsa.
//
// Its watchlist is Mile-a-minute weed, Siam weed and Water hyacinth. The mock
// keeps scans and reports in page memory, so once a mission scan exists the
// tests move in-app only.
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { atLocation, pinModelSpecies, referenceImage, startPrivateAccess } from '../fixtures/app'

const PLACE = 'e56ae54c-ca04-5fbf-b2c2-01b6e7fbdf46'
const MISSION_URL = new RegExp(`/places/${PLACE}/mission$`)
const MIKANIA = 'mikania_micrantha'

type Mission = {
  missionId: string
  plants: Array<{ speciesId: string; state: string; noTargetFound: boolean }>
  reports: Array<{ reportId: string; speciesId: string }>
  scansCount: number
}

async function startMission(page: Page) {
  await startPrivateAccess(page)
  await page.goto(`/places/${PLACE}/mission`)
  const started = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v1/guided-missions' && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'Start guided mission' }).click()
  const mission = await (await started).json() as Mission
  await expect(page.getByRole('heading', { name: 'Your visit' })).toBeVisible()
  return mission
}

/** One total from the "Your visit" card or the finished summary. */
const total = (page: Page, label: string) => page.locator('.mission-counts div')
  .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')

const plantCard = (page: Page, name: string) => page.locator('.mission-plant').filter({ has: page.locator('.mission-plant__head strong', { hasText: name }) })

/** Sets one plant's progress and waits for the API to store it. */
async function setProgress(page: Page, plant: string, state: 'Looked for' | 'Unable to check' | 'Not checked') {
  const saved = page.waitForResponse((response) => (
    /\/api\/v1\/guided-missions\/[^/]+\/plants\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT'
  ))
  await page.getByRole('radiogroup', { name: `Progress for ${plant}` }).getByRole('radio', { name: state }).click()
  const response = await saved
  expect(response.status()).toBe(200)
  return response
}

/** The mission's own Scan a plant action. The app sidebar has a button of the
 *  same name, so this is scoped to the mission page. */
const missionScanButton = (page: Page) => page.locator('.mission-page').getByRole('button', { name: 'Scan a plant' }).first()

/** Gallery photo -> analyse -> result page, returning what POST /api/v1/scans was sent. */
async function analyseGalleryPhoto(page: Page) {
  await expect(page).toHaveURL(/\/scan$/)
  const scanSaved = page.waitForRequest((request) => (
    new URL(request.url()).pathname === '/api/v1/scans' && request.method() === 'POST'
  ))
  await page.locator('input[aria-label="Choose photo from gallery"]').setInputFiles(referenceImage('mikania-micrantha.jpg'))
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /Analyse plant/ }).click()
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 5000 })
  return (await scanSaved).postDataJSON() as { captureId: string; missionId?: string; predictedSpeciesId: string }
}

/** From the active mission: Scan a plant -> gallery photo -> result page. */
async function scanFromMission(page: Page) {
  await missionScanButton(page).click()
  return analyseGalleryPhoto(page)
}

/** From the scan result: the whole report wizard, through to "Report published". */
async function reportFromResult(page: Page) {
  await page.getByRole('button', { name: /Report sighting/ }).click()
  await expect(page).toHaveURL(/\/report$/)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Single plant', { exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('checkbox', { name: /accurate/i }).check()
  await page.getByRole('checkbox', { name: /personal information/i }).check()
  await page.getByRole('button', { name: 'Review submission' }).click()
  await expect(page.getByText('This report will appear in your guided mission progress.', { exact: false })).toBeVisible()
  const created = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v1/reports' && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'Submit report' }).click()
  const response = await created
  return {
    status: response.status(),
    sent: response.request().postDataJSON() as { missionId?: string; captureId: string; speciesId: string },
    report: await response.json() as { id: string },
  }
}

test('AC 7.2.2 Readable zone categories: each visible habitat has one colour and label, and the legend lists only what the map shows', async ({ page }) => {
  await startMission(page)
  const legend = page.getByLabel('Map legend')
  const legendEntries = () => legend.locator('li').evaluateAll((items) => items.map((item) => ({
    label: item.textContent!.trim(),
    colour: (item.querySelector('span') as HTMLElement).style.backgroundColor,
  })))
  const listEntries = () => page.getByLabel('Habitats on the map').locator('li').evaluateAll((items) => items.map((item) => ({
    label: item.querySelector('strong')!.textContent!.trim(),
    colour: (item.querySelector('.mission-swatch') as HTMLElement).style.backgroundColor,
  })))
  const mapLabel = page.locator('.mission-map-shell [aria-label^="Compatible habitat map"]')

  // More than one compatible category, each with its own label and colour.
  await expect(legend.getByText('Compatible habitat', { exact: true })).toBeVisible()
  const all = await legendEntries()
  expect(all.length).toBeGreaterThan(1)
  expect(new Set(all.map((entry) => entry.label)).size).toBe(all.length)
  expect(new Set(all.map((entry) => entry.colour)).size).toBe(all.length)
  for (const entry of all) expect(entry.colour).toMatch(/^rgb/)
  // The legend is exactly what the map draws, and the habitat list uses the same pairs.
  await expect(mapLabel).toHaveAttribute('aria-label', new RegExp(`\\. ${all.length} habitat categories shown\\.`))
  expect(await listEntries()).toEqual(all)

  // The details panel for a category uses that same colour and label.
  const waterEdge = all.find((entry) => entry.label === 'Water edge')!
  await page.getByLabel('Habitats on the map').getByRole('button', { name: /Water edge/ }).click()
  const sheet = page.getByRole('region', { name: 'Water edge' })
  await expect(sheet.getByRole('heading', { name: 'Water edge' })).toBeVisible()
  expect(await sheet.locator('.mission-swatch').evaluate((swatch) => (swatch as HTMLElement).style.backgroundColor)).toBe(waterEdge.colour)
  await sheet.getByRole('button', { name: 'Close habitat details' }).click()

  // Fewer categories on the map: the legend drops the rest and keeps each colour.
  await page.getByRole('button', { name: 'Water hyacinth', exact: true }).click()
  await expect(legend.getByText('Open grassland or shrubland')).toHaveCount(0)
  const filtered = await legendEntries()
  expect(filtered.length).toBeGreaterThan(0)
  expect(filtered.length).toBeLessThan(all.length)
  for (const entry of filtered) expect(all).toContainEqual(entry)
  await expect(mapLabel).toHaveAttribute('aria-label', new RegExp(`\\. ${filtered.length} habitat categories shown\\.`))
  expect(await listEntries()).toEqual(filtered)

  // Compact, and clear of the map's own controls.
  const legendBox = (await legend.boundingBox())!
  const controls = page.locator('.mission-map-shell').locator('button:visible, .maplibregl-ctrl:visible')
  for (const control of await controls.all()) {
    const box = (await control.boundingBox())!
    const overlaps = box.x < legendBox.x + legendBox.width && legendBox.x < box.x + box.width
      && box.y < legendBox.y + legendBox.height && legendBox.y < box.y + box.height
    expect(overlaps, 'legend overlaps a map control').toBe(false)
  }

  await page.getByRole('button', { name: 'Clear filter' }).click()
  await expect.poll(legendEntries).toEqual(all)
})

test('AC 7.4.2 Mission scanner access: Scan a plant opens the scanner with camera, gallery and Return to mission, and the scan carries the mission ID', async ({ page }) => {
  await pinModelSpecies(page, MIKANIA)
  const mission = await startMission(page)
  await expect(total(page, 'Scans')).toHaveText('0')

  await missionScanButton(page).click()
  await expect(page).toHaveURL(/\/scan$/)
  await expect(page.getByRole('heading', { name: 'Photograph a clear plant feature' })).toBeVisible()
  await expect(page.getByText('Open camera', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Choose from gallery/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return to mission' })).toBeVisible()

  // Return to mission keeps the mission as it was.
  await page.getByRole('button', { name: 'Return to mission' }).click()
  await expect(page).toHaveURL(MISSION_URL)
  await expect(page.getByRole('heading', { name: 'Your visit' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start guided mission' })).toHaveCount(0)

  // A scan made from the mission is recorded with the active mission identifier.
  const scan = await scanFromMission(page)
  expect(scan.missionId).toBe(mission.missionId)
  expect(scan.predictedSpeciesId).toBe('mikania-micrantha')
  // The existing result screen keeps the way back on show.
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return to mission' })).toBeVisible()
})

test('AC 7.4.2 Mission scanner access: the sidebar Scan a plant button used inside an active mission also records the mission ID', async ({ page }) => {
  await pinModelSpecies(page, MIKANIA)
  const mission = await startMission(page)
  await page.locator('.sidebar-scan-button').click()
  // The scanner presents itself as part of the mission...
  await expect(page.getByRole('button', { name: 'Return to mission' })).toBeVisible()
  // ...so the scan should be recorded against it.
  const scan = await analyseGalleryPhoto(page)
  expect(scan.missionId).toBe(mission.missionId)
})

test('AC 7.4.3 Report from mission: a sighting reported during the mission is confirmed, returns to the mission and appears in its progress', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, MIKANIA)
  const mission = await startMission(page)
  await expect(page.getByText('None yet. Scan a plant with the camera or a gallery photo, then submit a sighting.')).toBeVisible()

  const scan = await scanFromMission(page)
  await expect(page.getByRole('button', { name: 'Return to mission' })).toBeVisible()
  const { status, sent, report } = await reportFromResult(page)

  // POST /api/v1/reports carries the active mission identifier and the mission scan.
  expect(status).toBe(201)
  expect(sent).toMatchObject({ missionId: mission.missionId, captureId: scan.captureId, speciesId: 'mikania-micrantha' })

  // The app confirms the report, and the confirmation keeps Return to mission.
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('Community report - not expert validated')).toBeVisible()
  const refreshed = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v1/guided-missions/active' && response.request().method() === 'GET'
  ))
  await page.getByRole('button', { name: 'Return to mission' }).click()
  await expect(page).toHaveURL(MISSION_URL)
  const active = await (await refreshed).json() as Mission
  expect(active.missionId).toBe(mission.missionId)
  expect(active.reports.map((item) => item.reportId)).toEqual([report.id])

  // The submitted report is in the mission progress summary.
  const sightings = page.getByRole('region', { name: 'Sightings from this mission' })
  const entry = sightings.getByRole('link')
  await expect(entry).toHaveCount(1)
  await expect(entry).toHaveAttribute('href', `/reports/${report.id}`)
  await expect(entry).toContainText('Mile-a-minute weed')
  await expect(entry).toContainText('community report')
  await expect(total(page, 'Sightings submitted')).toHaveText('1')
  await expect(total(page, 'Scans')).toHaveText('1')
  await expect(plantCard(page, 'Mile-a-minute weed').locator('.mission-plant__state')).toContainText('1 sighting submitted')
})

test('AC 7.4.3 Report from mission: Return to mission on the scan result screen goes back to the mission', async ({ page }) => {
  await pinModelSpecies(page, MIKANIA)
  await startMission(page)
  await scanFromMission(page)
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()
  await page.getByRole('button', { name: 'Return to mission' }).click()
  await expect(page).toHaveURL(MISSION_URL)
  await expect(total(page, 'Scans')).toHaveText('1')
})

test('AC 7.5.2 No plant found outcome: after Looked for, No target plant found is recorded and says it does not confirm absence', async ({ page }) => {
  const mission = await startMission(page)
  const card = plantCard(page, 'Siam weed')

  // Only offered once the plant has been looked for.
  await expect(card.getByRole('button', { name: 'No target plant found' })).toHaveCount(0)
  await setProgress(page, 'Siam weed', 'Looked for')
  await expect(total(page, 'No target plant found')).toHaveText('0')
  const option = card.getByRole('button', { name: 'No target plant found' })
  await expect(option).toBeVisible()

  // Selecting it records the visit outcome through the guided-missions API.
  const saved = page.waitForResponse((response) => (
    new URL(response.url()).pathname.startsWith(`/api/v1/guided-missions/${mission.missionId}`)
    && ['PUT', 'PATCH'].includes(response.request().method())
  ))
  await option.click()
  const response = await saved
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toMatchObject({ noTargetFound: true })
  const stored = (await response.json() as Mission).plants.find((plant) => plant.speciesId === 'chromolaena-odorata')
  expect(stored).toMatchObject({ state: 'looked_for', noTargetFound: true })

  // ...and states plainly that this is not evidence of absence.
  const outcome = card.getByRole('status')
  await expect(outcome).toContainText('Recorded: no target plant found on this visit.')
  await expect(outcome).toContainText('This does not confirm the plant is absent from the place.')
  await expect(total(page, 'No target plant found')).toHaveText('1')
  // No sighting was involved.
  await expect(total(page, 'Sightings submitted')).toHaveText('0')
  await expect(card.locator('.mission-plant__state')).toHaveText('Looked for')

  // The outcome survives leaving and reopening the mission.
  await page.goto(`/places/${PLACE}/mission`)
  await expect(plantCard(page, 'Siam weed').getByRole('status')).toContainText('This does not confirm the plant is absent from the place.')
})

test('AC 7.5.3 Visible mission progress: looked for, unable to check and not yet checked totals, with sightings kept apart from no-plant-found outcomes', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, MIKANIA)
  await startMission(page)

  // Nothing recorded yet: every plant is "not yet checked".
  await expect(total(page, 'Looked for')).toHaveText('0')
  await expect(total(page, 'Unable to check')).toHaveText('0')
  await expect(total(page, 'Not yet checked')).toHaveText('3')

  await setProgress(page, 'Siam weed', 'Looked for')
  await plantCard(page, 'Siam weed').getByRole('button', { name: 'No target plant found' }).click()
  await expect(total(page, 'No target plant found')).toHaveText('1')
  await setProgress(page, 'Water hyacinth', 'Unable to check')

  // Three plant-progress totals...
  await expect(total(page, 'Looked for')).toHaveText('1')
  await expect(total(page, 'Unable to check')).toHaveText('1')
  await expect(total(page, 'Not yet checked')).toHaveText('1')
  // ...and, separately, the evidence totals.
  await expect(total(page, 'Sightings submitted')).toHaveText('0')
  await expect(total(page, 'No target plant found')).toHaveText('1')
  await expect(page.locator('.mission-counts').first().locator('dt')).toHaveText(['Looked for', 'Unable to check', 'Not yet checked'])
  await expect(page.locator('.mission-counts--evidence dt')).toHaveText(['Sightings submitted', 'Scans', 'No target plant found'])

  // A submitted sighting is counted on its own and never as a no-find outcome.
  await scanFromMission(page)
  await reportFromResult(page)
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  await page.getByRole('button', { name: 'Return to mission' }).click()
  await expect(page).toHaveURL(MISSION_URL)
  await expect(total(page, 'Sightings submitted')).toHaveText('1')
  await expect(total(page, 'No target plant found')).toHaveText('1')
  await expect(total(page, 'Not yet checked')).toHaveText('1')

  // Marking the reported plant as looked for moves the plant total only; a
  // plant with a sighting is not offered the no-find outcome.
  await setProgress(page, 'Mile-a-minute weed', 'Looked for')
  await expect(total(page, 'Looked for')).toHaveText('2')
  await expect(total(page, 'Not yet checked')).toHaveText('0')
  await expect(total(page, 'No target plant found')).toHaveText('1')
  await expect(total(page, 'Sightings submitted')).toHaveText('1')
  const reported = plantCard(page, 'Mile-a-minute weed')
  await expect(reported.locator('.mission-plant__state')).toHaveText('Looked for · 1 sighting submitted')
  await expect(reported.getByRole('button', { name: 'No target plant found' })).toHaveCount(0)
})

test('AC 7.6.3 Careful summary language: a summary with no sightings says so neutrally and makes no absence, clearance or recovery claim', async ({ page }) => {
  await startMission(page)
  // Looked everywhere and found nothing: the case most tempting to overstate.
  for (const plant of ['Mile-a-minute weed', 'Siam weed', 'Water hyacinth']) {
    await setProgress(page, plant, 'Looked for')
    await plantCard(page, plant).getByRole('button', { name: 'No target plant found' }).click()
    await expect(plantCard(page, plant).getByRole('status')).toBeVisible()
  }

  await page.getByRole('button', { name: 'Finish mission' }).click()
  const completed = page.waitForResponse((response) => (
    /\/api\/v1\/guided-missions\/[^/]+\/complete$/.test(new URL(response.url()).pathname)
  ))
  await page.getByRole('dialog').getByRole('button', { name: 'Finish mission' }).click()
  const summary = await (await completed).json() as { reportsSubmittedCount: number; noTargetFoundCount: number }
  expect(summary).toMatchObject({ reportsSubmittedCount: 0, noTargetFoundCount: 3 })

  await expect(page.getByText('Mission finished')).toBeVisible()
  await expect(total(page, 'Sightings submitted')).toHaveText('0')
  const note = page.locator('.mission-summary-note')
  await expect(note).toHaveText('No target plants reported during this mission. This describes this visit only, not whether the plants are present in the place.')

  // No claim that the place is clear, recovered or free of invasive plants.
  const text = await page.getByRole('main').innerText()
  expect(text).toContain('No target plants reported during this mission')
  expect(text).not.toMatch(/\b(is|are|now|all) clear\b|clear of|cleared|recover|free (of|from)|eradicat|no invasive plants|plants are (absent|gone)|not present|no longer present/i)
  // The only mention of absence is the disclaimer that the outcome does not confirm it.
  expect(text.match(/absent/gi) ?? []).toHaveLength(1)
  await expect(page.getByText('A “No target plant found” outcome does not confirm the plant is absent from the place.')).toBeVisible()
})

// --- Stories 7.1 to 7.6: the criteria the journey spec only touches in passing ---

const PLACE_NAME = 'Taman Tasik Titiwangsa'
const PLANT_NAMES: Record<string, string> = {
  'mikania-micrantha': 'Mile-a-minute weed',
  'chromolaena-odorata': 'Siam weed',
  'eichhornia-crassipes': 'Water hyacinth',
}
const SAFETY_NOTICE = /not walking routes, access has not been verified, and local signs, closures and restrictions take priority/
const OVERCLAIM = /probabilit|\bscores?\b|\brank|high[- ]priority|priority (area|zone)|likely (location|to (be|find))|hotspot|confirmed (location|presence)/i

/** The shipped static habitat data for this place, read the way the app joins
 *  it: overlay categories that at least one of the given plants can use. */
function habitatData() {
  const root = path.join(process.cwd(), 'public/data/habitat-zones/osm-2026-09-14-habitat-v1')
  const read = <T>(file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as T
  const entry = read<{ places: Array<{ place_id: string; overlay_url: string }> }>('index.json')
    .places.find((place) => place.place_id === PLACE)!
  const lookup = new Map(read<{ plants: Array<{ species_id: string; habitat_categories: string[] }> }>('plant_habitat_lookup.json')
    .plants.map((plant) => [plant.species_id.replace(/_/g, '-'), plant.habitat_categories]))
  const overlay = read<{ features: Array<{ properties: { habitat: string; habitat_label: string } }> }>(entry.overlay_url)
  const inPlace = new Map(overlay.features.map((feature) => [feature.properties.habitat, feature.properties.habitat_label]))
  const plantsFor = (habitat: string, speciesIds: string[]) => speciesIds.filter((id) => lookup.get(id)?.includes(habitat))
  return {
    inPlace,
    plantsFor,
    /** Labels of the categories to highlight for these plants. */
    labelsFor: (speciesIds: string[]) => [...inPlace].filter(([habitat]) => plantsFor(habitat, speciesIds).length > 0).map(([, label]) => label),
    /** Labels of mapped categories that suit none of these plants. */
    unmatchedLabels: (speciesIds: string[]) => [...inPlace].filter(([habitat]) => plantsFor(habitat, speciesIds).length === 0).map(([, label]) => label),
  }
}

const legendLabels = (page: Page) => page.getByLabel('Map legend').locator('li').allInnerTexts().then((labels) => labels.map((label) => label.trim()).sort())
const missionMap = (page: Page) => page.getByRole('region', { name: /^Compatible habitat map for / })
const isMissionCall = (url: string) => new URL(url).pathname.startsWith('/api/v1/guided-missions')

test('AC 7.1.2 Mission watchlist preview: place name, map preview, watchlist with reference images, the guidance disclaimer and a Start action that creates the mission', async ({ page }) => {
  await startPrivateAccess(page)
  const writes: string[] = []
  page.on('request', (request) => {
    if (isMissionCall(request.url()) && request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
  })
  const watchlistLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/places/${PLACE}/plant-associations`)
  const placeLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/places/${PLACE}`)
  await page.goto(`/places/${PLACE}`)
  const watchlist = (await (await watchlistLoaded).json() as { items: Array<{ speciesId: string; scientificName: string }> }).items
  const place = await (await placeLoaded).json() as { displayName: string; geometry: { type: string } | null }
  expect(watchlist.length).toBeGreaterThan(0)

  // Given the user selects Start guided mission on the place: the preview opens.
  await page.getByRole('link', { name: 'Start guided mission' }).click()
  await expect(page).toHaveURL(MISSION_URL)
  await expect(page.getByText('Mission preview', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: place.displayName })).toBeVisible()
  expect(place.displayName).toBe(PLACE_NAME)

  // Map preview of the place: its boundary is available and the map is drawn.
  expect(place.geometry?.type).toMatch(/Polygon/)
  await expect(missionMap(page)).toBeVisible()
  await expect(missionMap(page).locator('canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show whole place' })).toBeVisible()

  // Every watchlist plant, each with its reference image.
  const plants = page.locator('.mission-preview-plants > li')
  await expect(plants).toHaveCount(watchlist.length)
  for (const item of watchlist) {
    const row = plants.filter({ hasText: PLANT_NAMES[item.speciesId] })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(item.scientificName)
    const image = row.getByRole('img', { name: `Reference view of ${item.scientificName}` })
    await image.scrollIntoViewIfNeeded()
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true)
  }

  // Highlights are search guidance, not confirmed plant locations.
  await expect(page.getByText('Highlights show compatible habitat to search, not confirmed plant locations.')).toBeVisible()

  // Nothing is created by looking at the preview; Start mission creates it.
  const start = page.getByRole('button', { name: 'Start guided mission' })
  await expect(start).toBeEnabled()
  expect(writes).toEqual([])
  const created = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v1/guided-missions' && response.request().method() === 'POST'
  ))
  await start.click()
  const response = await created
  expect(response.status()).toBeLessThan(300)
  const sent = response.request().postDataJSON() as { placeId: string; watchlistSpeciesIds: string[] }
  expect(sent.placeId).toBe(PLACE)
  expect([...sent.watchlistSpeciesIds].sort()).toEqual(watchlist.map((item) => item.speciesId).sort())
  expect(writes).toEqual(['POST /api/v1/guided-missions'])
  await expect(page.getByRole('heading', { name: 'Your visit' })).toBeVisible()
  await expect(page.getByText('Mission preview', { exact: true })).toHaveCount(0)
})

test('AC 7.2.1 Search zone map: the started mission maps the place boundary and exactly the habitat categories that suit a watchlist plant', async ({ page }) => {
  // The polygons are painted on a WebGL canvas, so what is drawn is checked
  // through what the map is given: its described category count, the legend
  // and the habitat list, against the shipped overlay and plant lookup.
  const placeLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/places/${PLACE}`)
  const overlayLoaded = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/data/habitat-zones/osm-2026-09-14-habitat-v1/places/${PLACE}.geojson`
  ))
  const mission = await startMission(page)
  const place = await (await placeLoaded).json() as { geometry: { type: string; coordinates: unknown[] } | null }
  expect((await overlayLoaded).status()).toBe(200)
  const data = habitatData()
  const watchlist = mission.plants.map((plant) => plant.speciesId)
  const expected = data.labelsFor(watchlist).sort()
  expect(expected.length).toBeGreaterThan(1)

  // The full place boundary: the map has the place geometry and a way to fit it.
  expect(place.geometry?.type).toMatch(/Polygon/)
  expect(place.geometry!.coordinates.length).toBeGreaterThan(0)
  await expect(missionMap(page).locator('canvas')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show whole place' })).toBeEnabled()
  await page.getByRole('button', { name: 'Show whole place' }).click()

  // One highlight per available category that matches at least one watchlist plant.
  await expect(missionMap(page)).toHaveAttribute('aria-label', `Compatible habitat map for ${PLACE_NAME}. ${expected.length} habitat categories shown. The list below describes the same habitats.`)
  expect(await legendLabels(page)).toEqual(expected)
  const listed = await page.getByLabel('Habitats on the map').locator('li strong').allInnerTexts()
  expect([...listed].sort()).toEqual(expected)

  // A category mapped in the place that suits none of the plants is not highlighted.
  const unmatched = data.unmatchedLabels(watchlist)
  expect(unmatched).toContain('Forest interior')
  for (const label of unmatched) {
    await expect(page.getByLabel('Map legend').getByText(label, { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Habitats on the map').getByText(label, { exact: true })).toHaveCount(0)
  }
})

test('AC 7.2.3 Access limitation: choosing a watchlist plant narrows the map and legend to its habitats, and Clear filter restores them all', async ({ page }) => {
  const mission = await startMission(page)
  const data = habitatData()
  const watchlist = mission.plants.map((plant) => plant.speciesId)
  expect(watchlist.length).toBeGreaterThan(1)
  const all = data.labelsFor(watchlist).sort()
  const filter = page.getByRole('group', { name: 'Show habitat for one plant' })
  const clear = page.getByRole('button', { name: 'Clear filter' })
  await expect(clear).toHaveCount(0)

  for (const speciesId of watchlist) {
    const own = data.labelsFor([speciesId]).sort()
    expect(own.length).toBeLessThan(all.length)
    const saved = page.waitForResponse((response) => (
      new URL(response.url()).pathname === `/api/v1/guided-missions/${mission.missionId}` && response.request().method() === 'PATCH'
    ))
    await filter.getByRole('button', { name: PLANT_NAMES[speciesId], exact: true }).click()
    expect((await saved).request().postDataJSON()).toEqual({ selectedSpeciesId: speciesId })

    // Selected plant state, and only that plant selected.
    await expect(filter.getByRole('button', { name: PLANT_NAMES[speciesId], exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(filter.locator('button[aria-pressed="true"]')).toHaveCount(1)
    // Map and legend show only the categories assigned to that plant.
    await expect.poll(() => legendLabels(page)).toEqual(own)
    await expect(missionMap(page)).toHaveAttribute('aria-label', new RegExp(`\\. ${own.length} habitat categories shown\\.`))
    const listed = await page.getByLabel('Habitats on the map').locator('li strong').allInnerTexts()
    expect([...listed].sort()).toEqual(own)

    // A visible Clear filter restores every compatible mission habitat.
    await expect(clear).toBeVisible()
    await clear.click()
    await expect.poll(() => legendLabels(page)).toEqual(all)
    await expect(missionMap(page)).toHaveAttribute('aria-label', new RegExp(`\\. ${all.length} habitat categories shown\\.`))
    await expect(filter.locator('button[aria-pressed="true"]')).toHaveCount(0)
    await expect(clear).toHaveCount(0)
  }
})

test('AC 7.3.1 Zone explanation: a selected habitat shows its name, every matching watchlist plant and the not-confirmed message', async ({ page }) => {
  // The highlight is selected through its entry in the habitat list, which
  // opens the same details panel as clicking the polygon on the canvas.
  const mission = await startMission(page)
  const data = habitatData()
  const watchlist = mission.plants.map((plant) => plant.speciesId)
  const visible = [...data.inPlace].filter(([habitat]) => data.plantsFor(habitat, watchlist).length > 0)
  expect(visible.length).toBeGreaterThan(1)

  for (const [habitat, label] of visible) {
    await page.getByLabel('Habitats on the map').getByRole('button', { name: new RegExp(`^${label}`) }).click()
    const panel = page.locator('.mission-habitat-sheet')
    // Habitat name.
    await expect(panel.getByRole('heading', { level: 3 })).toHaveText(label)
    // The message, word for word.
    await expect(panel.locator('.mission-habitat-sheet__notice')).toHaveText('Suggested area to search - plant presence is not confirmed.')
    // All matching watchlist plants, and none that does not match.
    const matching = data.plantsFor(habitat, watchlist)
    const links = panel.locator('.mission-habitat-sheet__plants').getByRole('link')
    await expect(links).toHaveCount(matching.length)
    for (const speciesId of matching) await expect(links.filter({ hasText: PLANT_NAMES[speciesId] })).toHaveCount(1)
    for (const speciesId of watchlist.filter((id) => !matching.includes(id))) {
      await expect(links.filter({ hasText: PLANT_NAMES[speciesId] })).toHaveCount(0)
    }
    await panel.getByRole('button', { name: 'Close habitat details' }).click()
    await expect(panel).toHaveCount(0)
  }
})

test('AC 7.3.2 Guidance level wording: preview, legend and details say Compatible habitat or Suggested area to search, never a priority or likelihood claim', async ({ page }) => {
  await startPrivateAccess(page)
  await page.goto(`/places/${PLACE}/mission`)

  // Preview.
  await expect(page.getByText('Mission preview', { exact: true })).toBeVisible()
  await expect(page.locator('.mission-guidance-banner')).toContainText('compatible habitat')
  await expect(page.getByLabel('Map legend').locator('strong')).toHaveText('Compatible habitat')
  await expect(missionMap(page)).toHaveAttribute('aria-label', /^Compatible habitat map for /)
  expect(await page.getByRole('main').innerText()).not.toMatch(OVERCLAIM)

  // Legend on the active mission map.
  await page.getByRole('button', { name: 'Start guided mission' }).click()
  await expect(page.getByRole('heading', { name: 'Your visit' })).toBeVisible()
  await expect(page.getByLabel('Map legend').locator('strong')).toHaveText('Compatible habitat')
  await expect(missionMap(page)).toHaveAttribute('aria-label', /^Compatible habitat map for /)
  expect(await page.getByRole('main').innerText()).not.toMatch(OVERCLAIM)

  // Details panel, for every highlighted category.
  const entries = page.getByLabel('Habitats on the map').getByRole('button')
  const count = await entries.count()
  expect(count).toBeGreaterThan(1)
  for (let index = 0; index < count; index += 1) {
    await entries.nth(index).click()
    const panel = page.locator('.mission-habitat-sheet')
    await expect(panel.locator('.mission-eyebrow')).toHaveText('Compatible habitat')
    await expect(panel).toContainText('Suggested area to search')
    expect(await panel.innerText()).not.toMatch(OVERCLAIM)
    await panel.getByRole('button', { name: 'Close habitat details' }).click()
  }
  // The data note behind the map uses the same cautious wording.
  await page.getByRole('button', { name: 'About this guidance and data sources' }).click()
  await expect(page.locator('.mission-about')).toContainText('They describe compatibility only, not sightings.')
  expect(await page.getByRole('main').innerText()).not.toMatch(OVERCLAIM)
})

test('AC 7.3.3 General guidance fallback: the routes, access and restrictions notice stays on the mission map page without blocking it', async ({ page }) => {
  await startMission(page)
  const notice = page.locator('.mission-guidance-banner')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('They are not walking routes')
  await expect(notice).toContainText('access has not been verified')
  await expect(notice).toContainText('local signs, closures and restrictions take priority')
  await expect(notice).toHaveText(SAFETY_NOTICE)

  // It is ordinary page content: not a dialog, not fixed over the page, and not on top of the map.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await notice.evaluate((element) => getComputedStyle(element).position)).not.toMatch(/fixed|sticky/)
  const noticeBox = (await notice.boundingBox())!
  const mapBox = (await page.locator('.mission-map-shell').boundingBox())!
  const overlaps = noticeBox.x < mapBox.x + mapBox.width && mapBox.x < noticeBox.x + noticeBox.width
    && noticeBox.y < mapBox.y + mapBox.height && mapBox.y < noticeBox.y + noticeBox.height
  expect(overlaps).toBe(false)

  // The map and the mission controls all still respond with the notice showing.
  await missionMap(page).locator('.maplibregl-ctrl-zoom-in').click()
  await page.getByRole('button', { name: 'Show whole place' }).click()
  await page.getByRole('group', { name: 'Show habitat for one plant' }).getByRole('button', { name: 'Water hyacinth', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Clear filter' })).toBeVisible()
  await page.getByLabel('Habitats on the map').getByRole('button').first().click()
  await expect(page.locator('.mission-habitat-sheet')).toBeVisible()
  await page.locator('.mission-habitat-sheet').getByRole('button', { name: 'Close habitat details' }).click()
  await setProgress(page, 'Siam weed', 'Looked for')
  await expect(plantCard(page, 'Siam weed').locator('.mission-plant__state')).toHaveText('Looked for')
  await expect(notice).toBeVisible()
  await expect(notice).toHaveText(SAFETY_NOTICE)
})

test('AC 7.5.1 Zone progress choices: each plant starts Not checked and can be set to Looked for or Unable to check, shown on its card and saved', async ({ page }) => {
  const mission = await startMission(page)
  expect(mission.plants.map((plant) => plant.state)).toEqual(['not_checked', 'not_checked', 'not_checked'])

  // Not checked is the default on every card, with the two other options offered.
  const cards = page.locator('.mission-plant')
  await expect(cards).toHaveCount(mission.plants.length)
  for (const name of Object.values(PLANT_NAMES)) {
    const options = page.getByRole('radiogroup', { name: `Progress for ${name}` })
    await expect(options.getByRole('radio')).toHaveText(['Not checked', 'Looked for', 'Unable to check'])
    await expect(options.getByRole('radio', { name: 'Not checked' })).toHaveAttribute('aria-checked', 'true')
    await expect(options.getByRole('radio', { checked: true })).toHaveCount(1)
    await expect(plantCard(page, name).locator('.mission-plant__state')).toHaveText('Not checked')
  }

  // Recording progress calls PUT /guided-missions/{mission_id}/plants/{species_id}.
  for (const step of [
    { name: 'Siam weed', speciesId: 'chromolaena-odorata', choice: 'Looked for' as const, state: 'looked_for' },
    { name: 'Water hyacinth', speciesId: 'eichhornia-crassipes', choice: 'Unable to check' as const, state: 'unable_to_check' },
  ]) {
    const response = await setProgress(page, step.name, step.choice)
    expect(new URL(response.url()).pathname).toBe(`/api/v1/guided-missions/${mission.missionId}/plants/${step.speciesId}`)
    expect(response.request().postDataJSON()).toMatchObject({ state: step.state })
    const stored = (await response.json() as Mission).plants.find((plant) => plant.speciesId === step.speciesId)
    expect(stored?.state).toBe(step.state)
    // The selected state shows on the plant card.
    const options = page.getByRole('radiogroup', { name: `Progress for ${step.name}` })
    await expect(options.getByRole('radio', { name: step.choice })).toHaveAttribute('aria-checked', 'true')
    await expect(options.getByRole('radio', { checked: true })).toHaveCount(1)
    await expect(plantCard(page, step.name).locator('.mission-plant__state')).toHaveText(step.choice)
  }
  await expect(plantCard(page, 'Mile-a-minute weed').locator('.mission-plant__state')).toHaveText('Not checked')

  // The recorded states are what the mission holds after a reload.
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Your visit' })).toBeVisible()
  await expect(plantCard(page, 'Siam weed').locator('.mission-plant__state')).toHaveText('Looked for')
  await expect(plantCard(page, 'Water hyacinth').locator('.mission-plant__state')).toHaveText('Unable to check')
  await expect(plantCard(page, 'Mile-a-minute weed').locator('.mission-plant__state')).toHaveText('Not checked')
  await expect(page.getByRole('radiogroup', { name: 'Progress for Water hyacinth' }).getByRole('radio', { name: 'Unable to check' })).toHaveAttribute('aria-checked', 'true')

  // A choice can be taken back to Not checked.
  await setProgress(page, 'Siam weed', 'Not checked')
  await expect(plantCard(page, 'Siam weed').locator('.mission-plant__state')).toHaveText('Not checked')
})

test('AC 7.6.1 Mission summary: finishing shows the six totals from this mission and Plan another visit reopens the preview', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, MIKANIA)
  const mission = await startMission(page)

  // One plant looked for with no find, one unable to check, one left unchecked
  // but scanned and reported.
  await setProgress(page, 'Siam weed', 'Looked for')
  await plantCard(page, 'Siam weed').getByRole('button', { name: 'No target plant found' }).click()
  await expect(plantCard(page, 'Siam weed').getByRole('status')).toBeVisible()
  await setProgress(page, 'Water hyacinth', 'Unable to check')
  await scanFromMission(page)
  const { report } = await reportFromResult(page)
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  await page.getByRole('button', { name: 'Return to mission' }).click()
  await expect(page).toHaveURL(MISSION_URL)
  await expect(total(page, 'Sightings submitted')).toHaveText('1')

  // Finish: the confirmation, then POST /guided-missions/{id}/complete.
  await page.getByRole('button', { name: 'Finish mission' }).click()
  const dialog = page.getByRole('dialog', { name: 'Finish this mission?' })
  await expect(dialog).toContainText('1 looked for · 1 unable to check · 1 not checked · 1 sighting submitted.')
  const completed = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v1/guided-missions/${mission.missionId}/complete` && response.request().method() === 'POST'
  ))
  await dialog.getByRole('button', { name: 'Finish mission' }).click()
  const response = await completed
  expect(response.status()).toBe(200)
  const summary = await response.json() as Record<string, unknown>
  expect(summary).toMatchObject({
    missionId: mission.missionId, status: 'completed',
    lookedForCount: 1, unableToCheckCount: 1, notCheckedCount: 1,
    scansCount: 1, reportsSubmittedCount: 1, noTargetFoundCount: 1,
  })

  // The completed-mission summary shows all six figures.
  await expect(page.getByText('Mission finished', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: PLACE_NAME })).toBeVisible()
  await expect(page.locator('.mission-counts dt')).toHaveText(['Looked for', 'Unable to check', 'Not checked', 'Scans', 'Sightings submitted', 'No target plant found'])
  await expect(page.locator('.mission-counts dd')).toHaveText(['1', '1', '1', '1', '1', '1'])
  // The submitted sighting is listed, from that mission.
  const sighting = page.locator('.mission-reports').getByRole('link')
  await expect(sighting).toHaveCount(1)
  await expect(sighting).toHaveAttribute('href', `/reports/${report.id}`)
  await expect(sighting).toContainText('Mile-a-minute weed')
  // GET /guided-missions/{id}/summary returns the same totals.
  const fetched = await page.evaluate(async ({ url, token }) => {
    const answer = await fetch(url, { headers: { authorization: token } })
    return { status: answer.status, body: await answer.json() as Record<string, unknown> }
  }, { url: `/api/v1/guided-missions/${mission.missionId}/summary`, token: response.request().headers().authorization })
  expect(fetched.status).toBe(200)
  expect(fetched.body).toMatchObject({ lookedForCount: 1, unableToCheckCount: 1, notCheckedCount: 1, scansCount: 1, reportsSubmittedCount: 1, noTargetFoundCount: 1 })

  // Plan another visit opens the mission preview of the same place again.
  await page.getByRole('button', { name: 'Plan another visit' }).click()
  await expect(page).toHaveURL(MISSION_URL)
  await expect(page.getByText('Mission preview', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: PLACE_NAME })).toBeVisible()
  await expect(page.locator('.mission-preview-plants > li')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Start guided mission' })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Your visit' })).toHaveCount(0)
})

test('AC 7.6.2 Resume unfinished mission: returning to the place offers Resume mission and restores the plant filter and the recorded progress', async ({ page }) => {
  const mission = await startMission(page)
  const data = habitatData()
  const filtered = data.labelsFor(['eichhornia-crassipes']).sort()

  // A plant filter and some progress, then the user leaves without finishing.
  await page.getByRole('group', { name: 'Show habitat for one plant' }).getByRole('button', { name: 'Water hyacinth', exact: true }).click()
  await expect.poll(() => legendLabels(page)).toEqual(filtered)
  await setProgress(page, 'Siam weed', 'Looked for')
  await plantCard(page, 'Siam weed').getByRole('button', { name: 'No target plant found' }).click()
  await expect(plantCard(page, 'Siam weed').getByRole('status')).toBeVisible()
  await setProgress(page, 'Mile-a-minute weed', 'Unable to check')
  await page.goto('/map')
  await expect(page).toHaveURL(/\/map$/)

  // The same anonymous user returns to the place: Resume mission is offered.
  const calls: string[] = []
  page.on('request', (request) => {
    if (isMissionCall(request.url())) calls.push(`${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`)
  })
  const activeLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/guided-missions/active')
  await page.goto(`/places/${PLACE}`)
  const active = await activeLoaded
  expect(new URL(active.url()).searchParams.get('place_id')).toBe(PLACE)
  expect((await active.json() as Mission).missionId).toBe(mission.missionId)
  await expect(page.getByRole('heading', { name: 'Guided mission in progress' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start guided mission' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Resume mission' }).click()
  await expect(page).toHaveURL(MISSION_URL)

  // Straight back into the active mission, not a new one.
  await expect(page.getByRole('heading', { name: 'Your visit' })).toBeVisible()
  await expect(page.getByText('Mission preview', { exact: true })).toHaveCount(0)
  expect(calls.filter((call) => call.startsWith('POST'))).toEqual([])

  // The selected plant filter is restored, on the buttons and on the map.
  const filter = page.getByRole('group', { name: 'Show habitat for one plant' })
  await expect(filter.getByRole('button', { name: 'Water hyacinth', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(filter.locator('button[aria-pressed="true"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Clear filter' })).toBeVisible()
  await expect.poll(() => legendLabels(page)).toEqual(filtered)
  await expect(missionMap(page)).toHaveAttribute('aria-label', new RegExp(`\\. ${filtered.length} habitat categories shown\\.`))

  // The recorded watchlist progress is restored.
  await expect(plantCard(page, 'Siam weed').locator('.mission-plant__state')).toHaveText('Looked for')
  await expect(plantCard(page, 'Siam weed').getByRole('status')).toContainText('Recorded: no target plant found on this visit.')
  await expect(plantCard(page, 'Mile-a-minute weed').locator('.mission-plant__state')).toHaveText('Unable to check')
  await expect(plantCard(page, 'Water hyacinth').locator('.mission-plant__state')).toHaveText('Not checked')
  await expect(total(page, 'Looked for')).toHaveText('1')
  await expect(total(page, 'Unable to check')).toHaveText('1')
  await expect(total(page, 'Not yet checked')).toHaveText('1')
  await expect(total(page, 'No target plant found')).toHaveText('1')
})
