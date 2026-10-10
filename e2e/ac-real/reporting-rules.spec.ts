// Server-side rules behind the reporting ACs, proved against the real FastAPI
// stack. The mock-layer specs in e2e/ac show what the user sees; these show
// that the service itself enforces the rule, which a mocked response cannot.
// Needs the Compose stack (see playwright.real.config.ts).
import { expect, test } from '@playwright/test'
import {
  API_URL, isolatedPoint, makeJpeg, northOf, SPECIES, startProfile, submitReport, waitForScreening,
} from '../fixtures/real-api'

type Problem = { code?: string; detail?: unknown; errors?: unknown }

// Starting an identity can wait out a one-minute limiter window.
test.describe.configure({ timeout: 180_000 })

async function publicSightingIds(request: import('@playwright/test').APIRequestContext, point: { lat: number; lng: number }) {
  // About a kilometre each way: public coordinates may be precision-reduced,
  // and a persistent stack can hold earlier runs' sightings, so callers compare
  // before and after rather than expecting an exact list.
  const d = 0.01
  const bbox = [point.lng - d, point.lat - d, point.lng + d, point.lat + d].join(',')
  const response = await request.get(`${API_URL}/api/v1/sightings`, { params: { bbox, limit: 500 } })
  expect(response.status()).toBe(200)
  return (await response.json() as { items: { id: string }[] }).items.map((item) => item.id)
}

test('AC 2.2.1 Classification-to-report consistency: the server re-reads the scan and rejects a swapped species or confidence', async ({ request, browser }) => {
  const session = await startProfile(request)
  const photo = await makeJpeg(browser)

  const swappedSpecies = await submitReport(request, session, { photo, report: { speciesId: 'chromolaena-odorata' } })
  expect(swappedSpecies.response.status()).toBe(422)
  expect((await swappedSpecies.response.json() as Problem).code).toBe('scan_species_mismatch')

  const swappedConfidence = await submitReport(request, session, { photo: await makeJpeg(browser), report: { confidence: 0.99 } })
  expect(swappedConfidence.response.status()).toBe(422)
  expect((await swappedConfidence.response.json() as Problem).code).toBe('scan_confidence_mismatch')

  const mine = await request.get(`${API_URL}/api/v1/reports/mine`, { headers: session.headers })
  expect((await mine.json() as { items: unknown[] }).items).toEqual([])
})

test('AC 2.2.2 Required evidence validation: missing or invalid evidence is rejected per field and nothing is published', async ({ request, browser }) => {
  const session = await startProfile(request)
  const point = isolatedPoint()

  const badLatitude = await submitReport(request, session, {
    photo: await makeJpeg(browser), location: { lat: 95, lng: point.lng },
  })
  expect(badLatitude.response.status()).toBe(422)
  expect(JSON.stringify(await badLatitude.response.json())).toMatch(/lat/i)

  const unknownPhoto = await submitReport(request, session, {
    photo: await makeJpeg(browser), location: point, report: { photoKey: 'uploads/not-issued.jpg' },
  })
  expect(unknownPhoto.response.status()).toBe(400)
  expect((await unknownPhoto.response.json() as Problem).code).toBe('upload_not_issued')

  // A scan the model did not accept as a supported invasive target cannot back a report.
  const notAccepted = await submitReport(request, session, {
    photo: await makeJpeg(browser), location: point, scan: { outcome: 'uncertain', predictedSpeciesId: null },
  })
  expect(notAccepted.response.status()).toBe(422)
  expect((await notAccepted.response.json() as Problem).code).toBe('scan_outcome_mismatch')

  const mine = await request.get(`${API_URL}/api/v1/reports/mine`, { headers: session.headers })
  expect((await mine.json() as { items: unknown[] }).items).toEqual([])
})

