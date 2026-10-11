// Epic 8 — conversational plant assistant, opened from a scan result.
//
// This is the mock/UI-contract layer. Every assistant endpoint is stubbed with
// a canned response in the real AskResponse shape (e2e/fixtures/assistant.ts),
// so these tests prove two things only: what the panel sends, and how it
// renders each kind of reply. Whether the backend picks the right reply
// (retrieval, grounding, safety routing, provider failover) is proven by the
// real-stack spec, not here. AC 8.4.7 is independent human botanical review
// and has no automated test.
import { expect, test, type Page } from '@playwright/test'
import { pinModelSpecies, scanPhoto, startPrivateAccess } from '../fixtures/app'
import {
  AI_WARNING, HABITAT_SOURCE, HABITAT_TEXT, HAZARD_SOURCE, HAZARD_TEXT, PRIVATE_DETAILS_TEXT,
  PROVIDER_FAILURE_TEXT, REDIRECT, RHIZOME_TEXT, SAFE_RESPONSE_SOURCE, SAFE_RESPONSE_TEXT,
  SAFETY_BOUNDARY, UNSUPPORTED_SCAN_TEXT,
  aiOnly, answered, ask, conversation, grounded, latestTurn, limitation, mixed, openGuideAssistant,
  providerFailure, recordAssistant, scanPanel, section,
} from '../fixtures/assistant'

const SUGGESTIONS = [
  'What does this plant look like?', 'Where does it grow?', 'What are its impacts?',
  'How does it spread?', 'How should I respond safely?',
]
const SCAN_KEYS = ['allowGeneralKnowledge', 'classifierConfidence', 'classifierOutcome', 'depth', 'history', 'question', 'sectionAware', 'speciesId']

/** Private access, one pinned scan, then the result page with the panel open. */
async function scanAndOpen(page: Page) {
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  await expect(scanPanel(page).getByRole('heading', { name: 'Plant Assistant', exact: true })).toBeFocused()
}

/** A scan the classifier cannot stand behind. Every class the development
 *  model knows is a supported invasive, so the only honest way to an uncertain
 *  result is the one production uses: the top prediction (0.84 for this class)
 *  falls below the server's acceptance threshold. The mock service worker
 *  answers model-config before any route can see it, so fetch is wrapped. */
async function uncertainScanAndOpen(page: Page) {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (new URL(raw, window.location.origin).pathname !== '/api/v1/model-config') return real(input, init)
      return new Response(JSON.stringify({
        modelVersion: 'invatrace-student33-tinyvit5m-320-fp16', supportedVersions: [], acceptanceThreshold: 0.85,
        thresholdVersion: 'invatrace-student33-tinyvit5m-320-fp16@0.8500',
        configVersion: 'invatrace-student33-tinyvit5m-320-fp16@0.8500',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  await expect(page.getByText('Uncertain result. Take another photo.')).toBeVisible()
  await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  await expect(scanPanel(page).getByRole('heading', { name: 'Plant Assistant', exact: true })).toBeFocused()
}

/** The result page's own text with the assistant taken out, so a comparison
 *  before and after a conversation is about the scan result alone. */
function resultTextWithoutAssistant(page: Page) {
  return page.locator('main').evaluate((main) => {
    const copy = main.cloneNode(true) as HTMLElement
    copy.querySelector('.plant-assistant')?.remove()
    return copy.textContent
  })
}

const groundedSection = (page: Page) => latestTurn(page).getByRole('region', { name: 'From reviewed sources', exact: true })
const aiSection = (page: Page) => latestTurn(page).locator('[data-section-kind="ai"]')
const levels = (page: Page) => latestTurn(page).getByRole('group', { name: 'Explanation level', exact: true })

test('AC 8.1.1 Open the assistant from a scan result', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => grounded())
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  // The scan record the app saves is the Epic 1 output the assistant must reuse.
  const saved = page.waitForRequest(request => request.method() === 'POST' && (request.postData() ?? '').includes('"captureId"'))
  await scanPhoto(page)
  const scan = (await saved).postDataJSON() as { predictedSpeciesId: string; outcome: string; confidence: number }
  expect(scan.predictedSpeciesId).toBe('mikania-micrantha')
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()

  // Opening is local: no second identification, no model download, no question.
  const afterResult: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' || /\/models\/|\.onnx/.test(request.url())) afterResult.push(request.url())
  })
  await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  const panel = scanPanel(page)
  await expect(panel.getByRole('heading', { name: 'Plant Assistant', exact: true })).toBeFocused()
  await expect(panel.locator('.plant-assistant__species-name')).toHaveText('Mikania micrantha')
  await expect(panel.locator('.plant-assistant__context')).toHaveText('Scan result')
  await expect(panel.getByLabel('Your question', { exact: true })).toBeEditable()
  expect(afterResult).toEqual([])
  expect(calls).toHaveLength(0)

  // The first question carries that scan's species, outcome and confidence.
  await ask(page, 'Where does it grow?')
  expect(calls).toHaveLength(1)
  expect(calls[0].path).toBe('/api/v1/plant-assistant/ask')
  expect(calls[0].body).toMatchObject({
    speciesId: scan.predictedSpeciesId, classifierOutcome: scan.outcome, classifierConfidence: scan.confidence,
  })
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()
})

test('AC 8.1.2 Explain the scan result', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => grounded())
  await scanAndOpen(page)
  await ask(page, 'What does this scan result mean?')

  expect(calls[0].body).toMatchObject({ question: 'What does this scan result mean?', speciesId: 'mikania-micrantha', depth: 'standard' })
  const turn = latestTurn(page)
  await expect(turn).toHaveAttribute('data-mode', 'grounded')
  await expect(turn.getByRole('heading', { name: 'Answer', exact: true })).toBeVisible()
  await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText(HABITAT_TEXT)
  // The citation is the stored record: its name as the link text, its URL as the target.
  const link = groundedSection(page).getByRole('region', { name: 'Sources', exact: true }).getByRole('link', { name: HABITAT_SOURCE.sourceName })
  await expect(link).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(turn.locator('a')).toHaveCount(1)
})

