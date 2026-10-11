// Server-side rules behind the anonymous-access and location-context ACs,
// proved against the real FastAPI stack. Needs the Compose stack (see
// playwright.real.config.ts).
import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  API_URL, isolatedPoint, makeJpeg, newInstallationToken, startProfile, submitReport, waitForScreening,
} from '../fixtures/real-api'

// Starting an identity can wait out a one-minute limiter window.
test.describe.configure({ timeout: 180_000 })

const restore = (request: APIRequestContext, profileId: string, recoveryCode: string) =>
  request.post(`${API_URL}/api/v1/profiles/restore`, {
    data: { profileId, recoveryCode, installationToken: newInstallationToken() },
  })

test('AC 2.1.1 Anonymous identity creation: a profile ID, a recovery kit and a session are issued without any personal detail', async ({ request }) => {
  // Nothing but a random installation secret is sent.
  const session = await startProfile(request)
  expect(session.profile.id).toMatch(/^[A-Z0-9]{4,12}$/)
  expect(session.accessToken).toBeTruthy()
  expect(session.profile).not.toHaveProperty('email')
  expect(session.profile).not.toHaveProperty('phone')
  // Base32 text carries five bits a character, so 26 characters clear 128 bits.
  expect(session.recoveryCodes).toHaveLength(1)
  for (const code of session.recoveryCodes) expect(code.replaceAll('-', '').length).toBeGreaterThanOrEqual(26)

  // The session works straight away.
  const mine = await request.get(`${API_URL}/api/v1/reports/mine`, { headers: session.headers })
  expect(mine.status()).toBe(200)
})

test('AC 2.1.2 Recovery-key handling: codes are shown once, never echoed back, and rotation retires the old one', async ({ request }) => {
  const session = await startProfile(request)
  const [code] = session.recoveryCodes

  const acknowledged = await request.post(`${API_URL}/api/v1/profiles/me/recovery-setup/acknowledge`, { headers: session.headers })
  expect(acknowledged.status()).toBe(204)

  // No later response carries the plain-text code: the overview only counts them.
  const overview = await request.get(`${API_URL}/api/v1/profiles/me/access`, { headers: session.headers })
  const overviewText = await overview.text()
  expect(overviewText).not.toContain(code)
  expect(JSON.parse(overviewText)).toMatchObject({ profileId: session.profile.id, recoveryCodeCount: session.recoveryCodes.length })
  const bootstrap = await request.post(`${API_URL}/api/v1/profiles/bootstrap`, { data: { installationToken: session.installationToken } })
  expect(await bootstrap.text()).not.toContain(code)

  const rotated = await request.post(`${API_URL}/api/v1/profiles/me/recovery-codes/rotate`, { headers: session.headers })
  expect(rotated.status()).toBe(200)
  const fresh = (await rotated.json() as { recoveryCodes: string[] }).recoveryCodes
  expect(fresh).not.toContain(code)
  // The retired code no longer restores; the new one does.
  const retired = await restore(request, session.profile.id, code)
  test.skip(retired.status() === 429, 'The restore limiter is still closed from an earlier run; retry after 15 minutes.')
  expect(retired.status()).toBe(400)
  expect((await restore(request, session.profile.id, fresh[0])).status()).toBe(200)
})

test('AC 2.1.2 Recovery-key handling: a code stays valid after restoring access until it is rotated', async ({ request }) => {
  const session = await startProfile(request)
  const [code] = session.recoveryCodes
  const first = await restore(request, session.profile.id, code)
  test.skip(first.status() === 429, 'The restore limiter is still closed from an earlier run; retry after 15 minutes.')
  expect(first.status()).toBe(200)
  expect((await restore(request, session.profile.id, code)).status()).toBe(200)
})

test('AC 2.1.3 Same-device return: the stored installation credential restores the session without the recovery kit', async ({ request }) => {
  const session = await startProfile(request)
  await request.post(`${API_URL}/api/v1/profiles/me/recovery-setup/acknowledge`, { headers: session.headers })

  const bootstrap = await request.post(`${API_URL}/api/v1/profiles/bootstrap`, { data: { installationToken: session.installationToken } })
  expect(bootstrap.status()).toBe(200)
  const returned = await bootstrap.json() as { accessToken: string; profile: { id: string }; recoverySetupRequired: boolean }
  expect(returned.profile.id).toBe(session.profile.id)
  expect(returned.recoverySetupRequired).toBe(false)
  // Opaque server-issued credential: it works, and an unknown secret gets nothing.
  const mine = await request.get(`${API_URL}/api/v1/reports/mine`, { headers: { Authorization: `Bearer ${returned.accessToken}` } })
  expect(mine.status()).toBe(200)
  const unknown = await request.post(`${API_URL}/api/v1/profiles/bootstrap`, { data: { installationToken: newInstallationToken() } })
  expect(unknown.ok()).toBe(false)
})

