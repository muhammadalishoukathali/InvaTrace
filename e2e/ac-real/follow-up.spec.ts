// Server-side rules behind the removal follow-up ACs (US 4.6-4.8), proved
// against the real FastAPI + PostGIS stack. The browser journey for the same
// stories is e2e/follow-up-outcomes.spec.ts on mocks. Needs the Compose stack.
import { expect, test, type APIRequestContext, type Browser } from '@playwright/test'
import { API_URL, fix, isolatedPoint, northOf, publishSighting, startProfile, type Session } from '../fixtures/real-api'

// Starting an identity can wait out a one-minute limiter window.
test.describe.configure({ timeout: 180_000 })

type Detail = {
  id: string
  status: string
  followUpState: string | null
  lastFollowupAt: string | null
  removalReportedAt: string | null
  followUpHistory: Array<Record<string, unknown> & { eventType: string; createdAt: string }>
}

async function removedSighting(request: APIRequestContext, browser: Browser) {
  const session = await startProfile(request)
  const point = isolatedPoint()
  const report = await publishSighting(request, browser, session, point)
  const removal = await request.post(`${API_URL}/api/v1/reports/${report.id}/removal`, {
    headers: session.headers, data: fix(northOf(point, 10)),
  })
  expect(removal.status()).toBe(200)
  return { session, point, report, sightingId: report.sightingId }
}

const followUp = (request: APIRequestContext, session: Session, sightingId: string, data: Record<string, unknown>) =>
  request.post(`${API_URL}/api/v1/sightings/${sightingId}/follow-up`, { headers: session.headers, data })

const detail = async (request: APIRequestContext, sightingId: string) =>
  await (await request.get(`${API_URL}/api/v1/sightings/${sightingId}`)).json() as Detail

async function listedIds(request: APIRequestContext, point: { lat: number; lng: number }, followUpFilter?: string) {
  const d = 0.01
  const params: Record<string, string | number> = { bbox: [point.lng - d, point.lat - d, point.lng + d, point.lat + d].join(','), limit: 500 }
  if (followUpFilter) params.follow_up = followUpFilter
  const response = await request.get(`${API_URL}/api/v1/sightings`, { params })
  expect(response.status()).toBe(200)
  return (await response.json() as { items: { id: string }[] }).items.map((item) => item.id)
}

test('AC 4.6.1, AC 4.6.2, AC 4.6.3 A removal-reported sighting is published as follow-up needed and the follow-up filter finds it', async ({ request, browser }) => {
  const { point, sightingId, session } = await removedSighting(request, browser)
  const sighting = await detail(request, sightingId)
  expect(sighting).toMatchObject({ status: 'removal_reported', followUpState: 'needed' })
  expect(sighting.removalReportedAt).toBeTruthy()

  expect(await listedIds(request, point, 'needed')).toContain(sightingId)
  expect(await listedIds(request, point, 'resolved')).not.toContain(sightingId)
  expect(await listedIds(request, point, 'regrowth')).not.toContain(sightingId)

  // A sighting that is still active is not offered for follow-up.
  const active = await publishSighting(request, browser, session, northOf(point, 300))
  expect(await listedIds(request, point, 'needed')).not.toContain(active.sightingId)
  const refused = await followUp(request, session, active.sightingId, { ...fix(northOf(point, 300)), outcome: 'no_regrowth' })
  expect(refused.status()).toBe(409)
  expect((await refused.json() as { code: string }).code).toBe('follow_up_not_available')
})

test('AC 4.7.1, AC 4.7.4 Follow-up location is checked on the server and a rejected fix records nothing', async ({ request, browser }) => {
  const { session, point, sightingId } = await removedSighting(request, browser)
  const rejections = {
    'too far': { ...fix(northOf(point, 1500)), outcome: 'no_regrowth' },
    'accuracy worse than 250 m': { ...fix(northOf(point, 5), 600), outcome: 'no_regrowth' },
    'stale fix': { ...fix(northOf(point, 5), 10, new Date(Date.now() - 60 * 60 * 1000)), outcome: 'no_regrowth' },
  }
  const codes: string[] = []
  for (const [reason, body] of Object.entries(rejections)) {
    const response = await followUp(request, session, sightingId, body)
    expect(response.status(), reason).toBeGreaterThanOrEqual(400)
    expect(response.status(), reason).toBeLessThan(500)
    codes.push((await response.json() as { code: string }).code)
  }
  // Each failure has its own code so the client can say what to fix.
  expect(new Set(codes).size).toBe(3)

  const after = await detail(request, sightingId)
  expect(after).toMatchObject({ status: 'removal_reported', followUpState: 'needed', lastFollowupAt: null })
  expect(after.followUpHistory.map((entry) => entry.eventType)).toEqual(['reported', 'removal_reported'])
})