test('AC 8.1.3 Change the explanation level', async ({ page, context }) => {
  const mixedNotice = 'Reviewed content uses Detailed; additional AI-generated information uses Standard.'
  const calls = await recordAssistant(context, ({ body }) => {
    if (body.question.includes('rhizome')) {
      return body.depth === 'detailed'
        ? mixed('detailed', 'standard', { mixedDepthNotice: mixedNotice })
        : mixed(body.depth)
    }
    return grounded(`${HABITAT_TEXT} (${body.depth})`, body.depth)
  })
  await scanAndOpen(page)
  await ask(page, 'Where does it grow?')

  // A grounded answer offers all three levels, starting at Standard.
  await expect(levels(page).getByRole('button')).toHaveText(['Simpler', 'Standard', 'More detail'])
  await expect(levels(page).getByRole('button', { name: 'Standard explanation' })).toHaveAttribute('aria-pressed', 'true')

  // Choosing a level re-asks the same question at that depth and replaces the
  // answer in place; it is not a new question in the conversation.
  await levels(page).getByRole('button', { name: 'More detail', exact: true }).click()
  await expect(latestTurn(page)).toHaveAttribute('data-depth', 'detailed')
  expect(calls[1].body).toMatchObject({ question: 'Where does it grow?', depth: 'detailed', previousAnswer: `${HABITAT_TEXT} (standard)` })
  await expect(page.locator('.plant-assistant__turn')).toHaveCount(1)
  await expect(levels(page).getByRole('button', { name: 'More detail', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(groundedSection(page)).toHaveAttribute('data-section-depth', 'detailed')
  await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText(`${HABITAT_TEXT} (detailed)`)
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)

  await levels(page).getByRole('button', { name: 'Simpler explanation' }).click()
  await expect(latestTurn(page)).toHaveAttribute('data-depth', 'simpler')
  expect(calls[2].body).toMatchObject({ question: 'Where does it grow?', depth: 'simpler' })
  await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText(`${HABITAT_TEXT} (simpler)`)

  // Mixed Detailed: the reviewed part is Detailed, the AI part stays Standard,
  // and the difference is stated rather than hidden behind one pressed button.
  await ask(page, 'Where does it grow and what is a rhizome?')
  await levels(page).getByRole('button', { name: 'More detail', exact: true }).click()
  await expect(latestTurn(page)).toHaveAttribute('data-depth', 'detailed')
  await expect(groundedSection(page)).toHaveAttribute('data-section-depth', 'detailed')
  await expect(aiSection(page)).toHaveAttribute('data-section-depth', 'standard')
  await expect(latestTurn(page).getByText(mixedNotice, { exact: true })).toBeVisible()
})

test('AC 8.1.4 Preserve the scan result', async ({ page, context }) => {
  const calls = await recordAssistant(context, ({ body }) => body.question.includes('rhizome') ? aiOnly() : grounded())
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && (response.request().postData() ?? '').includes('"captureId"'))
  await scanPhoto(page)
  await saved
  await expect(page.getByText(/^present in malaysia$/i).first()).toBeVisible()
  const before = await resultTextWithoutAssistant(page)

  await page.getByRole('button', { name: 'Ask about this plant', exact: true }).click()
  await ask(page, 'Where does it grow?')
  await ask(page, 'What is a rhizome?')

  // The AI-only reply is presented as general information, with no citation
  // and nothing that reads as a scan finding or a new identification.
  const turn = latestTurn(page)
  await expect(turn).toHaveAttribute('data-mode', 'general')
  await expect(turn.getByRole('heading', { name: 'General botanical information', exact: true })).toBeVisible()
  await expect(turn.locator('a')).toHaveCount(0)
  await expect(turn).not.toContainText(/scan[- ]verified|identified as|officially confirmed/i)

  // While it is on screen the scan result still says what it said.
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()
  await expect(page.getByText('Possible invasive', { exact: true })).toBeVisible()
  await expect(page.getByText(/^present in malaysia$/i).first()).toBeVisible()
  await expect(scanPanel(page).locator('.plant-assistant__species-name')).toHaveText('Mikania micrantha')

  // Every question used the one original classifier result.
  expect(calls).toHaveLength(2)
  for (const call of calls) {
    expect(call.body).toMatchObject({
      speciesId: 'mikania-micrantha', classifierOutcome: 'target', classifierConfidence: calls[0].body.classifierConfidence,
    })
  }

  // And once the conversation is closed, the page is word for word unchanged.
  await page.getByRole('button', { name: 'Close plant assistant', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ask about this plant', exact: true })).toBeFocused()
  expect(await resultTextWithoutAssistant(page)).toBe(before)
})

test('AC 8.1.5 Provide a fallback when generation is unavailable', async ({ page, context }) => {
  // What the API returns when neither provider completes but reviewed evidence was retrieved.
  await recordAssistant(context, ({ body }) => body.question.includes('grow') ? providerFailure() : providerFailure('standard', []))
  await scanAndOpen(page)
  await ask(page, 'Where does it grow?')

  // The reviewed source text is shown with its stored citation, not an error.
  const turn = latestTurn(page)
  await expect(scanPanel(page).getByRole('alert')).toHaveCount(0)
  await expect(turn.getByRole('region', { name: 'AI explanation unavailable', exact: true })).toContainText(PROVIDER_FAILURE_TEXT)
  const excerpts = turn.getByRole('region', { name: 'Related source excerpts', exact: true })
  await expect(excerpts.locator('.plant-assistant__answer')).toHaveText(HABITAT_TEXT)
  await expect(excerpts.getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  // Nothing generated is passed off alongside it.
  await expect(turn.locator('[data-section-kind="ai"]')).toHaveCount(0)
  await expect(turn.locator('.plant-assistant__safety')).toHaveText(SAFETY_BOUNDARY)

  // With no support-approved evidence either, the reply is an honest
  // limitation: no excerpt, no link, no answer.
  await ask(page, 'What is its chromosome count?')
  await expect(latestTurn(page).getByRole('region', { name: 'AI explanation unavailable', exact: true })).toContainText(PROVIDER_FAILURE_TEXT)
  await expect(latestTurn(page).locator('[data-section-kind="grounded"]')).toHaveCount(0)
  await expect(latestTurn(page).locator('a')).toHaveCount(0)
})

test('AC 8.1.6 Clarify a repeated question', async ({ page, context }) => {
  const calls = await recordAssistant(context, ({ body }) => body.question.toLowerCase().includes('near me')
    ? limitation('insufficient_evidence', 'The assistant cannot confirm nearby plants.', { intent: 'restricted' })
    : grounded(`${HABITAT_TEXT} (${body.depth})`, body.depth))
  await scanAndOpen(page)
  await ask(page, 'Where does it grow?')
  expect(calls).toHaveLength(1)

  // Same question, different case and padding: recognised without a request.
  await page.getByLabel('Your question', { exact: true }).fill('   WHERE does it GROW?  ')
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  const repeat = scanPanel(page).locator('.plant-assistant__repeat')
  await expect(repeat).toContainText('I explained this question earlier in this conversation.')
  await expect(repeat.getByRole('button')).toHaveText(['Simpler', 'More detail'])
  expect(calls).toHaveLength(1)
  await expect(page.locator('.plant-assistant__turn')).toHaveCount(1)

  // Taking an offered depth re-asks with that depth and keeps context and citation.
  await repeat.getByRole('button', { name: 'More detail', exact: true }).click()
  await expect(latestTurn(page)).toHaveAttribute('data-depth', 'detailed')
  expect(calls).toHaveLength(2)
  expect(calls[1].body).toMatchObject({
    question: 'WHERE does it GROW?', depth: 'detailed', speciesId: 'mikania-micrantha',
    classifierConfidence: calls[0].body.classifierConfidence,
  })
  await expect(repeat).toHaveCount(0)
  await expect(page.locator('.plant-assistant__turn')).toHaveCount(1)
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(latestTurn(page).locator('.plant-assistant__safety')).toHaveText(SAFETY_BOUNDARY)

  // A refused question was never answered, so asking it again is a real request.
  await ask(page, 'Is it near me?')
  expect(calls).toHaveLength(3)
  await page.getByLabel('Your question', { exact: true }).fill('is it near me?')
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  await expect.poll(() => calls.length).toBe(4)
  await expect(repeat).toHaveCount(0)
})

test('AC 8.1.6 A redirected off-topic question is not treated as already answered', async ({ page, context }) => {
  // The redirect is the literal shape assistant_conversation.response() builds for route=off_topic.
  const calls = await recordAssistant(context, () => conversation(REDIRECT, 'off_topic'))
  await scanAndOpen(page)
  await ask(page, 'Who won the football last night?')
  await expect(levels(page)).toHaveCount(0)
  await page.getByLabel('Your question', { exact: true }).fill('who won the football last night?')
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  await expect.poll(() => calls.length).toBe(2)
  await expect(scanPanel(page).locator('.plant-assistant__repeat')).toHaveCount(0)
})

test('AC 8.2.1 Ask a suggested question', async ({ page, context }) => {
  const calls = await recordAssistant(context, ({ body }) => grounded(`Stubbed reply to: ${body.question}`))
  await scanAndOpen(page)
  const suggestions = scanPanel(page).getByRole('group', { name: 'Suggested plant questions', exact: true })
  await expect(suggestions.getByRole('button')).toHaveText(SUGGESTIONS)

  // Selecting one submits it straight away.
  await suggestions.getByRole('button', { name: 'How does it spread?', exact: true }).click()
  await expect(latestTurn(page).locator('.plant-assistant__asked')).toHaveText('How does it spread?')
  // What is shown is what the API returned for it, not text stored with the button.
  await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText('Stubbed reply to: How does it spread?')

  // It goes through the same endpoint with the same envelope as typed text.
  await ask(page, 'How fast does it climb?')
  expect(calls.map(call => call.path)).toEqual(['/api/v1/plant-assistant/ask', '/api/v1/plant-assistant/ask'])
  expect(Object.keys(calls[0].body).sort()).toEqual(SCAN_KEYS)
  expect(Object.keys(calls[1].body).sort()).toEqual(SCAN_KEYS)
  expect(calls[0].body).toMatchObject({ question: 'How does it spread?', speciesId: 'mikania-micrantha', depth: 'standard' })
})

test('AC 8.2.2 Ask a question in the user’s own words', async ({ page, context }) => {
  const clarify = 'Could you clarify what you would like to discuss about plants?'
  const calls = await recordAssistant(context, ({ body }) => body.question === 'that thing?'
    ? conversation(clarify, 'ambiguous') : grounded())
  await scanAndOpen(page)

  // Nothing but an empty box stops a question: there is no phrase list client-side.
  const input = page.getByLabel('Your question', { exact: true })
  const send = page.getByRole('button', { name: 'Ask question', exact: true })
  await expect(send).toBeDisabled()
  const question = 'my nan says these creepers love soggy ground by the river - true?'
  await input.fill(`  ${question}\n`)
  await expect(send).toBeEnabled()
  await send.click()
  await expect(latestTurn(page).locator('.plant-assistant__asked')).toHaveText(question)
  // The wording reaches the API as typed, with the trusted species context.
  expect(calls[0].body).toMatchObject({ question, speciesId: 'mikania-micrantha', classifierOutcome: 'target' })
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toBeVisible()

  // An ambiguous question is shown as a clarification, not as a cited answer.
  await ask(page, 'that thing?')
  await expect(levels(page)).toHaveCount(0)
  await expect(latestTurn(page).getByRole('heading', { name: 'Plant conversation', level: 3 })).toBeVisible()
  await expect(latestTurn(page).locator('.plant-assistant__answer')).toHaveText(clarify)
  await expect(latestTurn(page).locator('a')).toHaveCount(0)
  await expect(latestTurn(page).locator('[data-section-kind="ai"]')).toHaveCount(0)
})

test('AC 8.2.3 Answer a supported question', async ({ page, context }) => {
  const gap = 'The reviewed sources do not say how long its seeds stay viable.'
  await recordAssistant(context, ({ body }) => body.question.includes('seeds')
    ? answered([section('grounded', HABITAT_TEXT, 'standard', [HABITAT_SOURCE]), section('unavailable', gap)])
    // safe_response is backed by two stored sources and the habitat record repeats one of them.
    : answered([section('grounded', `${SAFE_RESPONSE_TEXT}\n\n${HABITAT_TEXT}`, 'standard', [SAFE_RESPONSE_SOURCE, HABITAT_SOURCE, HABITAT_SOURCE])]))
  await scanAndOpen(page)
  await ask(page, 'How should I respond safely, and where does it grow?')

  // Fully supported: every stored source is cited once, by name and URL.
  const links = groundedSection(page).getByRole('region', { name: 'Sources', exact: true }).getByRole('link')
  await expect(links).toHaveText([SAFE_RESPONSE_SOURCE.sourceName, HABITAT_SOURCE.sourceName])
  await expect(links.nth(0)).toHaveAttribute('href', SAFE_RESPONSE_SOURCE.sourceUrl)
  await expect(links.nth(1)).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)

  // Partly supported: the supported part keeps its citation, and the rest is a
  // separate uncited statement rather than text folded into the cited answer.
  await ask(page, 'Where does it grow and how long do its seeds stay viable?')
  await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText(HABITAT_TEXT)
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  const unsupported = latestTurn(page).getByRole('region', { name: 'Information unavailable', exact: true })
  await expect(unsupported).toContainText(gap)
  await expect(unsupported.locator('a')).toHaveCount(0)
  await expect(groundedSection(page)).not.toContainText(gap)
})

test('AC 8.2.4 Maintain evidence provenance in answers', async ({ page, context }) => {
  await recordAssistant(context, () => answered([
    section('grounded', HABITAT_TEXT, 'standard', [HABITAT_SOURCE]),
    section('ai', RHIZOME_TEXT),
    section('grounded', SAFE_RESPONSE_TEXT, 'standard', [SAFE_RESPONSE_SOURCE]),
  ]))
  await scanAndOpen(page)
  await ask(page, 'Where does it grow, what is a rhizome, and what should I do?')

  // Each reviewed section shows the evidence for its own claim and no other.
  const reviewed = latestTurn(page).locator('[data-section-kind="grounded"]')
  await expect(reviewed).toHaveCount(2)
  await expect(reviewed.nth(0)).toContainText(HABITAT_TEXT)
  await expect(reviewed.nth(0).getByRole('link')).toHaveText([HABITAT_SOURCE.sourceName])
  await expect(reviewed.nth(0).getByRole('link')).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(reviewed.nth(1)).toContainText(SAFE_RESPONSE_TEXT)
  await expect(reviewed.nth(1).getByRole('link')).toHaveText([SAFE_RESPONSE_SOURCE.sourceName])
  await expect(reviewed.nth(1).getByRole('link')).toHaveAttribute('href', SAFE_RESPONSE_SOURCE.sourceUrl)

  // The AI claim sits in its own labelled section with no citation of any kind.
  await expect(aiSection(page)).toHaveCount(1)
  await expect(aiSection(page).locator('.plant-assistant__answer')).toHaveText(RHIZOME_TEXT)
  await expect(aiSection(page).getByRole('heading', { name: 'Additional AI-generated information', exact: true })).toBeVisible()
  await expect(aiSection(page).locator('a')).toHaveCount(0)
  await expect(aiSection(page).getByRole('region', { name: 'Sources' })).toHaveCount(0)
  // No turn-level source list exists for the AI text to borrow from.
  await expect(latestTurn(page).locator('a')).toHaveCount(2)
  // The stored metadata carries no official-publisher flag, so none is claimed.
  await expect(latestTurn(page)).not.toContainText(/official source/i)
  await expect(reviewed.first().getByRole('heading', { name: 'From reviewed sources', exact: true })).toBeVisible()
})

test('AC 8.2.5 Respect safety and removal-permission boundaries', async ({ page, context }) => {
  await recordAssistant(context, ({ body }) => {
    if (body.question.includes('pull')) return grounded(SAFE_RESPONSE_TEXT, 'standard', [SAFE_RESPONSE_SOURCE])
    if (body.question.includes('rhizome')) return aiOnly()
    if (body.question === 'hello') return conversation('Hello! What would you like to know about this plant?', 'greeting')
    return limitation('insufficient_evidence', 'The assistant cannot say whether removal is permitted at a site.', { intent: 'restricted' })
  })
  await scanAndOpen(page)
  await ask(page, 'Can I pull it out myself?')

  // Reviewed guidance is rendered exactly as returned, with its stored source.
  await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText(SAFE_RESPONSE_TEXT)
  await expect(groundedSection(page).getByRole('link', { name: SAFE_RESPONSE_SOURCE.sourceName })).toHaveAttribute('href', SAFE_RESPONSE_SOURCE.sourceUrl)
  const boundary = latestTurn(page).locator('.plant-assistant__safety')
  await expect(boundary).toHaveText(SAFETY_BOUNDARY)
  await expect(boundary).toContainText('This assistant does not grant permission to touch, collect, transport or remove a plant, or to enter restricted areas')

  // The boundary accompanies every kind of reply, not only safety answers.
  for (const question of ['What is a rhizome?', 'hello', 'Am I allowed to remove it here?']) {
    await ask(page, question)
    await expect(latestTurn(page).locator('.plant-assistant__safety')).toHaveText(SAFETY_BOUNDARY)
  }
  await expect(page.locator('.plant-assistant__turn .plant-assistant__safety')).toHaveCount(4)

  // The assistant adds no way to act, and the Epic 3 permission gate is still in charge.
  await expect(scanPanel(page).getByRole('button', { name: /remov|permission/i })).toHaveCount(0)
  await expect(page.getByText('Do you have permission at this site?', { exact: true })).toBeVisible()
  await expect(page.getByText('Check before acting', { exact: true })).toBeVisible()
})

test('AC 8.2.6 Report documented hazards without implying safety', async ({ page, context }) => {
  const undocumented = 'The reviewed sources do not document this hazard for Mikania micrantha. This does not establish that the plant is safe to touch, eat or handle.'
  const calls = await recordAssistant(context, ({ body }) => body.speciesId === 'asclepias-curassavica'
    ? grounded(HAZARD_TEXT, 'standard', [HAZARD_SOURCE])
    : limitation('insufficient_evidence', undocumented))
  await startPrivateAccess(page)

  // A species with a reviewed hazard record: the text is quoted unchanged,
  // with its stored source and the safety boundary.
  await openGuideAssistant(page, 'asclepias-curassavica')
  await ask(page, 'Is it harmful to touch?')
  expect(calls[0].body).toMatchObject({ question: 'Is it harmful to touch?', speciesId: 'asclepias-curassavica' })
  await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText(HAZARD_TEXT)
  await expect(groundedSection(page).getByRole('link', { name: HAZARD_SOURCE.sourceName })).toHaveAttribute('href', HAZARD_SOURCE.sourceUrl)
  await expect(latestTurn(page).locator('.plant-assistant__safety')).toHaveText(SAFETY_BOUNDARY)

  // A species with none: the absence is stated as an evidence limitation with
  // the boundary, and the panel adds no reassurance of its own.
  await openGuideAssistant(page, 'mikania-micrantha')
  await ask(page, 'Is it harmful to touch?')
  const turn = latestTurn(page)
  await expect(turn).toHaveAttribute('data-mode', 'limitation')
  await expect(turn.locator('.plant-assistant__answer')).toHaveText(undocumented)
  await expect(turn.locator('.plant-assistant__safety')).toHaveText(SAFETY_BOUNDARY)
  await expect(turn.locator('a')).toHaveCount(0)
  await expect(turn.locator('[data-section-kind="ai"]')).toHaveCount(0)
  const withoutQuoted = (await turn.innerText()).replace(undocumented, '')
  expect(withoutQuoted).not.toMatch(/\b(safe to|harmless|non-toxic|not harmful)\b/i)
})

test('AC 8.3.1 Search for an unanticipated question', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => grounded())
  await scanAndOpen(page)
  const question = 'Do goats eat it? Also, would it survive a dry season, and does it climb fences?'
  expect(SUGGESTIONS).not.toContain(question)
  await ask(page, question)

  // The whole message goes to the API in one request: nothing is split,
  // trimmed down to a known prompt, or rejected for not being on the list.
  expect(calls).toHaveLength(1)
  expect(calls[0].body.question).toBe(question)
  expect(calls[0].body).toMatchObject({ speciesId: 'mikania-micrantha', depth: 'standard' })
  await expect(scanPanel(page).getByRole('alert')).toHaveCount(0)
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toBeVisible()
  // The limit on a message is the API's 600 characters, not a phrase list.
  await expect(page.getByLabel('Your question', { exact: true })).toHaveAttribute('maxlength', '600')
  // Suggestions stay available as shortcuts once a conversation has started.
  await scanPanel(page).getByText('Suggested questions', { exact: true }).click()
  await expect(scanPanel(page).getByRole('group', { name: 'Suggested plant questions' }).getByRole('button')).toHaveText(SUGGESTIONS)
})

test('AC 8.3.2 Answer when evidence supports it', async ({ page, context }) => {
  await recordAssistant(context, ({ body }) => body.question.includes('rhizome') ? mixed() : grounded())
  await scanAndOpen(page)

  for (const question of ['Where does it grow?', 'Where does it grow and what is a rhizome?']) {
    await ask(page, question)
    // Fully grounded or mixed, the supported fact is a cited reviewed claim.
    await expect(latestTurn(page)).toHaveAttribute('data-mode', 'grounded')
    await expect(latestTurn(page).getByRole('heading', { name: 'Answer', exact: true })).toBeVisible()
    await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText(HABITAT_TEXT)
    await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
    // Model knowledge never appears inside the reviewed section.
    await expect(groundedSection(page)).not.toContainText(RHIZOME_TEXT)
  }
  await expect(aiSection(page).locator('.plant-assistant__answer')).toHaveText(RHIZOME_TEXT)
})

test('AC 8.3.3 Handle valid full and partial evidence gaps', async ({ page, context }) => {
  const gap = 'The reviewed sources do not cover its chromosome count.'
  const calls = await recordAssistant(context, ({ body }) => {
    if (body.question.includes('rhizome')) return aiOnly()
    if (body.question.includes('chromosome')) return answered([section('grounded', HABITAT_TEXT, 'standard', [HABITAT_SOURCE]), section('unavailable', gap)])
    return limitation('insufficient_evidence', 'The reviewed evidence does not answer this question.')
  })
  await scanAndOpen(page)

  // Full gap with eligible AI knowledge: shown as unverified, with no borrowed citation.
  await ask(page, 'What is a rhizome?')
  await expect(latestTurn(page)).toHaveAttribute('data-mode', 'general')
  await expect(aiSection(page).locator('.plant-assistant__answer')).toHaveText(RHIZOME_TEXT)
  await expect(latestTurn(page).locator('a')).toHaveCount(0)

  // Partial gap that is not eligible: the supported part stays, cited, and the
  // specific missing part is stated honestly.
  await ask(page, 'Where does it grow and what is its chromosome count?')
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(latestTurn(page).getByRole('region', { name: 'Information unavailable', exact: true })).toContainText(gap)
  await expect(latestTurn(page).locator('[data-section-kind="ai"]')).toHaveCount(0)

  // Full gap with nothing eligible: a limitation, with no answer, level or source.
  await ask(page, 'What is it worth at market?')
  await expect(latestTurn(page)).toHaveAttribute('data-mode', 'limitation')
  await expect(latestTurn(page).getByRole('heading', { name: 'Evidence is insufficient', exact: true })).toBeVisible()
  await expect(levels(page)).toHaveCount(0)
  await expect(latestTurn(page).locator('a')).toHaveCount(0)

  // Expanded mode is an explicit opt-in on every request this client makes.
  expect(calls).toHaveLength(3)
  for (const call of calls) expect(call.body).toMatchObject({ allowGeneralKnowledge: true, sectionAware: true })
})

test('AC 8.3.4 State a limitation when the scan result is insufficient', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => limitation('unsupported_scan', UNSUPPORTED_SCAN_TEXT))

  // Below the acceptance threshold: the panel states the limitation and
  // offers no way to ask, so no species is guessed and nothing is sent.
  await uncertainScanAndOpen(page)
  const panel = scanPanel(page)
  await expect(panel.getByRole('status')).toContainText('species-specific assistant guidance is unavailable')
  await expect(panel.locator('.plant-assistant__species-name')).toHaveCount(0)
  await expect(panel.getByLabel('Your question', { exact: true })).toHaveCount(0)
  await expect(panel.getByRole('group', { name: 'Suggested plant questions' })).toHaveCount(0)
  expect(calls).toHaveLength(0)
})