// Runs its lockout last: five failures close restore for this address for 15
// minutes, so every assertion that needs a working restore comes first.
test('AC 2.1.4 Cross-device restoration: ID and code together restore only that identity, failures are generic and limited to five', async ({ request, browser }) => {
  const owner = await startProfile(request)
  const submitted = await submitReport(request, owner, { photo: await makeJpeg(browser), location: isolatedPoint() })
  const report = await waitForScreening(request, owner, (await submitted.response.json() as { id: string }).id)
  const bystander = await startProfile(request)
  await submitReport(request, bystander, { photo: await makeJpeg(browser), location: isolatedPoint() })

  const restored = await restore(request, owner.profile.id, owner.recoveryCodes[0])
  test.skip(restored.status() === 429, 'The restore limiter is still closed from an earlier run; retry after 15 minutes.')
  expect(restored.status()).toBe(200)
  const session = await restored.json() as { accessToken: string; profile: { id: string } }
  expect(session.profile.id).toBe(owner.profile.id)
  expect(session.accessToken).not.toBe(owner.accessToken)
  const history = await request.get(`${API_URL}/api/v1/reports/mine`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
  expect((await history.json() as { items: { id: string }[] }).items.map((item) => item.id)).toEqual([report.id])

  // The public ID alone is not enough.
  const idOnly = await request.post(`${API_URL}/api/v1/profiles/restore`, {
    data: { profileId: owner.profile.id, installationToken: newInstallationToken() },
  })
  expect(idOnly.ok()).toBe(false)

  // A wrong code and an unknown profile are indistinguishable.
  const wrongCode = await restore(request, owner.profile.id, 'A'.repeat(32))
  const unknownProfile = await restore(request, 'ZZZZ99', owner.recoveryCodes[0])
  expect(wrongCode.status()).toBe(400)
  expect(unknownProfile.status()).toBe(400)
  const generic = (body: { code: string; detail: string }) => ({ code: body.code, detail: body.detail })
  expect(generic(await wrongCode.json())).toEqual(generic(await unknownProfile.json()))

  // Two failures so far; three more reach five, and the next attempt is refused
  // before any work is done - even with the correct code.
  for (let attempt = 3; attempt <= 5; attempt++) {
    expect((await restore(request, owner.profile.id, 'B'.repeat(32))).status()).toBe(400)
  }
  const locked = await restore(request, owner.profile.id, owner.recoveryCodes[0])
  expect(locked.status()).toBe(429)
  expect(Number(locked.headers()['retry-after'])).toBeGreaterThan(0)
})

test('AC 3.3.1 Three state location result: the location-context API takes latitude, longitude and accuracy and returns one state with its source fields', async ({ request }) => {
  const session = await startProfile(request)
  const response = await request.post(`${API_URL}/api/v1/location-context`, {
    headers: session.headers, data: { latitude: 3.1497, longitude: 101.6412, accuracyM: 15 },
  })
  expect(response.status()).toBe(200)
  const context = await response.json() as Record<string, unknown>
  expect(['inside_protected_area', 'no_protected_area_intersection', 'boundary_uncertain']).toContain(context.contextState)
  for (const field of ['boundarySource', 'boundaryVersion', 'accuracyM', 'actionEligible', 'disclaimer']) {
    expect(context).toHaveProperty(field)
  }
})

test('AC 3.3.4 Uncertain or unavailable boundary: poor accuracy or missing boundary data is uncertain and never treated as outside', async ({ request }) => {
  const session = await startProfile(request)
  const ask = async (data: Record<string, number>) => {
    const response = await request.post(`${API_URL}/api/v1/location-context`, { headers: session.headers, data })
    expect(response.status()).toBe(200)
    return await response.json() as { contextState: string; actionEligible: boolean; insideProtectedArea: boolean | null; disclaimer: string }
  }
  // Accuracy worse than 250 m.
  const vague = await ask({ latitude: 3.1497, longitude: 101.6412, accuracyM: 900 })
  expect(vague).toMatchObject({ contextState: 'boundary_uncertain', actionEligible: false, insideProtectedArea: null })
  expect(vague.disclaimer).toMatch(/observe and report only/i)
  // Outside dataset coverage: open sea well away from any mapped boundary.
  const offshore = await ask({ latitude: 5.9, longitude: 105.5, accuracyM: 15 })
  expect(offshore).toMatchObject({ contextState: 'boundary_uncertain', actionEligible: false })
})

test('AC 3.3.2, AC 3.3.3, AC 3.3.5 Protected-area intersection and source details come from the imported boundary release', async ({ request }) => {
  const ready = await (await request.get(`${API_URL}/health/ready`)).json() as { geospatialData: { protectedAreas: number } }
  // A plain Compose stack has no protected-area import (the regional extract is
  // kept out of git), and without polygons there is nothing to intersect.
  test.skip(ready.geospatialData.protectedAreas === 0, 'No protected-area import in this environment - run the geospatial import to cover this path.')

  const session = await startProfile(request)
  const ask = async (latitude: number, longitude: number) => {
    const response = await request.post(`${API_URL}/api/v1/location-context`, {
      headers: session.headers, data: { latitude, longitude, accuracyM: 15 },
    })
    return await response.json() as {
      contextState: string; actionEligible: boolean; protectedAreaName: string | null
      boundarySource: string | null; boundaryVersion: string | null; accuracyM: number; disclaimer: string
    }
  }
  // Inside Taman Negara.
  const inside = await ask(4.5, 102.45)
  expect(inside).toMatchObject({ contextState: 'inside_protected_area', actionEligible: false })
  expect(inside.protectedAreaName).toBeTruthy()
  // Central Kuala Lumpur, away from any gazetted area.
  const outside = await ask(3.1466, 101.6958)
  expect(outside.contextState).toBe('no_protected_area_intersection')
  for (const context of [inside, outside]) {
    expect(context.boundarySource).toBeTruthy()
    expect(context.boundaryVersion).toBeTruthy()
    expect(context.accuracyM).toBe(15)
    expect(context.disclaimer).toMatch(/not removal permission/i)
  }
})

test('AC 4.3.1 Nearest-feature lookup: the nearest named feature within 5 km is found by distance and stored with the sighting', async ({ request, browser }) => {
  const session = await startProfile(request)
  const lookup = async (lat: number, lon: number) => {
    const response = await request.get(`${API_URL}/api/v1/location-context`, {
      headers: session.headers, params: { lat, lon, radius_m: 5000 },
    })
    expect(response.status()).toBe(200)
    return await response.json() as { found: boolean; featureType: string | null; featureName: string | null; distanceM: number | null }
  }
  const here = await lookup(3.1497, 101.6412)
  test.skip(!here.found, 'No named places are seeded in this environment.')
  expect(['path', 'footway', 'track', 'trail', 'park', 'forest', 'wood']).toContain(here.featureType)
  expect(here.featureName).toBeTruthy()
  expect(here.distanceM).toBeLessThanOrEqual(5000)
  // Distance is geospatial: a kilometre further north changes it by about a kilometre.
  const further = await lookup(3.1497 + 1000 / 111_320, 101.6412)
  if (further.featureName === here.featureName) {
    expect(Math.abs(further.distanceM! - here.distanceM!)).toBeGreaterThan(300)
    expect(Math.abs(further.distanceM! - here.distanceM!)).toBeLessThan(1100)
  }

  // The stored sighting carries the same feature and keeps its own coordinates.
  const point = { lat: 3.1497 + Math.random() * 0.0005, lng: 101.6412 + Math.random() * 0.0005 }
  const submitted = await submitReport(request, session, { photo: await makeJpeg(browser), location: point })
  const report = await waitForScreening(request, session, (await submitted.response.json() as { id: string }).id)
  expect(['screened', 'merged']).toContain(report.status)
  expect((report.submission as { location: { lat: number; lng: number } }).location.lat).toBeCloseTo(point.lat, 5)
  const sighting = await (await request.get(`${API_URL}/api/v1/sightings/${report.sightingId}`)).json() as {
    nearestFeatureType: string | null; nearestFeatureName: string | null; nearestFeatureDistanceM: number | null
  }
  expect(sighting.nearestFeatureName).toBe(here.featureName)
  expect(sighting.nearestFeatureType).toBe(here.featureType)
  expect(sighting.nearestFeatureDistanceM).toBeLessThanOrEqual(5000)
})

test('AC 4.3.2 No-result fallback: with no named feature within 5 km the lookup says so and the report still publishes', async ({ request, browser }) => {
  const session = await startProfile(request)
  // Interior Pahang, far from every seeded featured place.
  const remote = { lat: 4.05 + Math.random() * 0.01, lng: 102.9 + Math.random() * 0.01 }
  const response = await request.get(`${API_URL}/api/v1/location-context`, {
    headers: session.headers, params: { lat: remote.lat, lon: remote.lng, radius_m: 5000 },
  })
  const context = await response.json() as { found: boolean; featureName: string | null }
  test.skip(context.found, 'This environment has a full OSM import, so the chosen point has a named feature nearby.')
  expect(context).toMatchObject({ found: false, featureName: null })

  const submitted = await submitReport(request, session, { photo: await makeJpeg(browser), location: remote })
  expect(submitted.response.status()).toBe(201)
  const report = await waitForScreening(request, session, (await submitted.response.json() as { id: string }).id)
  expect(report.status).toBe('screened')
  const sighting = await (await request.get(`${API_URL}/api/v1/sightings/${report.sightingId}`)).json() as { nearestFeatureName: string | null }
  expect(sighting.nearestFeatureName).toBeNull()
})
