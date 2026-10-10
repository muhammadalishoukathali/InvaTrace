// Backend rules behind the plant-assistant ACs (Epic 8) that hold with no
// generation provider configured, proved against the real FastAPI stack. What
// the panel renders for each answer type is covered on stubs in e2e/ac; the
// rules that need real model output (grounded generation, depth rewriting,
// AI-only eligibility) stay with backend/tests/test_assistant_*.py.
// Needs the Compose stack (see playwright.real.config.ts).
import { expect, test, type APIRequestContext } from '@playwright/test'
import { API_URL, isolatedPoint, publishSighting, startProfile, type Session } from '../fixtures/real-api'

// Starting an identity can wait out a one-minute limiter window.
test.describe.configure({ timeout: 180_000 })

type Answer = {
  status: string
  answerability: string
  answer: string
  intent: string
  answerMode: string
  safetyBoundary: string
  sources: Array<{ sourceName: string; sourceUrl: string }>
  sections: Array<{ kind: string; title: string; sources: Array<{ sourceName: string; sourceUrl: string }> }>
}

const scan = { speciesId: 'mikania-micrantha', classifierOutcome: 'target', classifierConfidence: 0.9 }

async function ask(request: APIRequestContext, session: Session, path: 'ask' | 'guide/ask' | 'map/ask', data: Record<string, unknown>) {
  const post = () => request.post(`${API_URL}/api/v1/plant-assistant/${path}`, { headers: session.headers, data })
  let response = await post()
  // Assistant questions are limited to fifteen a minute; wait the window out.
  while (response.status() === 429) {
    await new Promise((resolve) => setTimeout(resolve, (Number(response.headers()['retry-after']) || 5) * 1000))
    response = await post()
  }
  expect(response.status(), await response.text()).toBe(200)
  return await response.json() as Answer
}

/** True when a generation provider answered, which these tests do not expect. */
const generated = (answer: Answer) => answer.answerMode !== 'fallback' || answer.sections.some((section) => section.kind === 'ai')