test('AC 8.3.4 A scan the API refuses is shown as a limitation, not an answer', async ({ page, context }) => {
  // The API applies its own confidence threshold and can refuse a scan the
  // client considered usable; the panel must show that refusal as one.
  await recordAssistant(context, () => limitation('unsupported_scan', UNSUPPORTED_SCAN_TEXT))
  await scanAndOpen(page)
  await ask(page, 'Where does it grow?')
  const turn = latestTurn(page)
  await expect(turn).toHaveAttribute('data-mode', 'limitation')
  await expect(turn.locator('.plant-assistant__answer')).toHaveText(UNSUPPORTED_SCAN_TEXT)
  await expect(turn.getByRole('heading', { name: 'Answer', exact: true })).toHaveCount(0)
  await expect(turn.locator('a')).toHaveCount(0)
  await expect(turn.locator('[data-section-kind]')).toHaveCount(0)
  await expect(levels(page)).toHaveCount(0)
})

test('AC 8.3.5 Validate generated answer sections and citations', async ({ page, context }) => {
  const rejected = 'The additional information did not pass validation.'
  await recordAssistant(context, ({ body }) => body.question.includes('invalid')
    // A reply the API's own validator forbids: citations attached to
    // non-reviewed sections. The panel must not turn them into links.
    ? answered([
      { ...section('ai', RHIZOME_TEXT), sources: [HABITAT_SOURCE] },
      { ...section('conversation', 'Anything else about this plant?'), sources: [SAFE_RESPONSE_SOURCE] },
    ], { sources: [] })
    : answered([section('grounded', HABITAT_TEXT, 'standard', [HABITAT_SOURCE]), section('unavailable', rejected)]))
  await scanAndOpen(page)

  // A section that failed validation is withheld; the valid reviewed section stays with its citation.
  await ask(page, 'Where does it grow and what is a rhizome?')
  await expect(latestTurn(page).locator('[data-section-kind]')).toHaveCount(2)
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(latestTurn(page).getByRole('region', { name: 'Information unavailable', exact: true })).toContainText(rejected)
  await expect(latestTurn(page).locator('[data-section-kind="ai"]')).toHaveCount(0)

  // Citations render for reviewed sections only, whatever a reply carries.
  await ask(page, 'invalid reply')
  await expect(latestTurn(page).locator('[data-section-kind="ai"]')).toHaveCount(1)
  await expect(latestTurn(page).locator('[data-section-kind="conversation"]')).toHaveCount(1)
  await expect(latestTurn(page).locator('a')).toHaveCount(0)
  await expect(latestTurn(page).getByRole('region', { name: /sources/i })).toHaveCount(0)
})

