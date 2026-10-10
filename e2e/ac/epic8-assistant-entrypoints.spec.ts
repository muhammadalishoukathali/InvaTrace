// Epic 8 — the Plant Assistant's Plant Guide and Map entry points (US 8.5),
// plus the one criterion that is about all three entry points at once.
//
// Mock/UI-contract layer, as in epic8-assistant-scan.spec.ts: the assistant
// endpoints are stubbed, so these tests prove what each entry point sends and
// shows. The server-side rechecks (exact catalogue ID, public visibility and
// species mapping of a sighting on every request, what reaches the model) are
// for the real-stack spec.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { pinModelSpecies, scanPhoto, startPrivateAccess } from '../fixtures/app'
import {
  GUIDE_LIMITATION_TEXT, HABITAT_SOURCE, HABITAT_TEXT, MAP_LIMITATION_TEXT, RHIZOME_TEXT, SAFETY_BOUNDARY,
  ask, grounded, latestTurn, limitation, mixed, openGuideAssistant, openMapAssistant, recordAssistant, scanPanel,
} from '../fixtures/assistant'

const GUIDE_KEYS = ['allowGeneralKnowledge', 'depth', 'history', 'question', 'sectionAware', 'speciesId']
const MAP_KEYS = ['allowGeneralKnowledge', 'depth', 'history', 'question', 'sectionAware', 'sightingId']
const PHONE = { width: 390, height: 844 }

/** Client-side navigation, so in-memory state (the scan, any open
 *  conversation) survives the way it does when a person uses the nav. A
 *  page.goto would reload the app and prove nothing about state resets. */
async function navigateInApp(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

async function askFromSightingSheet(page: Page) {
  await page.getByRole('dialog', { name: 'Sighting details', exact: true })
    .getByRole('button', { name: 'Ask Plant Assistant', exact: true }).click()
  return page.getByRole('dialog', { name: 'Map Plant Assistant', exact: true })
}

const turns = (page: Page) => page.locator('.plant-assistant__turn')
const closeAssistant = (page: Page) => page.getByRole('button', { name: 'Close plant assistant', exact: true }).click()
const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
const holdsFocus = (dialog: Locator) => dialog.evaluate(element => element.contains(document.activeElement))

test('AC 8.4.1 Require a valid ordinary gap for expanded model knowledge', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => mixed())
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  const question = 'Where does it grow and what is a rhizome?'

  // Scan, Guide and Map each ask through their own endpoint.
  await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  await ask(page, question)
  await navigateInApp(page, '/catalogue/mikania-micrantha')
  await page.getByRole('button', { name: /^Ask Plant Assistant/ }).click()
  await ask(page, question)
  await closeAssistant(page)
  await navigateInApp(page, '/map?sighting=s-01')
  await askFromSightingSheet(page)
  await ask(page, question)

  expect(calls.map(call => call.path)).toEqual([
    '/api/v1/plant-assistant/ask', '/api/v1/plant-assistant/guide/ask', '/api/v1/plant-assistant/map/ask',
  ])
  // Expanded mode is never implied: every request states the opt-in, and that
  // it can render typed sections, alongside its own trusted context.
  for (const call of calls) expect(call.body).toMatchObject({ allowGeneralKnowledge: true, sectionAware: true, question })
  expect(calls[0].body.speciesId).toBe('mikania-micrantha')
  expect(calls[1].body.speciesId).toBe('mikania-micrantha')
  expect(calls[2].body.sightingId).toBe('s-01')

  // A partly supported question is not shown as wholly unsupported: the
  // supported fact stays a cited reviewed claim and only the gap is AI text.
  const turn = latestTurn(page)
  await expect(turn).toHaveAttribute('data-mode', 'grounded')
  const reviewed = turn.getByRole('region', { name: 'From reviewed sources', exact: true })
  await expect(reviewed.locator('.plant-assistant__answer')).toHaveText(HABITAT_TEXT)
  await expect(reviewed.getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(turn.locator('[data-section-kind="ai"] .plant-assistant__answer')).toHaveText(RHIZOME_TEXT)
  await expect(turn.locator('[data-section-kind="ai"] a')).toHaveCount(0)
})