test('AC 8.1.5, AC 8.4.6 Provider unavailable: the reply is an honest limitation with stored source excerpts and no AI text', async ({ request }) => {
  const session = await startProfile(request)
  const answer = await ask(request, session, 'ask', { ...scan, question: 'Where does it grow?' })
  test.skip(generated(answer), 'A generation provider is configured on this stack; the unavailable path cannot be observed.')

  expect(answer).toMatchObject({ status: 'insufficient_evidence', answerMode: 'fallback', intent: 'botanical' })
  expect(answer.answer).toMatch(/could not be completed/i)
  expect(answer.sections[0]).toMatchObject({ kind: 'unavailable', title: 'AI explanation unavailable', sources: [] })
  // AC 8.2.4: every excerpt keeps the stored source name and URL.
  expect(answer.sources.length).toBeGreaterThan(0)
  for (const source of answer.sources) {
    expect(source.sourceName).toBeTruthy()
    expect(source.sourceUrl).toMatch(/^https:\/\//)
  }
  expect(answer.sections.filter((section) => section.kind === 'ai')).toEqual([])
})

test('AC 8.3.4 An insufficient scan gets a limitation before any retrieval', async ({ request }) => {
  const session = await startProfile(request)
  const question = 'Where does it grow?'
  const cases = [
    { ...scan, classifierConfidence: 0.1 },
    { ...scan, classifierOutcome: 'uncertain' },
    { ...scan, speciesId: 'not-a-plant' },
  ]
  for (const context of cases) {
    const answer = await ask(request, session, 'ask', { ...context, question })
    expect(answer, JSON.stringify(context)).toMatchObject({ status: 'unsupported_scan', answerability: 'insufficient_evidence', sources: [], sections: [] })
    // The limitation does not name or describe the species.
    expect(answer.answer).not.toMatch(/mikania|mile-a-minute/i)
  }
})

test('AC 8.2.5, AC 8.4.2, AC 8.6.3 The safety boundary is on every reply, and a message with private details is refused whole', async ({ request }) => {
  const session = await startProfile(request)
  const supported = await ask(request, session, 'ask', { ...scan, question: 'Can I pull it out myself?' })
  const refusedScan = await ask(request, session, 'ask', { ...scan, classifierConfidence: 0.1, question: 'Can I pull it out myself?' })
  const mixed = await ask(request, session, 'ask', { ...scan, question: 'Hi! my phone is 012-345 6789, where does it grow?' })

  for (const answer of [supported, refusedScan, mixed]) {
    expect(answer.safetyBoundary).toMatch(/does not grant permission to touch, collect, transport or remove a plant/)
    expect(answer.safetyBoundary).toBe(supported.safetyBoundary)
  }
  // The greeting and the plant question do not rescue the message.
  expect(mixed).toMatchObject({ intent: 'restricted', status: 'insufficient_evidence', sources: [], sections: [] })
  expect(mixed.answer).toMatch(/without personal details/i)
  expect(mixed.answer).not.toContain('012-345')
  // A removal question never comes back as model-only advice.
  expect(supported.sections.filter((section) => section.kind === 'ai')).toEqual([])
})

test('AC 8.5.1, AC 8.5.3 The Plant Guide entry needs an exact catalogue reference', async ({ request }) => {
  const session = await startProfile(request)
  for (const speciesId of ['unknown', 'Mikania micrantha']) {
    const answer = await ask(request, session, 'guide/ask', { speciesId, question: 'Where does it grow?' })
    expect(answer, speciesId).toMatchObject({ status: 'insufficient_evidence', sources: [], sections: [] })
    expect(answer.answer).toMatch(/does not have a supported catalogue reference/)
    expect(answer.answer).toMatch(/not a plant identification/i)
  }
  const supported = await ask(request, session, 'guide/ask', { speciesId: 'mikania-micrantha', question: 'Where does it grow?' })
  expect(supported.answer).not.toMatch(/does not have a supported catalogue reference/)
  for (const source of supported.sources) expect(source.sourceUrl).toMatch(/^https:\/\//)
})

test('AC 8.5.2, AC 8.5.3 The Map entry rechecks public visibility on every question', async ({ request, browser }) => {
  const owner = await startProfile(request)
  const asker = await startProfile(request)
  const report = await publishSighting(request, browser, owner, isolatedPoint())
  const limitation = /does not have a supported, consistent catalogue mapping/

  const unknown = await ask(request, asker, 'map/ask', { sightingId: '00000000-0000-4000-8000-000000000000', question: 'Where does it grow?' })
  expect(unknown.answer).toMatch(limitation)

  const visible = await ask(request, asker, 'map/ask', { sightingId: report.sightingId, question: 'Where does it grow?' })
  expect(visible.answer).not.toMatch(limitation)
  // The reply is about the catalogue species, not this record or its position.
  const text = JSON.stringify(visible)
  expect(text).not.toContain(report.sightingId)
  expect(text).not.toContain(report.id)

  // Coordinates and species are not the client's to supply.
  const stuffed = await request.post(`${API_URL}/api/v1/plant-assistant/map/ask`, {
    headers: asker.headers,
    data: { sightingId: report.sightingId, question: 'Where does it grow?', latitude: 3.1, longitude: 101.6, speciesId: 'lantana-camara' },
  })
  expect(stuffed.status()).toBe(422)

  // Withdrawn between two questions: the second one is refused.
  const withdrawal = await request.post(`${API_URL}/api/v1/reports/${report.id}/withdrawal`, { headers: owner.headers, data: { reason: 'Reported by mistake.' } })
  expect(withdrawal.ok(), await withdrawal.text()).toBe(true)
  const afterWithdrawal = await ask(request, asker, 'map/ask', { sightingId: report.sightingId, question: 'Where does it grow?' })
  expect(afterWithdrawal).toMatchObject({ status: 'insufficient_evidence', sources: [], sections: [] })
  expect(afterWithdrawal.answer).toMatch(limitation)
})