test('AC 8.3.6 Separate evidence-backed and AI-generated portions', async ({ page, context }) => {
  const failed = 'The additional information could not be validated, so it is not shown.'
  await recordAssistant(context, ({ body }) => body.question.includes('fails')
    ? answered([section('grounded', HABITAT_TEXT, 'standard', [HABITAT_SOURCE]), section('unavailable', failed)])
    : mixed())
  await scanAndOpen(page)
  await ask(page, 'Where does it grow and what is a rhizome?')

  // Two sections, in order, each typed by its provenance.
  const sections = latestTurn(page).locator('[data-section-kind]')
  await expect(sections).toHaveCount(2)
  await expect(sections.nth(0)).toHaveAttribute('data-section-kind', 'grounded')
  await expect(sections.nth(1)).toHaveAttribute('data-section-kind', 'ai')

  // "From reviewed sources" with its actual citation.
  await expect(groundedSection(page).getByRole('heading', { name: 'From reviewed sources', exact: true })).toBeVisible()
  await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText(HABITAT_TEXT)
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(groundedSection(page).locator('.plant-assistant__ai-warning')).toHaveCount(0)

  // A separate, named AI section: its inaccuracy warning is on screen without
  // expanding anything, and it has no citation.
  await expect(aiSection(page).locator('.plant-assistant__answer')).toHaveText(RHIZOME_TEXT)
  await expect(aiSection(page).getByRole('heading', { name: 'Additional AI-generated information', exact: true })).toBeVisible()
  await expect(aiSection(page).getByText(AI_WARNING, { exact: true })).toBeVisible()
  await expect(aiSection(page).locator('a')).toHaveCount(0)

  // If the AI part fails, the reviewed part and an honest limitation are shown.
  await ask(page, 'Where does it grow and the AI part fails?')
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(latestTurn(page).getByRole('region', { name: 'Information unavailable', exact: true })).toContainText(failed)
  await expect(aiSection(page)).toHaveCount(0)
})