test('AC 4.7.2, AC 4.7.3 Exactly three follow-up outcomes are accepted and the response states the resulting state', async ({ request, browser }) => {
  const { session, point, sightingId } = await removedSighting(request, browser)
  const invalid = await followUp(request, session, sightingId, { ...fix(northOf(point, 5)), outcome: 'eradicated' })
  expect(invalid.status()).toBe(422)
  const missing = await followUp(request, session, sightingId, fix(northOf(point, 5)))
  expect(missing.status()).toBe(422)

  const recorded = await followUp(request, session, sightingId, { ...fix(northOf(point, 5)), outcome: 'unable_to_confirm' })
  expect(recorded.status()).toBe(201)
  expect(await recorded.json()).toMatchObject({ sightingId, outcome: 'unable_to_confirm', followUpState: 'needed' })
})

test('AC 4.8.1 No regrowth outcome: the sighting is resolved, leaves the default map and stays reachable as resolved', async ({ request, browser }) => {
  const { session, point, sightingId } = await removedSighting(request, browser)
  expect(await listedIds(request, point)).toContain(sightingId)

  const recorded = await followUp(request, session, sightingId, { ...fix(northOf(point, 5)), outcome: 'no_regrowth' })
  expect(recorded.status()).toBe(201)
  expect(await recorded.json()).toMatchObject({ outcome: 'no_regrowth', followUpState: 'resolved' })

  expect(await listedIds(request, point)).not.toContain(sightingId)
  expect(await listedIds(request, point, 'needed')).not.toContain(sightingId)
  expect(await listedIds(request, point, 'resolved')).toContain(sightingId)
  expect(await detail(request, sightingId)).toMatchObject({ followUpState: 'resolved' })

  // A resolved sighting takes no further follow-up.
  const again = await followUp(request, session, sightingId, { ...fix(northOf(point, 5)), outcome: 'regrowth_present' })
  expect(again.status()).toBe(409)
})

test('AC 4.8.2, AC 4.8.5 Regrowth outcome: the sighting is active again with a dated follow-up and can be marked removed again', async ({ request, browser }) => {
  const { session, point, report, sightingId } = await removedSighting(request, browser)
  const recorded = await followUp(request, session, sightingId, { ...fix(northOf(point, 5)), outcome: 'regrowth_present' })
  expect(recorded.status()).toBe(201)
  const outcome = await recorded.json() as { followUpState: string; lastFollowupAt: string }
  expect(outcome.followUpState).toBe('regrowth')

  const regrown = await detail(request, sightingId)
  expect(regrown).toMatchObject({ status: 'screened', followUpState: 'regrowth', lastFollowupAt: outcome.lastFollowupAt })
  expect(await listedIds(request, point)).toContain(sightingId)
  expect(await listedIds(request, point, 'regrowth')).toContain(sightingId)

  // Removal again needs the same fresh, nearby fix as the first time.
  const far = await request.post(`${API_URL}/api/v1/reports/${report.id}/removal`, { headers: session.headers, data: fix(northOf(point, 1500)) })
  expect(far.status()).toBeGreaterThanOrEqual(400)
  const removedAgain = await request.post(`${API_URL}/api/v1/reports/${report.id}/removal`, { headers: session.headers, data: fix(northOf(point, 10)) })
  expect(removedAgain.status()).toBe(200)
  const second = await detail(request, sightingId)
  expect(second).toMatchObject({ status: 'removal_reported', followUpState: 'needed' })
  expect(Date.parse(second.removalReportedAt!)).toBeGreaterThan(Date.parse(regrown.removalReportedAt!))
})

test('AC 4.8.3, AC 4.8.4 Unconfirmed outcome keeps follow-up needed, and the history is chronological without exact coordinates', async ({ request, browser }) => {
  const { session, point, sightingId } = await removedSighting(request, browser)
  const visit = northOf(point, 7)
  const first = await followUp(request, session, sightingId, { ...fix(visit), outcome: 'unable_to_confirm' })
  expect(first.status()).toBe(201)
  const afterFirst = await detail(request, sightingId)
  expect(afterFirst).toMatchObject({ status: 'removal_reported', followUpState: 'needed' })
  expect(afterFirst.lastFollowupAt).toBeTruthy()
  expect(await listedIds(request, point, 'needed')).toContain(sightingId)

  // A later attempt is allowed and moves the latest-attempt date forward.
  const second = await followUp(request, session, sightingId, { ...fix(visit), outcome: 'unable_to_confirm' })
  expect(second.status()).toBe(201)
  const sighting = await detail(request, sightingId)
  expect(Date.parse(sighting.lastFollowupAt!)).toBeGreaterThanOrEqual(Date.parse(afterFirst.lastFollowupAt!))

  const history = sighting.followUpHistory
  expect(history.map((entry) => entry.eventType)).toEqual(['reported', 'removal_reported', 'followup_unable', 'followup_unable'])
  const times = history.map((entry) => Date.parse(entry.createdAt))
  expect(times).toEqual([...times].sort((a, b) => a - b))
  // The follow-up fix itself stays private.
  for (const entry of history) expect(Object.keys(entry).sort()).toEqual(['createdAt', 'eventType'])
  const text = JSON.stringify(history)
  expect(text).not.toContain(visit.lat.toFixed(5))
})