test('AC 2.2.3, AC 4.1.3 Honest publication status and relational persistence: the server owns the status and a marker exists only once screened', async ({ request, browser }) => {
  const session = await startProfile(request)
  const point = isolatedPoint()

  const markersBefore = await publicSightingIds(request, point)

  // The client tries to publish itself; the status is not the client's to set,
  // and the refused request stores nothing.
  const selfPublished = await submitReport(request, session, {
    photo: await makeJpeg(browser), location: point, report: { status: 'screened' },
  })
  expect(selfPublished.response.status()).toBe(422)
  const afterRefusal = await request.get(`${API_URL}/api/v1/reports/mine`, { headers: session.headers })
  expect((await afterRefusal.json() as { items: unknown[] }).items).toEqual([])

  const { response, captureId } = await submitReport(request, session, {
    photo: await makeJpeg(browser), location: point, accuracyM: 14,
    report: { notes: 'AC 4.1.3 persistence check' },
  })
  expect(response.status()).toBe(201)
  type Stored = {
    id: string; status: string; sightingId: string | null; createdAt: string
    submission: {
      speciesId: string; captureId: string; photoKey: string; notes: string
      location: { lat: number; lng: number }; locationAccuracyM: number
    }
  }
  const created = await response.json() as Stored
  expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(created.status).toBe('processing')
  expect(created.sightingId).toBeNull()
  expect(Date.parse(created.createdAt)).toBeGreaterThan(Date.now() - 60_000)
  expect(created.submission).toMatchObject({
    speciesId: SPECIES, captureId, notes: 'AC 4.1.3 persistence check', locationAccuracyM: 14,
  })
  expect(created.submission.photoKey).toBeTruthy()
  expect(created.submission.location.lat).toBeCloseTo(point.lat, 4)
  expect(created.submission.location.lng).toBeCloseTo(point.lng, 4)

  const screened = await waitForScreening(request, session, created.id)
  expect(screened.status).toBe('screened')
  expect(screened.sightingId).toBeTruthy()
  const markersAfter = await publicSightingIds(request, point)
  expect(markersBefore).not.toContain(screened.sightingId)
  expect(markersAfter).toContain(screened.sightingId)
  expect(markersAfter).toHaveLength(markersBefore.length + 1)

  // Exactly one stored record, owned by this identity and invisible to another.
  const mine = await request.get(`${API_URL}/api/v1/reports/mine`, { headers: session.headers })
  expect((await mine.json() as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([created.id])
  const stranger = await startProfile(request)
  const other = await request.get(`${API_URL}/api/v1/reports/${created.id}`, { headers: stranger.headers })
  expect(other.status()).toBe(404)
})

test('AC 2.3.1 Exact-image duplicate check: the same owner, image and species returns the existing report and no second marker', async ({ request, browser }) => {
  const session = await startProfile(request)
  const point = isolatedPoint()
  const photo = await makeJpeg(browser)

  const first = await submitReport(request, session, { photo, location: point })
  expect(first.response.status()).toBe(201)
  const original = await waitForScreening(request, session, (await first.response.json() as { id: string }).id)
  expect(original.status).toBe('screened')
  const markers = await publicSightingIds(request, point)
  expect(markers).toContain(original.sightingId)

  const replay = await submitReport(request, session, { photo, location: northOf(point, 5) })
  expect(replay.response.ok()).toBe(true)
  const returned = await replay.response.json() as { id: string; sightingId: string }
  expect(returned.id).toBe(original.id)
  expect(returned.sightingId).toBe(original.sightingId)
  expect(await publicSightingIds(request, point)).toEqual(markers)

  // The hash is for duplicate detection only and is not in the public payload.
  const detail = await request.get(`${API_URL}/api/v1/sightings/${original.sightingId}`)
  expect(JSON.stringify(await detail.json())).not.toContain(first.imageSha256)
})

test('AC 2.3.2 Near-duplicate merging: a second photo of the same species within 25 m and 10 minutes merges into the first sighting', async ({ request, browser }) => {
  const session = await startProfile(request)
  const point = isolatedPoint()

  const first = await submitReport(request, session, { photo: await makeJpeg(browser), location: point })
  const original = await waitForScreening(request, session, (await first.response.json() as { id: string }).id)
  expect(original.status).toBe('screened')
  const markers = await publicSightingIds(request, point)

  const nearby = await submitReport(request, session, { photo: await makeJpeg(browser), location: northOf(point, 10) })
  expect(nearby.response.status()).toBe(201)
  const merged = await waitForScreening(request, session, (await nearby.response.json() as { id: string }).id)
  expect(merged.status).toBe('merged')
  expect(merged.sightingId).toBe(original.sightingId)
  expect((merged.validation as { reasonCodes: string[] }).reasonCodes).toContain('same_species_nearby_recent')
  expect(merged.retainedReportId).toBe(original.id)
  expect(await publicSightingIds(request, point)).toEqual(markers)

  // Outside 25 m the same identity's next photo is its own sighting.
  const farther = await submitReport(request, session, { photo: await makeJpeg(browser), location: northOf(point, 80) })
  const separate = await waitForScreening(request, session, (await farther.response.json() as { id: string }).id)
  expect(separate.status).toBe('screened')
  expect(separate.sightingId).not.toBe(original.sightingId)
})

test('AC 2.3.3 Submission rate limit: the eleventh report from one token in the window gets 429 with Retry-After', async ({ request, browser }) => {
  const session = await startProfile(request)
  const point = isolatedPoint()

  const published = await submitReport(request, session, { photo: await makeJpeg(browser), location: point })
  expect(published.response.status()).toBe(201)
  const reportId = (await published.response.json() as { id: string }).id

  // The limiter counts attempts before it validates them, so nine cheap
  // requests with an unissued photo key fill the rest of the window.
  const attempt = (index: number) => request.post(`${API_URL}/api/v1/reports`, {
    headers: { ...session.headers, 'Idempotency-Key': `ac-233-${crypto.randomUUID()}` },
    data: {
      photoKey: `uploads/ac-233-${index}.jpg`, speciesId: SPECIES, outcome: 'target', confidence: 0.91,
      modelVersion: 'oe_v4_31class_web_fp16', observedAt: new Date().toISOString(), captureId: crypto.randomUUID(),
      captureSource: 'camera', imageSha256: 'a'.repeat(64), location: point, locationAccuracyM: 12,
      extent: 'single', consent: { accurate: true, noPII: true },
    },
  })
  for (let index = 2; index <= 10; index++) {
    expect((await attempt(index)).status(), `attempt ${index} is inside the limit`).not.toBe(429)
  }
  const limited = await attempt(11)
  expect(limited.status()).toBe(429)
  expect(Number(limited.headers()['retry-after'])).toBeGreaterThan(0)

  // Existing reports stay readable while the limit is in force.
  const existing = await request.get(`${API_URL}/api/v1/reports/${reportId}`, { headers: session.headers })
  expect(existing.status()).toBe(200)
  // Another identity is unaffected: the limit is per token.
  const other = await startProfile(request)
  const theirs = await submitReport(request, other, { photo: await makeJpeg(browser), location: isolatedPoint() })
  expect(theirs.response.status()).toBe(201)
})

test('AC 4.5.3, AC 4.5.4, AC 4.5.5, AC 4.5.6 Removal vicinity is validated on the server, a rejection changes nothing, and history is kept', async ({ request, browser }) => {
  const reporter = await startProfile(request)
  const point = isolatedPoint()
  const submitted = await submitReport(request, reporter, { photo: await makeJpeg(browser), location: point })
  const report = await waitForScreening(request, reporter, (await submitted.response.json() as { id: string }).id)
  expect(report.status).toBe('screened')

  const removal = (where: { lat: number; lng: number }, accuracyM: number, capturedAt = new Date()) =>
    request.post(`${API_URL}/api/v1/reports/${report.id}/removal`, {
      headers: reporter.headers,
      data: { latitude: where.lat, longitude: where.lng, accuracyM, capturedAt: capturedAt.toISOString() },
    })

  // The vicinity limit is 250 m in the AC and temporarily 350 m in code, so
  // the rejections use distances and accuracies that fail under either.
  const tooFar = await removal(northOf(point, 1500), 10)
  expect(tooFar.status()).toBeGreaterThanOrEqual(400)
  const tooVague = await removal(northOf(point, 5), 900)
  expect(tooVague.status()).toBeGreaterThanOrEqual(400)
  const stale = await removal(northOf(point, 5), 10, new Date(Date.now() - 60 * 60 * 1000))
  expect(stale.status()).toBeGreaterThanOrEqual(400)
  for (const rejected of [tooFar, tooVague, stale]) {
    expect((await rejected.json() as Problem).code).toMatch(/removal|location/)
  }

  // Nothing was written by the rejected attempts.
  const before = await request.get(`${API_URL}/api/v1/sightings/${report.sightingId}`)
  expect((await before.json() as { status: string }).status).toBe('screened')

  const accepted = await removal(northOf(point, 20), 10)
  expect(accepted.status()).toBe(200)
  const recorded = await accepted.json() as { status: string; distanceM: number; removalReportedAt: string }
  expect(recorded.status).toBe('removal_reported')
  // Distance is the server's own calculation from the stored point.
  expect(recorded.distanceM).toBeGreaterThan(15)
  expect(recorded.distanceM).toBeLessThan(25)

  const after = await request.get(`${API_URL}/api/v1/sightings/${report.sightingId}`)
  const sighting = await after.json() as { status: string; followUpState: string; removalReportedAt: string }
  expect(sighting).toMatchObject({ status: 'removal_reported', followUpState: 'needed' })
  expect(sighting.removalReportedAt).toBe(recorded.removalReportedAt)
  // The original report is still there, unchanged, for its owner.
  const original = await request.get(`${API_URL}/api/v1/reports/${report.id}`, { headers: reporter.headers })
  expect(original.status()).toBe(200)
  expect(await original.json()).toMatchObject({ id: report.id, submission: { speciesId: SPECIES } })
})