test('AC 8.3.6 AC 8.4.3 AI sections carry the labels and visible warning the criteria name', async ({ page, context }) => {
  await recordAssistant(context, ({ body }) => body.question.includes('grow') ? mixed() : aiOnly())
  await scanAndOpen(page)
  await ask(page, 'Where does it grow and what is a rhizome?')
  await expect(latestTurn(page).getByText('Additional AI-generated information', { exact: true })).toBeVisible()
  await expect(aiSection(page).getByText(AI_WARNING, { exact: true })).toBeVisible()
  await ask(page, 'What is a rhizome?')
  await expect(latestTurn(page).getByText('AI-generated botanical information', { exact: true })).toBeVisible()
  await expect(aiSection(page).getByText(AI_WARNING, { exact: true })).toBeVisible()
})

test('AC 8.4.2 Keep consequential and restricted claims outside model-only answers', async ({ page, context }) => {
  const refusal = 'I cannot say whether this plant is edible. The reviewed sources do not establish that it is safe to eat.'
  const calls = await recordAssistant(context, ({ body }) => {
    if (/phone/.test(body.question)) return limitation('insufficient_evidence', PRIVATE_DETAILS_TEXT, { intent: 'restricted' })
    if (/eat/.test(body.question)) return limitation('insufficient_evidence', refusal, { intent: 'restricted' })
    return aiOnly()
  })
  await scanAndOpen(page)
  // The composer itself tells people what to leave out.
  await expect(scanPanel(page).locator('#plant-question-hint')).toContainText('Leave out personal details, locations and access codes.')

  // Restricted requests come back as limitations: not AI text, no level
  // control that would re-ask the model, no citation, boundary attached.
  for (const [question, text] of [['Is it safe to eat?', refusal], ['My phone is 012-345 6789, where does it grow?', PRIVATE_DETAILS_TEXT]]) {
    await ask(page, question)
    const turn = latestTurn(page)
    await expect(turn).toHaveAttribute('data-mode', 'limitation')
    await expect(turn.locator('.plant-assistant__answer')).toHaveText(text)
    await expect(turn.locator('[data-section-kind="ai"]')).toHaveCount(0)
    await expect(turn.locator('.plant-assistant__ai-warning')).toHaveCount(0)
    await expect(turn.locator('a')).toHaveCount(0)
    await expect(levels(page)).toHaveCount(0)
    await expect(turn.locator('.plant-assistant__safety')).toHaveText(SAFETY_BOUNDARY)
  }

  // A permitted low-risk concept is the only thing shown as AI knowledge, and
  // it leaves the classifier species and Malaysian status alone.
  await ask(page, 'What is a rhizome?')
  await expect(aiSection(page).locator('.plant-assistant__answer')).toHaveText(RHIZOME_TEXT)
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()
  await expect(page.getByText(/^present in malaysia$/i).first()).toBeVisible()
  expect(new Set(calls.map(call => call.body.speciesId))).toEqual(new Set(['mikania-micrantha']))
})