test('AC 8.5.1 Open from a trusted Plant Guide', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => grounded())
  await startPrivateAccess(page)
  await page.goto('/catalogue/mikania-micrantha')
  await expect(page.getByRole('heading', { name: 'Typical habitat' })).toBeVisible()
  const guide = await page.locator('main').innerText()

  await page.getByRole('button', { name: /^Ask Plant Assistant/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Guide Plant Assistant', exact: true })
  // The same assistant, on this guide's species, described as education only.
  await expect(dialog.getByRole('heading', { name: 'Plant Assistant', exact: true })).toBeVisible()
  await expect(dialog.locator('.plant-assistant__species-name')).toHaveText('Mikania micrantha')
  await expect(dialog.locator('.plant-assistant__context')).toHaveText('Plant guide')
  await expect(dialog.locator('.plant-assistant__context-boundary')).toHaveText('This is catalogue education, not identification or verification of an observed plant.')
  await expect(dialog.getByRole('group', { name: 'Suggested plant questions' }).getByRole('button')).toHaveCount(5)
  expect(calls).toHaveLength(0)

  await ask(page, 'Where does it grow?')
  // The guide endpoint gets the exact catalogue ID and nothing that could
  // pass for a scan: no confidence, no outcome.
  expect(calls[0].path).toBe('/api/v1/plant-assistant/guide/ask')
  expect(Object.keys(calls[0].body).sort()).toEqual(GUIDE_KEYS)
  expect(calls[0].body).toMatchObject({ speciesId: 'mikania-micrantha', question: 'Where does it grow?', depth: 'standard', history: [] })
  await expect(latestTurn(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(dialog).not.toContainText(/\d+\s?%|confidence/i)

  // Closing leaves the guide exactly as it was.
  await closeAssistant(page)
  await expect(dialog).toHaveCount(0)
  expect(await page.locator('main').innerText()).toBe(guide)
})

test('AC 8.5.2 Open from a verified public Map reference', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => grounded())
  await startPrivateAccess(page)
  await page.goto('/map?sighting=s-01')
  const sheet = page.getByRole('dialog', { name: 'Sighting details', exact: true })
  // The sheet shows the record's coordinates and confidence; the assistant must not pass them on.
  const coordinates = (await sheet.getByText(/^\d+\.\d{3,}, \d+\.\d{3,}$/).innerText()).split(', ')
  expect(coordinates).toHaveLength(2)

  const dialog = await askFromSightingSheet(page)
  await expect(dialog.locator('.plant-assistant__species-name')).toHaveText('Mikania micrantha')
  await expect(dialog.locator('.plant-assistant__context')).toHaveText('Public map record')
  // A community record is not presented as identification or proof of presence.
  await expect(dialog.locator('.plant-assistant__context-boundary')).toHaveText('This is catalogue information for a public community record, not expert identification or proof of nearby presence.')
  await expect(dialog).not.toContainText(coordinates[0])
  await expect(dialog).not.toContainText(/\d+\s?%|confidence/i)

  await ask(page, 'Where does it grow?')
  await ask(page, 'What are its impacts?')
  expect(calls).toHaveLength(2)
  for (const call of calls) {
    // Every question names the sighting again, so the server can recheck it
    // each time; the sighting reference is the only context sent. The client
    // supplies no species, classifier result, coordinates or place.
    expect(call.path).toBe('/api/v1/plant-assistant/map/ask')
    expect(Object.keys(call.body).sort()).toEqual(MAP_KEYS)
    expect(call.body.sightingId).toBe('s-01')
    const sent = JSON.stringify(call.body)
    for (const value of coordinates) expect(sent).not.toContain(value)
    expect(sent).not.toMatch(/lat|lng|longitude|location|coordinate|West Trail|mikania|confidence|report/i)
  }
  // The history that goes with the second question is the conversation text only.
  expect(calls[1].body.history).toEqual([
    { role: 'user', content: 'Where does it grow?' },
    { role: 'assistant', content: HABITAT_TEXT },
  ])
  await expect(latestTurn(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
})

test('AC 8.5.3 State an honest limitation without usable context', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => grounded())
  await startPrivateAccess(page)

  // Map with nothing selected: there is no assistant to open, so no chat can
  // start without a record.
  await expect(page.locator('.map-pin').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask Plant Assistant/ })).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Map Plant Assistant' })).toHaveCount(0)

  // An unknown sighting reference offers no assistant either.
  await page.goto('/map?sighting=not-a-public-record')
  await expect(page.locator('.map-pin').first()).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Sighting details', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask Plant Assistant/ })).toHaveCount(0)

  // An unknown guide reference is an honest not-found page with no assistant.
  await page.goto('/catalogue/not-a-catalogue-plant')
  await expect(page.getByText('Catalogue plant not found.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask Plant Assistant/ })).toHaveCount(0)
  expect(calls).toHaveLength(0)
})