test('AC 8.4.3 Label AI knowledge without verified citations', async ({ page, context }) => {
  await recordAssistant(context, ({ body }) => body.question.includes('grow') ? mixed() : aiOnly())
  await scanAndOpen(page)
  await ask(page, 'What is a rhizome?')

  // AI-only: labelled as AI-generated, with the full unverified-source
  // warning on screen, not behind a disclosure.
  const turn = latestTurn(page)
  await expect(turn).toHaveAttribute('data-mode', 'general')
  await expect(turn.getByRole('heading', { name: 'General botanical information', exact: true })).toBeVisible()
  await expect(aiSection(page).getByRole('heading', { name: 'AI-generated botanical information', exact: true })).toBeVisible()
  await expect(aiSection(page).locator('.plant-assistant__ai-warning')).toBeVisible()
  await expect(aiSection(page).locator('.plant-assistant__ai-warning')).toHaveText(AI_WARNING)
  await expect(aiSection(page).locator('.plant-assistant__ai-warning')).toContainText("has not been verified against InvaTrace's reviewed sources")
  // No citation, source list, source ID or catalogue link anywhere in the reply.
  await expect(turn.locator('a')).toHaveCount(0)
  await expect(turn.getByRole('region', { name: /sources/i })).toHaveCount(0)
  await expect(turn).not.toContainText(/CAT-|chunk/i)
  // The safety boundary and the trusted species are as they were.
  await expect(turn.locator('.plant-assistant__safety')).toHaveText(SAFETY_BOUNDARY)
  await expect(scanPanel(page).locator('.plant-assistant__species-name')).toHaveText('Mikania micrantha')

  // Mixed: the warning belongs to the AI section; the reviewed one has only its citation.
  await ask(page, 'Where does it grow and what is a rhizome?')
  await expect(latestTurn(page).locator('.plant-assistant__ai-warning')).toHaveCount(1)
  await expect(aiSection(page).locator('.plant-assistant__ai-warning')).toHaveText(AI_WARNING)
  await expect(aiSection(page).getByRole('heading', { name: 'Additional AI-generated information', exact: true })).toBeVisible()
  await expect(aiSection(page).locator('a')).toHaveCount(0)
  await expect(groundedSection(page).getByRole('link')).toHaveText([HABITAT_SOURCE.sourceName])
  await expect(latestTurn(page).locator('a')).toHaveCount(1)
})

test('AC 8.4.4 Preserve truthful depth distinctions', async ({ page, context }) => {
  const mixedNotice = 'Reviewed content uses Detailed; additional AI-generated information uses Standard.'
  const detailed = `${HABITAT_TEXT} It scrambles over whatever supports it.`
  const calls = await recordAssistant(context, ({ body }) => body.depth === 'detailed'
    ? answered([section('grounded', detailed, 'detailed', [HABITAT_SOURCE]), section('ai', RHIZOME_TEXT, 'standard')], { mixedDepthNotice: mixedNotice })
    : mixed(body.depth))
  await scanAndOpen(page)
  await ask(page, 'Where does it grow and what is a rhizome?')
  // At Standard both parts agree, so there is nothing to explain.
  await expect(latestTurn(page).locator('.plant-assistant__notice')).toHaveCount(0)

  await levels(page).getByRole('button', { name: 'More detail', exact: true }).click()
  await expect(latestTurn(page)).toHaveAttribute('data-depth', 'detailed')
  expect(calls[1].body).toMatchObject({ depth: 'detailed', question: 'Where does it grow and what is a rhizome?' })
  // The AI part stayed at Standard, and the reply says so in words.
  await expect(groundedSection(page)).toHaveAttribute('data-section-depth', 'detailed')
  await expect(aiSection(page)).toHaveAttribute('data-section-depth', 'standard')
  await expect(latestTurn(page).locator('.plant-assistant__notice')).toHaveText([mixedNotice])
  await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText(detailed)
  // The AI text was not lengthened to look Detailed.
  await expect(aiSection(page).locator('.plant-assistant__answer')).toHaveText(RHIZOME_TEXT)
  // The reviewed part keeps its citation and the AI part still has none.
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(aiSection(page).locator('a')).toHaveCount(0)
})

test('AC 8.1.3 AC 8.4.4 Direct AI-only Detailed is not offered', async ({ page, context }) => {
  const calls = await recordAssistant(context, ({ body }) => aiOnly(`${RHIZOME_TEXT} (${body.depth})`, body.depth))
  await scanAndOpen(page)
  await ask(page, 'What is a rhizome?')
  await expect(latestTurn(page)).toHaveAttribute('data-mode', 'general')
  await expect(levels(page).getByRole('button')).toHaveText(['Simpler', 'Standard'])
  await expect(levels(page).getByRole('button', { name: 'More detail' })).toHaveCount(0)
  // The effective depth is the pressed level, and Simpler still works.
  await expect(levels(page).getByRole('button', { name: 'Standard explanation' })).toHaveAttribute('aria-pressed', 'true')
  await levels(page).getByRole('button', { name: 'Simpler explanation' }).click()
  await expect(latestTurn(page)).toHaveAttribute('data-depth', 'simpler')
  await expect(aiSection(page)).toHaveAttribute('data-section-depth', 'simpler')
  await expect(levels(page).getByRole('button')).toHaveText(['Simpler', 'Standard'])
  expect(calls.map(call => call.body.depth)).toEqual(['standard', 'simpler'])
  // The panel's own help no longer promises Detailed for AI information.
  await scanPanel(page).getByText('About this assistant', { exact: true }).click()
  await expect(scanPanel(page).locator('.plant-assistant__intro')).toContainText('AI-generated information supports Simpler and Standard only.')
  // It also names the provider and what is and is not sent to it.
  await expect(scanPanel(page).locator('.plant-assistant__intro')).toContainText('Google Gemini, with Groq as a backup')
  await expect(scanPanel(page).locator('.plant-assistant__intro')).toContainText('It does not receive your photo, your location or your profile')
})

test('AC 8.4.4 A refused Detailed request keeps the answer and its level choices', async ({ page, context }) => {
  const refusal = 'More detail is available only for information from reviewed sources. Choose Simpler or Standard for an AI-generated explanation.'
  await recordAssistant(context, ({ body }) => body.depth === 'detailed' ? limitation('insufficient_evidence', refusal) : grounded())
  await scanAndOpen(page)
  await ask(page, 'Where does it grow?')
  await levels(page).getByRole('button', { name: 'More detail', exact: true }).click()
  // The refusal is announced, and the Standard answer is still on screen with
  // the buttons the refusal tells the user to pick from.
  await expect(scanPanel(page).getByRole('alert')).toHaveText(refusal)
  await expect(latestTurn(page)).toHaveAttribute('data-depth', 'standard')
  await expect(groundedSection(page).locator('.plant-assistant__answer')).toHaveText(HABITAT_TEXT)
  await expect(levels(page).getByRole('button')).toHaveText(['Simpler', 'Standard', 'More detail'])
})

test('AC 8.4.5 Clarify repeated general questions', async ({ page, context }) => {
  const calls = await recordAssistant(context, ({ body }) => body.question.toLowerCase().includes('eat')
    ? limitation('insufficient_evidence', 'I cannot say whether this plant is edible.', { intent: 'restricted' })
    : mixed(body.depth))
  await scanAndOpen(page)
  await ask(page, 'Where does it grow and what is a rhizome?')

  // Repeating a mixed question, padded and in another case, asks for a depth instead of re-sending.
  await page.getByLabel('Your question', { exact: true }).fill('  where does it grow AND what is a rhizome? ')
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  const repeat = scanPanel(page).locator('.plant-assistant__repeat')
  await expect(repeat).toContainText('I explained this question earlier in this conversation.')
  expect(calls).toHaveLength(1)

  // The repeated response keeps provenance: citation on the reviewed part,
  // warning and no citation on the AI part.
  await repeat.getByRole('button', { name: 'Simpler explanation' }).click()
  await expect(latestTurn(page)).toHaveAttribute('data-depth', 'simpler')
  expect(calls[1].body).toMatchObject({ depth: 'simpler', speciesId: 'mikania-micrantha' })
  await expect(page.locator('.plant-assistant__turn')).toHaveCount(1)
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(aiSection(page).locator('.plant-assistant__ai-warning')).toHaveText(AI_WARNING)
  await expect(aiSection(page).locator('a')).toHaveCount(0)

  // A refused request is not "answered": repeating it sends it again.
  await ask(page, 'Can I eat it?')
  await page.getByLabel('Your question', { exact: true }).fill('can i eat it?')
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  await expect.poll(() => calls.length).toBe(4)
  await expect(repeat).toHaveCount(0)
})

test('AC 8.4.5 A repeated AI-only question offers only Simpler or Standard', async ({ page, context }) => {
  const calls = await recordAssistant(context, ({ body }) => aiOnly(`${RHIZOME_TEXT} (${body.depth})`, body.depth))
  await scanAndOpen(page)
  await ask(page, 'What is a rhizome?')
  await page.getByLabel('Your question', { exact: true }).fill(' what is a RHIZOME? ')
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  const repeat = scanPanel(page).locator('.plant-assistant__repeat')
  await expect(repeat).toBeVisible()
  await expect(repeat.getByRole('button')).toHaveText(['Simpler', 'Standard'])
  await repeat.getByRole('button', { name: 'Simpler explanation' }).click()
  await expect(latestTurn(page)).toHaveAttribute('data-depth', 'simpler')
  expect(calls.map(call => call.body.depth)).toEqual(['standard', 'simpler'])
  // The repeated AI answer keeps its label and warning and gains no citation.
  await expect(aiSection(page).getByRole('heading', { name: 'AI-generated botanical information', exact: true })).toBeVisible()
  await expect(aiSection(page).locator('.plant-assistant__ai-warning')).toHaveText(AI_WARNING)
  await expect(latestTurn(page).locator('a')).toHaveCount(0)
})

test('AC 8.4.6 Handle provider or output failure honestly', async ({ page, context }) => {
  const rejected = 'The additional information could not be completed.'
  let transport: number | null = null
  const calls = await recordAssistant(context, ({ body }) => {
    if (transport) return { status: transport }
    if (body.question.includes('rhizome')) return answered([section('grounded', HABITAT_TEXT, 'standard', [HABITAT_SOURCE]), section('unavailable', rejected)])
    return providerFailure('standard', [])
  })
  await scanAndOpen(page)

  // Mixed reply whose AI part was rejected: the validated reviewed part is
  // still delivered with its real citation, beside a limitation for the rest.
  await ask(page, 'Where does it grow and what is a rhizome?')
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(latestTurn(page).getByRole('region', { name: 'Information unavailable', exact: true })).toContainText(rejected)
  await expect(aiSection(page)).toHaveCount(0)

  // AI-only reply that could not complete: a limitation with no facts or sources.
  await ask(page, 'How does transpiration work?')
  await expect(latestTurn(page).getByRole('region', { name: 'AI explanation unavailable', exact: true })).toContainText(PROVIDER_FAILURE_TEXT)
  await expect(latestTurn(page).locator('[data-section-kind]')).toHaveCount(1)
  await expect(latestTurn(page).locator('a')).toHaveCount(0)
  await expect(levels(page)).toHaveCount(0)

  // The request itself failing: an explicit error, no invented turn, and the
  // typed question is kept so it can be retried.
  transport = 503
  await page.getByLabel('Your question', { exact: true }).fill('What is a stolon?')
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  await expect(scanPanel(page).getByRole('alert')).toHaveText('The assistant could not be reached. Check your connection and try again, or open the catalogue entry.')
  await expect(page.locator('.plant-assistant__turn')).toHaveCount(2)
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue('What is a stolon?')

  // Rate limiting is reported as such, not as a connection problem.
  transport = 429
  await page.getByRole('button', { name: 'Ask question', exact: true }).click()
  await expect(scanPanel(page).getByRole('alert')).toHaveText('You have asked several questions recently. Wait a minute, then try again.')
  await expect(page.locator('.plant-assistant__turn')).toHaveCount(2)
  expect(calls).toHaveLength(4)
})