test('AC 8.5.3 A Map record without a supported species gets a limitation, not a chat', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => grounded())
  // The mock map only seeds supported species, and the service worker answers
  // sighting reads before a route can see them, so fetch is wrapped to turn
  // one public record into one whose species is not in the catalogue.
  await page.addInitScript(() => {
    const real = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const response = await real(input, init)
      if (new URL(raw, window.location.origin).pathname !== '/api/v1/sightings/s-01') return response
      const detail = await response.json() as Record<string, unknown>
      return new Response(JSON.stringify({ ...detail, speciesId: 'unlisted-plant', speciesName: 'Unlisted plant', latinName: 'Planta incognita' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
  })
  await startPrivateAccess(page)
  await page.goto('/map?sighting=s-01')
  const dialog = await askFromSightingSheet(page)

  await expect(dialog.getByRole('status')).toHaveText('This record cannot provide supported plant context. Select a supported public plant record.')
  // Nothing is invented to fill the gap: no species, no confidence, no way to ask.
  await expect(dialog.locator('.plant-assistant__species-name')).toHaveCount(0)
  await expect(dialog).not.toContainText(/Planta incognita|Unlisted plant|Mikania|\d+\s?%|confidence|near you|nearby/i)
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await expect(dialog.getByRole('group', { name: 'Suggested plant questions' })).toHaveCount(0)
  expect(calls).toHaveLength(0)
})

test('AC 8.5.3 A Map or Guide reference the API refuses is shown as a limitation', async ({ page, context }) => {
  // The literal refusals the API returns when its own recheck fails (record
  // withdrawn or inconsistent since the page loaded; guide ID not canonical).
  const calls = await recordAssistant(context, ({ path }) => limitation('insufficient_evidence', path.endsWith('/map/ask') ? MAP_LIMITATION_TEXT : GUIDE_LIMITATION_TEXT))
  await startPrivateAccess(page)

  for (const [open, text] of [
    [() => openMapAssistant(page), MAP_LIMITATION_TEXT],
    [() => openGuideAssistant(page), GUIDE_LIMITATION_TEXT],
  ] as const) {
    const dialog = await open()
    await ask(page, 'Where does it grow?')
    const turn = latestTurn(page)
    await expect(turn).toHaveAttribute('data-mode', 'limitation')
    await expect(turn.locator('.plant-assistant__answer')).toHaveText(text)
    // No answer, source, AI text or level control is attached to a refusal.
    await expect(turn.getByRole('heading', { name: 'Answer', exact: true })).toHaveCount(0)
    await expect(turn.locator('[data-section-kind]')).toHaveCount(0)
    await expect(turn.locator('a')).toHaveCount(0)
    await expect(turn.getByRole('group', { name: 'Explanation level' })).toHaveCount(0)
    await expect(dialog).not.toContainText(/\d+\s?%|classifier/i)
  }

  // A refused question is not an answered one, and asking again still sends
  // the same reference for the server to recheck, never a context-free chat.
  await page.getByLabel('Your question', { exact: true }).fill('where does it grow?')
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  await expect.poll(() => calls.length).toBe(3)
  expect(calls[0].body.sightingId).toBe('s-01')
  expect(calls[2].path).toBe('/api/v1/plant-assistant/guide/ask')
  expect(calls[2].body.speciesId).toBe('mikania-micrantha')
})

test('AC 8.5.4 Reset incompatible conversation state', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => mixed())
  const question = 'Where does it grow and what is a rhizome?'
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)

  // Scan: a mixed answer, then the repeat prompt, so every kind of state exists.
  await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  await ask(page, question)
  await page.getByLabel('Your question', { exact: true }).fill(question)
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  await expect(page.locator('.plant-assistant__repeat')).toBeVisible()
  await expect(turns(page)).toHaveCount(1)

  // Scan -> Guide for the same species: nothing carries over, not even the
  // "already answered" memory, and the request has no scan fields or history.
  await navigateInApp(page, '/catalogue/mikania-micrantha')
  await page.getByRole('button', { name: /^Ask Plant Assistant/ }).click()
  const guideDialog = page.getByRole('dialog', { name: 'Guide Plant Assistant', exact: true })
  await expect(guideDialog.getByText('Choose a suggested question or write your own.')).toBeVisible()
  await expect(turns(page)).toHaveCount(0)
  await expect(page.locator('.plant-assistant__repeat')).toHaveCount(0)
  await expect(guideDialog.locator('a, details.plant-assistant__ai-disclosure')).toHaveCount(0)
  await ask(page, question)
  expect(calls).toHaveLength(2)
  expect(calls[1]).toMatchObject({ path: '/api/v1/plant-assistant/guide/ask', body: { speciesId: 'mikania-micrantha', history: [] } })
  expect(calls[1].body).not.toHaveProperty('classifierConfidence')
  expect(calls[1].body).not.toHaveProperty('previousAnswer')

  // Reopening the Guide modal clears it again.
  await closeAssistant(page)
  await page.getByRole('button', { name: /^Ask Plant Assistant/ }).click()
  await expect(turns(page)).toHaveCount(0)
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue('')
  await ask(page, question)
  expect(calls).toHaveLength(3)
  expect(calls[2].body.history).toEqual([])
  await closeAssistant(page)

  // Another guide species: the new species, and only it.
  await navigateInApp(page, '/catalogue/mimosa-pigra')
  await page.getByRole('button', { name: /^Ask Plant Assistant/ }).click()
  await expect(guideDialog.locator('.plant-assistant__species-name')).toHaveText('Mimosa pigra')
  await expect(turns(page)).toHaveCount(0)
  await ask(page, question)
  expect(calls[3].body).toMatchObject({ speciesId: 'mimosa-pigra', history: [] })
  await closeAssistant(page)

  // Guide -> Map record.
  await navigateInApp(page, '/map?sighting=s-01')
  const mapDialog = await askFromSightingSheet(page)
  await expect(mapDialog.locator('.plant-assistant__species-name')).toHaveText('Mikania micrantha')
  await expect(turns(page)).toHaveCount(0)
  await ask(page, question)
  expect(calls[4]).toMatchObject({ path: '/api/v1/plant-assistant/map/ask', body: { sightingId: 's-01', history: [] } })
  expect(calls[4].body).not.toHaveProperty('speciesId')
  await closeAssistant(page)

  // Reopening the Map modal on the same record clears it.
  await askFromSightingSheet(page)
  await expect(turns(page)).toHaveCount(0)
  await closeAssistant(page)

  // A different record with a different species.
  await page.locator('.map-pin[data-sighting-id="s-04"]').dispatchEvent('click')
  await expect(page.getByRole('dialog', { name: 'Sighting details', exact: true })).toContainText('Chromolaena odorata')
  await askFromSightingSheet(page)
  await expect(mapDialog.locator('.plant-assistant__species-name')).toHaveText('Chromolaena odorata')
  await expect(turns(page)).toHaveCount(0)
  await expect(page.locator('.plant-assistant__repeat')).toHaveCount(0)
  await ask(page, question)
  expect(calls[5].body).toMatchObject({ sightingId: 's-04', history: [] })
  // New replies keep their own provenance and the boundary.
  await expect(latestTurn(page).getByRole('region', { name: 'From reviewed sources', exact: true }).getByRole('link')).toHaveText([HABITAT_SOURCE.sourceName])
  await expect(latestTurn(page).locator('[data-section-kind="ai"] a')).toHaveCount(0)
  await expect(latestTurn(page).locator('.plant-assistant__safety')).toHaveText(SAFETY_BOUNDARY)
  await closeAssistant(page)

  // Back on the scan: its genuine result is still there with one panel,
  // closed and empty, and a new question uses the original classifier output.
  await navigateInApp(page, '/scan/result')
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Plant assistant', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  await expect(scanPanel(page).locator('.plant-assistant__context')).toHaveText('Scan result')
  await expect(turns(page)).toHaveCount(0)
  await ask(page, question)
  expect(calls).toHaveLength(7)
  expect(calls[6]).toMatchObject({
    path: '/api/v1/plant-assistant/ask',
    body: { speciesId: 'mikania-micrantha', classifierOutcome: 'target', classifierConfidence: calls[0].body.classifierConfidence, history: [] },
  })
  expect(calls[6].body).not.toHaveProperty('sightingId')
})