test('AC 8.6.1 Respond naturally to greetings', async ({ page, context }) => {
  const greeting = 'Hello! What would you like to know about this plant?'
  const calls = await recordAssistant(context, () => conversation(greeting, 'greeting'))
  await scanAndOpen(page)
  await ask(page, 'hello')

  // The greeting goes through the same endpoint with the scan context.
  expect(calls[0].path).toBe('/api/v1/plant-assistant/ask')
  expect(calls[0].body).toMatchObject({ question: 'hello', speciesId: 'mikania-micrantha' })
  // It is shown as conversation: no evidence heading, no citation, no AI disclosure.
  const turn = latestTurn(page)
  await expect(turn.getByRole('heading', { name: 'Plant conversation', level: 3 })).toBeVisible()
  await expect(turn.locator('[data-section-kind="conversation"] .plant-assistant__answer')).toHaveText(greeting)
  await expect(turn.getByRole('heading', { name: /^(Answer|Evidence is insufficient|Source information)$/ })).toHaveCount(0)
  await expect(turn.locator('a')).toHaveCount(0)
  await expect(turn.locator('.plant-assistant__ai-warning')).toHaveCount(0)
  await expect(turn.getByRole('region', { name: /sources/i })).toHaveCount(0)
  // A greeting is not an explanation, so there is no level to choose.
  await expect(levels(page)).toHaveCount(0)
  // The conversation stays open for a plant question.
  await expect(page.getByLabel('Your question', { exact: true })).toBeEditable()
  await expect(page.getByLabel('Your question', { exact: true })).toHaveValue('')
})

test('AC 8.6.2 Redirect unrelated questions', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => conversation(REDIRECT, 'off_topic'))
  await scanAndOpen(page)
  await ask(page, 'Who won the football last night?')

  expect(calls[0].body.question).toBe('Who won the football last night?')
  const turn = latestTurn(page)
  await expect(turn.getByRole('heading', { name: 'Plant conversation', level: 3 })).toBeVisible()
  // Only the redirect is shown: nothing is added around it, and nothing is cited.
  await expect(turn.locator('.plant-assistant__answer')).toHaveText([REDIRECT])
  await expect(turn.locator('a')).toHaveCount(0)
  await expect(turn.getByRole('region', { name: /sources/i })).toHaveCount(0)
  await expect(turn.locator('[data-section-kind="ai"]')).toHaveCount(0)
  await expect(turn.locator('[data-section-kind="grounded"]')).toHaveCount(0)
  await expect(levels(page)).toHaveCount(0)
})

test('AC 8.6.3 Enforce full-message safety for mixed intent', async ({ page, context }) => {
  const calls = await recordAssistant(context, ({ body }) => /phone/.test(body.question)
    ? limitation('insufficient_evidence', PRIVATE_DETAILS_TEXT, { intent: 'restricted' })
    : conversation('Hello! What would you like to know about this plant?', 'greeting'))
  await scanAndOpen(page)
  const message = 'Hi there! Where does it grow? Also my phone is 012-345 6789, can I go and remove it?'
  await ask(page, message)

  // The complete message reaches the API: the client does not strip the
  // greeting or send only the first clause, so the server can judge all of it.
  expect(calls).toHaveLength(1)
  expect(calls[0].body.question).toBe(message)

  // The restricted outcome wins on screen: no greeting reply, no answer, no AI text.
  const turn = latestTurn(page)
  await expect(turn).toHaveAttribute('data-mode', 'limitation')
  await expect(turn.locator('.plant-assistant__answer')).toHaveText(PRIVATE_DETAILS_TEXT)
  await expect(turn.getByRole('heading', { name: 'Plant conversation' })).toHaveCount(0)
  await expect(turn.locator('[data-section-kind]')).toHaveCount(0)
  await expect(turn.locator('a')).toHaveCount(0)
  await expect(levels(page)).toHaveCount(0)
  await expect(turn.locator('.plant-assistant__safety')).toHaveText(SAFETY_BOUNDARY)
})

test('AC 8.6.3 An unsupported scan gets the limitation, not a conversational assistant', async ({ page, context }) => {
  const calls = await recordAssistant(context, () => conversation('Hello!', 'greeting'))
  await uncertainScanAndOpen(page)
  // With no trusted species there is nowhere to type a greeting at all.
  await expect(scanPanel(page).getByRole('status')).toContainText('species-specific assistant guidance is unavailable')
  await expect(scanPanel(page).getByRole('textbox')).toHaveCount(0)
  await expect(scanPanel(page).getByRole('button', { name: 'Ask question' })).toHaveCount(0)
  expect(calls).toHaveLength(0)
})

test('AC 8.6.4 Understand natural botanical intent', async ({ page, context }) => {
  const clarify = 'Could you clarify what you would like to discuss about plants?'
  const calls = await recordAssistant(context, ({ body }) => {
    if (body.question === 'does it do the thing?') return conversation(clarify, 'ambiguous')
    if (body.question.includes('strangle')) return mixed()
    return grounded()
  })
  await scanAndOpen(page)

  // Unfamiliar wording is sent as it is and can come back grounded plus AI.
  const natural = 'Will this creeper strangle my saplings, and what even is a rhizome?'
  await ask(page, natural)
  expect(calls[0].body).toMatchObject({ question: natural, history: [] })
  await expect(groundedSection(page).getByRole('link', { name: HABITAT_SOURCE.sourceName })).toHaveAttribute('href', HABITAT_SOURCE.sourceUrl)
  await expect(aiSection(page).locator('a')).toHaveCount(0)

  // A genuinely ambiguous message gets one concise clarification, uncited.
  await ask(page, 'does it do the thing?')
  await expect(latestTurn(page).getByRole('heading', { name: 'Plant conversation', level: 3 })).toBeVisible()
  await expect(latestTurn(page).locator('.plant-assistant__answer')).toHaveText([clarify])
  await expect(latestTurn(page).locator('a')).toHaveCount(0)

  // The follow-up carries the recent turns, so "it" and "the thing" can be
  // resolved from the conversation rather than guessed.
  await ask(page, 'I mean climbing over other plants')
  expect(calls[2].body.question).toBe('I mean climbing over other plants')
  expect(calls[2].body.history.slice(-2)).toEqual([
    { role: 'user', content: 'does it do the thing?' },
    { role: 'assistant', content: clarify },
  ])
  expect(calls[2].body.speciesId).toBe('mikania-micrantha')
})