test('AC 8.5.5 Preserve page functions and accessible layouts', async ({ page, context }) => {
  await recordAssistant(context, () => grounded())
  await startPrivateAccess(page)

  // Guide, desktop, keyboard only.
  await page.goto('/catalogue/mikania-micrantha')
  const trigger = page.getByRole('button', { name: /^Ask Plant Assistant/ })
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.focus()
  await page.keyboard.press('Enter')
  const guideDialog = page.getByRole('dialog', { name: 'Guide Plant Assistant', exact: true })
  await expect(guideDialog).toBeVisible()
  // Focus moves into the dialog and Tab keeps it there.
  await expect.poll(() => holdsFocus(guideDialog)).toBe(true)
  for (let step = 0; step < 14; step += 1) {
    await page.keyboard.press('Tab')
    expect(await holdsFocus(guideDialog)).toBe(true)
  }
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(1)
  // Escape closes it and focus returns to the control that opened it.
  await page.keyboard.press('Escape')
  await expect(guideDialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('heading', { name: 'Typical habitat' })).toBeVisible()
  await expect(page.getByRole('link', { name: /catalogue/i }).first()).toBeVisible()

  // Guide, phone: the trigger is readable, the modal fits, and it is usable.
  await page.setViewportSize(PHONE)
  await expect(trigger).toBeVisible()
  expect(await trigger.locator('.guide-assistant-entry__title').evaluate(label => label.scrollWidth <= label.clientWidth + 1)).toBe(true)
  await expect(trigger.locator('.guide-assistant-entry__title')).toHaveText('Ask Plant Assistant')
  const triggerBox = (await trigger.boundingBox())!
  expect(triggerBox.x).toBeGreaterThanOrEqual(0)
  expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(PHONE.width)
  expect(triggerBox.height).toBeGreaterThanOrEqual(44)
  await trigger.click()
  await expect(guideDialog).toBeVisible()
  expect(await noHorizontalOverflow(page)).toBe(true)
  const guideBox = (await guideDialog.boundingBox())!
  expect(guideBox.x).toBeGreaterThanOrEqual(0)
  expect(guideBox.x + guideBox.width).toBeLessThanOrEqual(PHONE.width)
  await expect(page.getByRole('button', { name: 'Close plant assistant', exact: true })).toBeInViewport()
  await expect(page.getByLabel('Your question', { exact: true })).toBeInViewport()
  await ask(page, 'Where does it grow?')
  await expect(latestTurn(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toBeVisible()
  expect(await noHorizontalOverflow(page)).toBe(true)
  await closeAssistant(page)
  await expect(guideDialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  // Map, phone: opened from the record sheet, one modal at a time.
  await page.goto('/map?sighting=s-01')
  const sheet = page.getByRole('dialog', { name: 'Sighting details', exact: true })
  await expect(sheet.getByText('Approximate location for privacy')).toBeVisible()
  const mapDialog = await askFromSightingSheet(page)
  await expect(mapDialog).toBeVisible()
  await expect(page.locator('[aria-modal="true"]')).toHaveCount(1)
  await expect.poll(() => holdsFocus(mapDialog)).toBe(true)
  expect(await noHorizontalOverflow(page)).toBe(true)
  const mapBox = (await mapDialog.boundingBox())!
  expect(mapBox.x).toBeGreaterThanOrEqual(0)
  expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(PHONE.width)
  await expect(page.getByRole('button', { name: 'Close plant assistant', exact: true })).toBeInViewport()
  await ask(page, 'Where does it grow?')
  expect(await noHorizontalOverflow(page)).toBe(true)

  // Map, desktop: closing puts focus back on a real control and the record,
  // its location-privacy note, the filters and the map itself all still work.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.keyboard.press('Escape')
  await expect(mapDialog).toHaveCount(0)
  await expect(sheet.getByText('Approximate location for privacy')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Ask Plant Assistant', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(page.locator('.map-pin').first()).toBeVisible()
  await page.getByRole('button', { name: /Open reports list/ }).click()
  const reports = page.getByRole('dialog', { name: 'Community reports list' })
  const total = await reports.locator('.map-reports-sheet__item').count()
  await reports.getByLabel('Plant').selectOption({ label: 'Mile-a-minute weed' })
  await expect.poll(() => reports.locator('.map-reports-sheet__item').count()).toBeLessThan(total)
  for (const name of await reports.locator('.map-reports-sheet__item-name').allInnerTexts()) expect(name).toMatch(/Mikania micrantha/)
  await reports.getByRole('button', { name: 'Clear filters' }).click()
  await expect.poll(() => reports.locator('.map-reports-sheet__item').count()).toBe(total)
  await page.getByRole('button', { name: 'Close community reports list' }).click()
  await page.getByRole('button', { name: 'Hide mapped places' }).click()
  await expect(page.getByRole('button', { name: 'Show mapped places' })).toBeVisible()
})
