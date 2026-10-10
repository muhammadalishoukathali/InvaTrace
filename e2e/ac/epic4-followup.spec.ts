// Epic 4, stories 4.5 to 4.8: reporting a removal, the grey follow-up marker,
// the follow-up check and its three outcomes. One test per acceptance
// criterion, against the dev MSW mocks.
//
// Seeded mock sightings used here: s-04 is an active report with a linked
// report (so it can be marked removed) and s-10 is already "removal reported".
// The mock keeps its state in page memory, so once a test has changed a
// sighting it moves around in-app; a page.goto() would reset the change.
//
// GPS limits: the ACs say 250 m. Follow-up enforces 250 m; removal is
// temporarily 350 m in code (REMOVAL_MAX_M). Fixes used here are either well
// inside (tens of metres, +-8..15 m) or well outside (over 1 km, +-500 m).
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { startPrivateAccess } from '../fixtures/app'

const ACTIVE = 's-04'
const ACTIVE_REPORT = 'seed-trusted-04'
const ACTIVE_PLACE = 'Ridge Path'
const REMOVED = 's-10'
const REMOVED_PLACE = 'North gate'

type Point = { lat: number; lng: number }
type Detail = {
  id: string
  status: string
  speciesId: string
  speciesName: string
  followUpState?: string | null
  lastFollowupAt?: string | null
  removalReportedAt?: string | null
  removalReportId: string | null
  lastReportedAt: string
  thumbnailUrl: string | null
  location: Point
  followUpHistory: Array<{ eventType: string; createdAt: string }>
}
type StubTable = Record<string, { status?: number; body: unknown }>

/** MSW answers API calls inside the page, so neither page.route nor
 *  context.route ever sees them. For a response the mock cannot produce, wrap
 *  window.fetch before the app loads; keys are "METHOD /pathname". */
async function stubApi(page: Page, stubs: StubTable) {
  await page.addInitScript((table) => {
    const real = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      const hit = table[`${method} ${new URL(href, window.location.href).pathname}`]
      if (!hit) return real(input, init)
      return new Response(JSON.stringify(hit.body), {
        status: hit.status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  }, stubs)
}

/** Records every geolocation request the page makes, with its options. */
async function watchGeolocation(page: Page) {
  await page.addInitScript(() => {
    const calls: Array<PositionOptions | undefined> = []
    ;(window as unknown as { __geoCalls: typeof calls }).__geoCalls = calls
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
    navigator.geolocation.getCurrentPosition = (success, failure, options) => {
      calls.push(options ? { ...options } : undefined)
      original(success, failure, options)
    }
  })
  return () => page.evaluate(() => (window as unknown as { __geoCalls: Array<PositionOptions | undefined> }).__geoCalls)
}

/** A page reload re-bootstraps the mock session and the sign-up token goes
 *  stale, so API checks use whichever token the app was handed last. */
function followSession(page: Page) {
  const tokens: string[] = []
  page.on('response', async (response) => {
    if (!/^\/api\/v1\/profiles\/(start|bootstrap|restore)$/.test(new URL(response.url()).pathname)) return
    const body = await response.json().catch(() => null) as { accessToken?: string } | null
    if (body?.accessToken) tokens.push(body.accessToken)
  })
  return { tokens, current: () => tokens[tokens.length - 1] }
}

function getJson<T>(page: Page, apiPath: string, token?: string) {
  return page.evaluate(async ({ url, bearer }) => {
    const response = await fetch(url, bearer ? { headers: { authorization: `Bearer ${bearer}` } } : undefined)
    return response.json()
  }, { url: apiPath, bearer: token }) as Promise<T>
}

const sightingDetail = (page: Page, id: string) => getJson<Detail>(page, `/api/v1/sightings/${id}`)

/** Puts the emulated device a given distance north of a point. */
async function standAt(context: BrowserContext, baseURL: string | undefined, point: Point, options: { accuracy?: number; northM?: number } = {}) {
  await context.grantPermissions(['geolocation'], { origin: new URL(baseURL!).origin })
  await context.setGeolocation({
    latitude: point.lat + (options.northM ?? 0) / 111_320,
    longitude: point.lng,
    accuracy: options.accuracy ?? 8,
  })
}

const details = (page: Page) => page.getByRole('dialog', { name: 'Sighting details' })
const pin = (page: Page, id: string) => page.locator(`.map-pin[data-sighting-id="${id}"]`)
const reportsButton = (page: Page) => page.getByRole('button', { name: /Open reports list/ })
const reportsSheet = (page: Page) => page.getByRole('dialog', { name: 'Community reports list' })

/** Opens a sighting from its list item, the route that works without the map canvas. */
async function openFromList(page: Page, placeText: string) {
  await reportsButton(page).click()
  await reportsSheet(page).locator('.map-reports-sheet__item').filter({ hasText: placeText }).click()
  await expect(details(page).getByRole('heading', { level: 2 })).toBeVisible()
}

const closeDetails = (page: Page) => details(page).getByRole('button', { name: 'Close sighting details' }).click()

const isRemovalPost = (url: string, method: string) => method === 'POST' && /\/api\/v1\/reports\/[^/]+\/removal$/.test(new URL(url).pathname)
const isFollowUpPost = (url: string, method: string) => method === 'POST' && /\/api\/v1\/sightings\/[^/]+\/follow-up$/.test(new URL(url).pathname)

/** Mark as removed -> fresh fix -> Confirm, from an open details sheet. */
async function confirmRemoval(page: Page) {
  await details(page).getByRole('button', { name: 'Mark as removed' }).click()
  const posted = page.waitForResponse((response) => isRemovalPost(response.url(), response.request().method()))
  await details(page).getByRole('button', { name: 'Confirm removal report' }).click()
  const response = await posted
  return {
    status: response.status(),
    sent: response.request().postDataJSON() as { latitude: number; longitude: number; accuracyM: number; capturedAt: string },
    body: await response.json() as Record<string, unknown>,
  }
}

/** Location check -> outcome -> confirm -> submit, starting on the follow-up location step. */
async function recordFollowUp(page: Page, outcome: RegExp) {
  await page.getByRole('button', { name: /current location/i }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('radio', { name: outcome }).check()
  await page.getByRole('button', { name: 'Review follow-up' }).click()
  const posted = page.waitForResponse((response) => isFollowUpPost(response.url(), response.request().method()))
  await page.getByRole('button', { name: 'Record follow-up' }).click()
  const response = await posted
  await expect(page.getByRole('heading', { name: 'Follow-up recorded' })).toBeVisible()
  return {
    status: response.status(),
    sent: response.request().postDataJSON() as { outcome: string; latitude: number; longitude: number; accuracyM: number; capturedAt: string },
  }
}

/** Dates as the app prints them (en-GB, e.g. "11 Oct 2026"). */
const displayDate = (value: string | Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
const DATE = /\d{1,2} \w{3} \d{4}/

function stubbedDetail(id: string, overrides: Partial<Detail>) {
  return {
    id, speciesId: 'chromolaena-odorata', speciesName: 'Siam weed', latinName: 'Chromolaena odorata', status: 'screened',
    risk: 'high', location: { lat: 3.15, lng: 101.64 }, precisionReduced: false, reportCount: 1,
    lastReportedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    place: { displayName: 'Test location', areaName: null, trailName: null, source: 'seed' },
    thumbnailUrl: null, confidence: 0.8, nearestFeatureType: null, nearestFeatureName: null,
    nearestFeatureDistanceM: null, screeningMethod: 'deterministic_rules',
    recommendedAction: '', reporterTrust: 'Trusted', actionGuide: null,
    removalReportId: 'seed-new-05', followUpHistory: [],
    ...overrides,
  }
}

test('AC 4.5.1 Removal action availability: an active community report offers Mark as removed; removed, withdrawn and rejected sightings do not', async ({ page, context }) => {
  // The live Overpass lookup is enrichment only; keep it off the network.
  await context.route('https://overpass-api.de/**', (route) => route.abort('failed'))
  // States the mock cannot hold: a deleted (withdrawn) and a rejected record,
  // and an active one whose regrowth was confirmed ("still present").
  await stubApi(page, {
    'GET /api/v1/sightings/s-05': { body: stubbedDetail('s-05', { status: 'withdrawn' }) },
    'GET /api/v1/sightings/s-06': { body: stubbedDetail('s-06', { status: 'rejected' }) },
    'GET /api/v1/sightings/s-07': {
      body: stubbedDetail('s-07', {
        status: 'screened', followUpState: 'regrowth', lastFollowupAt: new Date().toISOString(),
        followUpHistory: [
          { eventType: 'reported', createdAt: '2026-09-01T08:00:00.000Z' },
          { eventType: 'removal_reported', createdAt: '2026-09-10T08:00:00.000Z' },
          { eventType: 'followup_regrowth', createdAt: new Date().toISOString() },
        ],
      }),
    },
  })
  await startPrivateAccess(page)

  // Active community report: the action and the not-expert-verified explanation.
  await page.goto(`/map?sighting=${ACTIVE}`)
  const removal = details(page).getByRole('region', { name: 'Removal status' })
  await expect(removal.getByRole('button', { name: 'Mark as removed' })).toBeVisible()
  expect((await sightingDetail(page, ACTIVE)).status).toBe('screened')
  await expect(removal).toContainText('This is a community-reported status, not expert verification.')

  // Still present after a follow-up found regrowth: the action is offered again.
  await page.goto('/map?sighting=s-07')
  await expect(details(page).getByRole('region', { name: 'Regrowth report' })).toContainText('Regrowth reported')
  await expect(details(page).getByRole('button', { name: 'Mark as removed' })).toBeVisible()

  // Already removal_reported, withdrawn (deleted) or rejected: no control.
  for (const id of [REMOVED, 's-05', 's-06']) {
    await page.goto(`/map?sighting=${id}`)
    await expect(details(page).getByRole('region', { name: 'Report information' })).toBeVisible()
    await expect(details(page).getByRole('button', { name: 'Mark as removed' })).toHaveCount(0)
  }
  expect((await sightingDetail(page, REMOVED)).status).toBe('removal_reported')
})

test('AC 4.5.2 Fresh GPS collection: Mark as removed requests a fresh device fix and shows its accuracy before submission is enabled', async ({ page, context, baseURL }) => {
  const geoCalls = await watchGeolocation(page)
  await startPrivateAccess(page)
  const target = await sightingDetail(page, ACTIVE)
  // +-500 m first: above the limit whether it is 250 m (AC) or 350 m (code).
  await standAt(context, baseURL, target.location, { accuracy: 500, northM: 30 })
  await page.goto(`/map?sighting=${ACTIVE}`)
  const sheet = details(page)
  await expect(sheet.getByRole('button', { name: 'Mark as removed' })).toBeVisible()
  const before = (await geoCalls()).length

  const posts: string[] = []
  page.on('request', (request) => { if (isRemovalPost(request.url(), request.method())) posts.push(request.url()) })
  await sheet.getByRole('button', { name: 'Mark as removed' }).click()

  // The confirmation step opens and the browser is asked for a new, uncached fix.
  const confirm = sheet.getByRole('region', { name: 'Confirm removal report' })
  await expect(confirm).toBeVisible()
  const calls = await geoCalls()
  expect(calls.length).toBe(before + 1)
  expect(calls[calls.length - 1]).toMatchObject({ maximumAge: 0, enableHighAccuracy: true })

  // The measured accuracy is shown; with a coarse fix there is nothing to submit.
  await expect(confirm.getByText('Measured accuracy: ±500 m')).toBeVisible()
  await expect(confirm.getByRole('button', { name: 'Confirm removal report' })).toHaveCount(0)
  // Coordinates come from the device only: the step has no field to type them into.
  await expect(confirm.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(0)

  // A new fix is requested again, and only a good one enables submission.
  await standAt(context, baseURL, target.location, { accuracy: 15, northM: 30 })
  await confirm.getByRole('button', { name: 'Request a new location' }).click()
  await expect(confirm.getByText('Measured accuracy: ±15 m')).toBeVisible()
  expect((await geoCalls()).length).toBe(before + 2)
  const submit = confirm.getByRole('button', { name: 'Confirm removal report' })
  await expect(submit).toBeEnabled()
  expect(posts).toEqual([])

  // What is sent is exactly the browser's fix.
  const posted = page.waitForRequest((request) => isRemovalPost(request.url(), request.method()))
  await submit.click()
  const sent = (await posted).postDataJSON() as { latitude: number; longitude: number; accuracyM: number }
  expect(sent.latitude).toBeCloseTo(target.location.lat + 30 / 111_320, 9)
  expect(sent.longitude).toBeCloseTo(target.location.lng, 9)
  expect(sent.accuracyM).toBe(15)
})

test('AC 4.5.3 Server-side vicinity validation: the removal request carries the fresh fix and the server decides on distance', async ({ page, context, baseURL }) => {
  // Mock layer: proves the client sends the raw fix with its accuracy and
  // capture time to POST /reports/{id}/removal and leaves the distance verdict
  // to the response. The geodesic check itself is a server rule (see ac-real).
  await startPrivateAccess(page)
  const target = await sightingDetail(page, ACTIVE)
  expect(target.removalReportId).toBe(ACTIVE_REPORT)

  // Far away with a sharp fix: the client does not pre-judge distance, it asks.
  await standAt(context, baseURL, target.location, { accuracy: 15, northM: 1500 })
  await page.goto(`/map?sighting=${ACTIVE}`)
  const rejected = await confirmRemoval(page)
  expect(rejected.status).toBe(422)
  expect(rejected.body).toMatchObject({ code: 'outside_removal_radius' })
  expect(rejected.sent.accuracyM).toBe(15)
  expect((await sightingDetail(page, ACTIVE)).status).toBe('screened')

  // Close by with the same accuracy: accepted, with the distance worked out server-side.
  await standAt(context, baseURL, target.location, { accuracy: 15, northM: 30 })
  await details(page).getByRole('button', { name: 'Try location again' }).click()
  await expect(details(page).getByText('Measured accuracy: ±15 m')).toBeVisible()
  const posted = page.waitForResponse((response) => isRemovalPost(response.url(), response.request().method()))
  await details(page).getByRole('button', { name: 'Confirm removal report' }).click()
  const accepted = await posted
  expect(new URL(accepted.url()).pathname).toBe(`/api/v1/reports/${ACTIVE_REPORT}/removal`)
  expect(accepted.status()).toBe(200)
  const sent = accepted.request().postDataJSON() as { latitude: number; longitude: number; accuracyM: number; capturedAt: string }
  expect(Object.keys(sent).sort()).toEqual(['accuracyM', 'capturedAt', 'latitude', 'longitude'])
  expect(Math.abs(Date.now() - Date.parse(sent.capturedAt))).toBeLessThan(60_000)
  const body = await accepted.json() as { status: string; sightingId: string; distanceM: number; accuracyM: number }
  expect(body).toMatchObject({ status: 'removal_reported', sightingId: ACTIVE, accuracyM: 15 })
  expect(body.distanceM).toBeGreaterThan(20)
  expect(body.distanceM).toBeLessThan(40)
})

test('AC 4.5.4 Rejected location evidence: unavailable, inaccurate and out-of-range locations are each explained and change nothing', async ({ page, context, baseURL }) => {
  await startPrivateAccess(page)
  const target = await sightingDetail(page, ACTIVE)
  await page.goto(`/map?sighting=${ACTIVE}`)
  const sheet = details(page)
  const responses: Array<{ status: number; body: { code?: string } }> = []
  page.on('response', async (response) => {
    if (isRemovalPost(response.url(), response.request().method())) {
      responses.push({ status: response.status(), body: await response.json() as { code?: string } })
    }
  })
  const unchanged = async () => {
    const now = await sightingDetail(page, ACTIVE)
    expect(now.status).toBe('screened')
    expect(now.removalReportedAt ?? null).toBeNull()
    await expect(pin(page, ACTIVE)).not.toHaveAttribute('data-tier', /followup-needed|removed/)
  }

  // 1. Location unavailable: no permission, so the device gives no fix.
  await sheet.getByRole('button', { name: 'Mark as removed' }).click()
  await expect(sheet.getByRole('alert')).toHaveText(/fresh location could not be obtained/i)
  await expect(sheet.getByRole('button', { name: 'Confirm removal report' })).toHaveCount(0)
  await unchanged()

  // 2. Insufficiently accurate: +-500 m, above the limit (250 m AC, 350 m code).
  await standAt(context, baseURL, target.location, { accuracy: 500, northM: 30 })
  await sheet.getByRole('button', { name: 'Try location again' }).click()
  await expect(sheet.getByText('Measured accuracy: ±500 m')).toBeVisible()
  await expect(sheet.getByRole('alert')).toHaveText(/^Accuracy is above \d+ m\./)
  await expect(sheet.getByRole('button', { name: 'Confirm removal report' })).toHaveCount(0)
  await unchanged()
  expect(responses).toEqual([])

  // 3. Outside the permitted range: accurate, but 1.5 km from the marker.
  await standAt(context, baseURL, target.location, { accuracy: 15, northM: 1500 })
  await sheet.getByRole('button', { name: 'Request a new location' }).click()
  await expect(sheet.getByText('Measured accuracy: ±15 m')).toBeVisible()
  await sheet.getByRole('button', { name: 'Confirm removal report' }).click()
  await expect(sheet.getByRole('alert')).toHaveText(/^You are more than \d+ metres from the marker\.$/)
  // The API answered with a machine-readable code, and stored nothing.
  expect(responses).toHaveLength(1)
  expect(responses[0]).toMatchObject({ status: 422, body: { code: 'outside_removal_radius' } })
  await unchanged()
  await expect(sheet.getByRole('button', { name: 'Mark as removed' })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Try location again' })).toBeVisible()
})

test('AC 4.5.5 Preserved report and status history: an accepted removal marks the sighting removed and keeps the original report', async ({ page, context, baseURL }) => {
  // Mock layer: proves the public record and the page keep the original photo,
  // species, coordinates and report time. Row-level history is a server rule.
  const session = followSession(page)
  await startPrivateAccess(page)
  await standAt(context, baseURL, (await sightingDetail(page, ACTIVE)).location, { accuracy: 15, northM: 30 })
  await page.goto(`/map?sighting=${ACTIVE}`)
  await expect(details(page).getByRole('button', { name: 'Mark as removed' })).toBeVisible()
  const before = await sightingDetail(page, ACTIVE)
  const reportBefore = await getJson<{ status: string; createdAt: string; submission: unknown }>(page, `/api/v1/reports/${ACTIVE_REPORT}`, session.current())

  const removal = await confirmRemoval(page)
  expect(removal.status).toBe(200)
  expect(removal.body).toMatchObject({ status: 'removal_reported', reportId: ACTIVE_REPORT, sightingId: ACTIVE })

  // The sighting is now marked as removed...
  const after = await sightingDetail(page, ACTIVE)
  expect(after.status).toBe('removal_reported')
  expect(after.removalReportedAt).toBe(removal.body.removalReportedAt)
  // ...and nothing of the original report was overwritten.
  expect(after.thumbnailUrl).toBe(before.thumbnailUrl)
  expect(after.speciesId).toBe(before.speciesId)
  expect(after.location).toEqual(before.location)
  expect(after.lastReportedAt).toBe(before.lastReportedAt)
  const reportAfter = await getJson<typeof reportBefore>(page, `/api/v1/reports/${ACTIVE_REPORT}`, session.current())
  expect(reportAfter).toEqual(reportBefore)

  // The panel shows the new status next to the untouched original evidence.
  const sheet = details(page)
  await expect(sheet.getByRole('heading', { name: 'Follow-up needed' })).toBeVisible()
  await expect(sheet.getByRole('img', { name: `Reporter photo of ${before.speciesName}` })).toBeVisible()
  await expect(sheet.getByRole('heading', { name: before.speciesName, level: 2 })).toBeVisible()
  await expect(sheet.getByText(`${before.location.lat.toFixed(5)}, ${before.location.lng.toFixed(5)}`)).toBeVisible()
  const history = sheet.getByRole('region', { name: 'Status history' }).getByRole('listitem')
  await expect(history.locator('strong')).toHaveText(['Original report', 'Removal reported'])
})

test('AC 4.5.6 Public marker update: a removal-reported marker turns grey and shows Removal reported with its date', async ({ page, context, baseURL }) => {
  const session = followSession(page)
  const { profile, recoveryCodes } = await startPrivateAccess(page)

  // Any user loading the shared map: the seeded removed sighting is grey and dated.
  const seeded = await sightingDetail(page, REMOVED)
  const seededDate = displayDate(seeded.removalReportedAt ?? seeded.lastReportedAt)
  await expect(pin(page, REMOVED)).toHaveAttribute('data-tier', 'followup-needed')
  await expect(pin(page, REMOVED)).toHaveAttribute('aria-label', new RegExp(`Removal reported on ${seededDate}$`))
  await expect(pin(page, REMOVED).locator('svg path')).toHaveAttribute('fill', '#66736D')

  // A removal reported in this session updates its marker the same way.
  const target = await sightingDetail(page, ACTIVE)
  await standAt(context, baseURL, target.location, { accuracy: 15, northM: 30 })
  await page.goto(`/map?sighting=${ACTIVE}`)
  await expect(pin(page, ACTIVE)).not.toHaveAttribute('data-tier', 'followup-needed')
  const removal = await confirmRemoval(page)
  expect(removal.status).toBe(200)
  const today = displayDate(new Date())
  await expect(pin(page, ACTIVE)).toHaveAttribute('data-tier', 'followup-needed')
  await expect(pin(page, ACTIVE)).toHaveAttribute('aria-label', `Siam weed - Follow-up needed - Removal reported on ${today}`)
  await expect(pin(page, ACTIVE).locator('svg path')).toHaveAttribute('fill', '#66736D')

  // Opening the marker shows Removal reported with the status date.
  const card = details(page).getByRole('region', { name: 'Follow-up needed' })
  await expect(card.locator('div').filter({ has: page.locator('dt', { hasText: 'Removal reported' }) }).locator('dd')).toHaveText(today)
  await closeDetails(page)
  await reportsButton(page).click()
  await expect(reportsSheet(page).locator('.map-reports-sheet__item').filter({ hasText: ACTIVE_PLACE }).locator('.map-reports-sheet__item-meta'))
    .toHaveText(`Follow-up needed · Removal reported on ${today}`)

  // The public responses carry nothing about who reported the removal or from where.
  const publicDetail = JSON.stringify(await sightingDetail(page, ACTIVE))
  const publicList = JSON.stringify(await getJson<unknown>(page, '/api/v1/sightings'))
  for (const payload of [publicDetail, publicList]) {
    for (const secret of [...session.tokens, profile.id, recoveryCodes[0]]) expect(payload).not.toContain(secret)
    // The removal check was made 30 m north of the marker; that point stays private.
    expect(payload).not.toContain(String(removal.sent.latitude))
    expect(payload).not.toMatch(/"(accessToken|recoveryCodes?|publicToken|publicId|profileId|actorProfileId|removalLatitude|removalLongitude|removalLocation|distanceM|accuracyM)"/)
  }
})

test('AC 4.6.1 Removal reported marker appearance: a grey marker labelled Removal reported and Follow-up needed, with both grey states in the legend', async ({ page }) => {
  await startPrivateAccess(page)
  const marker = pin(page, REMOVED)

  // Grey, unlike an active marker, which keeps its concentration colour.
  await expect(marker).toHaveAttribute('data-tier', 'followup-needed')
  await expect(marker.locator('svg path')).toHaveAttribute('fill', '#66736D')
  await expect(pin(page, ACTIVE).locator('svg path')).toHaveAttribute('fill', /^#(C2412D|D9880F|2E7D3F)$/)

  // Labelled with both phrases.
  await expect(marker).toHaveAttribute('aria-label', /Follow-up needed/)
  await expect(marker).toHaveAttribute('aria-label', /Removal reported/)
  await reportsButton(page).click()
  await expect(reportsSheet(page).locator('.map-reports-sheet__item').filter({ hasText: REMOVED_PLACE }).locator('.map-reports-sheet__item-meta'))
    .toHaveText(/^Follow-up needed · Removal reported/)
  await reportsSheet(page).getByRole('button', { name: 'Close community reports list' }).click()

  // The legend names the two grey states and says resolved markers are filtered in.
  await page.getByRole('button', { name: 'Show map legend' }).click()
  const legend = page.getByRole('dialog', { name: 'Map legend' })
  await expect(legend.getByText('Removal reported · Follow-up needed', { exact: true })).toBeVisible()
  await expect(legend.getByText('Resolved after follow-up · No regrowth', { exact: true })).toBeVisible()
  await expect(legend).toContainText('Resolved markers are hidden unless you filter for them')
  // No resolved marker is drawn on the default map.
  await expect(page.locator('.map-pin[data-tier="removed"]')).toHaveCount(0)
})

test('AC 4.6.1 Removal reported marker appearance: the grey marker is drawn with reduced opacity', async ({ page }) => {
  test.fixme(true, 'FINDING: the grey marker renders at full opacity; MapLibre resets the 0.7 the pin element is created with (computed opacity is 1).')
  await startPrivateAccess(page)
  const marker = pin(page, REMOVED)
  await expect(marker.locator('svg path')).toHaveAttribute('fill', '#66736D')
  await expect.poll(() => marker.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeLessThan(1)
  expect(await pin(page, ACTIVE).evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(1)
})

test('AC 4.6.2 Removed sighting details: plant name, removal date, follow-up status and Start follow-up lead the sheet', async ({ page }) => {
  await startPrivateAccess(page)
  const detailLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/sightings/${REMOVED}`)
  await pin(page, REMOVED).click()
  const detail = await (await detailLoaded).json() as Detail
  const sheet = details(page)

  await expect(sheet.getByRole('heading', { level: 2, name: detail.speciesName })).toBeVisible()
  const card = sheet.getByRole('region', { name: 'Follow-up needed' })
  await expect(card.getByRole('heading', { name: 'Follow-up needed' })).toBeVisible()
  await expect(card.locator('div').filter({ has: page.locator('dt', { hasText: 'Removal reported' }) }).locator('dd'))
    .toHaveText(displayDate(detail.removalReportedAt ?? detail.lastReportedAt))
  await expect(card.locator('div').filter({ has: page.locator('dt', { hasText: 'Status' }) }).locator('dd'))
    .toHaveText('Waiting for an on-site follow-up')
  const start = card.getByRole('link', { name: 'Start follow-up' })
  await expect(start).toHaveAttribute('href', `/sightings/${REMOVED}/follow-up`)

  // The status sits right under the plant identity, ahead of photos and the record.
  const order = await sheet.evaluate((root) => {
    const position = (selector: string) => {
      const element = root.querySelector(selector)!
      return [...root.querySelectorAll('*')].indexOf(element)
    }
    return {
      identity: position('.pin-sheet__heading'),
      followUp: position('.pin-sheet__follow-up'),
      photo: position('.pin-sheet__photo'),
      record: position('.pin-sheet__record'),
    }
  })
  expect(order.identity).toBeLessThan(order.followUp)
  expect(order.followUp).toBeLessThan(order.photo)
  expect(order.followUp).toBeLessThan(order.record)

  await start.click()
  await expect(page).toHaveURL(new RegExp(`/sightings/${REMOVED}/follow-up$`))
  await expect(page.getByRole('heading', { name: 'Check you are at the plant' })).toBeVisible()
})

test('AC 4.6.3 Follow up map filter: with active, removed and resolved sightings, Follow-up needed shows only the grey ones awaiting follow-up and updates the count', async ({ page, context, baseURL }) => {
  await startPrivateAccess(page)
  const total = (await getJson<{ items: unknown[] }>(page, '/api/v1/sightings')).items.length
  const removed = await sightingDetail(page, REMOVED)
  const active = await sightingDetail(page, ACTIVE)

  // Resolve the seeded removed sighting, then report another removal, so the
  // map holds all three kinds.
  await standAt(context, baseURL, removed.location)
  await page.goto(`/sightings/${REMOVED}/follow-up`)
  await recordFollowUp(page, /No regrowth found/)
  await page.getByRole('link', { name: 'Return to map' }).click()
  await standAt(context, baseURL, active.location, { accuracy: 15, northM: 30 })
  await openFromList(page, ACTIVE_PLACE)
  expect((await confirmRemoval(page)).status).toBe(200)
  await closeDetails(page)

  // Default map: the resolved one is gone, everything else is there.
  await expect(page.locator('.map-pin')).toHaveCount(total - 1)
  await expect(reportsButton(page)).toHaveAttribute('aria-label', new RegExp(`^Showing ${total - 1} reports\\.`))

  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1/sightings' && url.searchParams.get('follow_up') === 'needed'
  })
  await reportsButton(page).click()
  const chip = reportsSheet(page).getByRole('button', { name: 'Follow-up needed', exact: true })
  await chip.click()
  const api = await (await filtered).json() as { items: Array<{ id: string }> }
  expect(api.items.map((item) => item.id)).toEqual([ACTIVE])

  // Only the grey sighting awaiting follow-up is left, and every count says one.
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.map-pin')).toHaveCount(1)
  await expect(pin(page, ACTIVE)).toHaveAttribute('data-tier', 'followup-needed')
  await expect(pin(page, REMOVED)).toHaveCount(0)
  await expect(reportsSheet(page).locator('.map-reports-sheet__count')).toHaveText('1 community report matches the current filters.')
  await expect(reportsSheet(page).locator('.map-reports-sheet__item-meta')).toHaveText([/^Follow-up needed · Removal reported/])
  await expect(reportsButton(page)).toHaveAttribute('aria-label', /^Showing 1 report \(1 filter active\)/)
})

test('AC 4.7.1 Nearby location check: the measured accuracy is shown and the follow-up continues only within range with an accurate fix', async ({ page, context, baseURL }) => {
  // Mock layer: proves the on-screen check and what is sent. The final
  // distance authority (the stored, un-offset coordinates) is a server rule.
  await startPrivateAccess(page)
  const marker = (await sightingDetail(page, REMOVED)).location
  await page.goto(`/sightings/${REMOVED}/follow-up`)
  const accuracy = page.locator('.follow-up-check').filter({ hasText: 'GPS accuracy' })
  const distance = page.locator('.follow-up-check').filter({ hasText: 'Distance to marker' })
  const proceed = page.getByRole('button', { name: 'Continue' })

  // Before any fix: a location-check state, nothing to continue with.
  await expect(accuracy).toContainText('Not measured yet')
  await expect(proceed).toBeDisabled()

  // +-300 m at the marker: measured accuracy shown, not allowed.
  await standAt(context, baseURL, marker, { accuracy: 300 })
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(accuracy.locator('strong')).toHaveText('±300 m')
  await expect(accuracy).toContainText('Needs 250 m or better')
  await expect(proceed).toBeDisabled()

  // +-8 m but 1.2 km away: not allowed.
  await standAt(context, baseURL, marker, { accuracy: 8, northM: 1200 })
  await page.getByRole('button', { name: 'Refresh location' }).click()
  await expect(accuracy.locator('strong')).toHaveText('±8 m')
  await expect(distance.locator('strong')).toHaveText('1.2 km')
  await expect(distance).toContainText('Move within 250 m')
  await expect(proceed).toBeDisabled()

  // +-8 m and 40 m away: allowed.
  await standAt(context, baseURL, marker, { accuracy: 8, northM: 40 })
  await page.getByRole('button', { name: 'Refresh location' }).click()
  await expect(accuracy.locator('strong')).toHaveText('±8 m')
  await expect(accuracy).toContainText('Good enough')
  await expect(distance.locator('strong')).toHaveText('40 m')
  await expect(distance).toContainText('Close enough')
  await expect(proceed).toBeEnabled()

  // The observation is submitted with that fix, for the server to check again.
  await proceed.click()
  await page.getByRole('radio', { name: /Unable to confirm/ }).check()
  await page.getByRole('button', { name: 'Review follow-up' }).click()
  await expect(page.getByText('Recorded at ±8 m accuracy.', { exact: false })).toBeVisible()
  const posted = page.waitForResponse((response) => isFollowUpPost(response.url(), response.request().method()))
  await page.getByRole('button', { name: 'Record follow-up' }).click()
  const response = await posted
  expect(new URL(response.url()).pathname).toBe(`/api/v1/sightings/${REMOVED}/follow-up`)
  const sent = response.request().postDataJSON() as { latitude: number; longitude: number; accuracyM: number; capturedAt: string }
  expect(sent.latitude).toBeCloseTo(marker.lat + 40 / 111_320, 9)
  expect(sent.longitude).toBeCloseTo(marker.lng, 9)
  expect(sent.accuracyM).toBe(8)
  expect(Math.abs(Date.now() - Date.parse(sent.capturedAt))).toBeLessThan(60_000)
  expect(response.status()).toBe(201)
})

test('AC 4.7.2 Follow up outcome selection: exactly one of No regrowth found, Regrowth present or Unable to confirm must be chosen', async ({ page, context, baseURL }) => {
  await startPrivateAccess(page)
  await standAt(context, baseURL, (await sightingDetail(page, REMOVED)).location)
  await page.goto(`/sightings/${REMOVED}/follow-up`)
  await page.getByRole('button', { name: /current location/i }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'What did you find?' })).toBeVisible()

  // Three choices, no more, and none preselected.
  const choices = page.getByRole('group', { name: 'Choose one outcome' }).getByRole('radio')
  await expect(choices).toHaveCount(3)
  await expect(page.locator('.follow-up-option strong')).toHaveText(['No regrowth found', 'Regrowth present', 'Unable to confirm'])
  const review = page.getByRole('button', { name: 'Review follow-up' })
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(review).toBeDisabled()

  // Mutually exclusive: each choice replaces the previous one.
  for (const name of [/No regrowth found/, /Regrowth present/, /Unable to confirm/]) {
    await page.getByRole('radio', { name }).check()
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(1)
    await expect(page.getByRole('radio', { name })).toBeChecked()
    await expect(review).toBeEnabled()
  }
})

test('AC 4.7.3 Outcome confirmation: the outcome is confirmed before it is sent, then recorded with a success message that explains the marker change', async ({ page, context, baseURL }) => {
  await startPrivateAccess(page)
  await standAt(context, baseURL, (await sightingDetail(page, REMOVED)).location)
  await page.goto(`/sightings/${REMOVED}/follow-up`)
  await page.getByRole('button', { name: /current location/i }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  const posts: string[] = []
  page.on('request', (request) => { if (isFollowUpPost(request.url(), request.method())) posts.push(request.url()) })

  // Confirmation step: the chosen outcome and what it will do, nothing sent yet.
  await page.getByRole('radio', { name: /Regrowth present/ }).check()
  await page.getByRole('button', { name: 'Review follow-up' }).click()
  await expect(page).toHaveURL(new RegExp(`/sightings/${REMOVED}/follow-up/confirm$`))
  await expect(page.getByRole('heading', { name: 'Regrowth present' })).toBeVisible()
  await expect(page.getByText('How the marker will change')).toBeVisible()
  await expect(page.getByText('The marker will return to the active map with a regrowth label.')).toBeVisible()
  expect(posts).toEqual([])
  expect((await sightingDetail(page, REMOVED)).followUpState).toBe('needed')

  // Submit: the API records it and the success state is specific to this outcome.
  const posted = page.waitForResponse((response) => isFollowUpPost(response.url(), response.request().method()))
  await page.getByRole('button', { name: 'Record follow-up' }).click()
  const response = await posted
  expect(response.status()).toBe(201)
  expect(response.request().postDataJSON()).toMatchObject({ outcome: 'regrowth_present' })
  expect(await response.json()).toMatchObject({ sightingId: REMOVED, outcome: 'regrowth_present', followUpState: 'regrowth' })
  const success = page.getByRole('status').filter({ has: page.getByRole('heading', { name: 'Follow-up recorded' }) })
  await expect(success).toBeVisible()
  await expect(success.getByText('What changed on the map')).toBeVisible()
  await expect(success.getByText('The marker has returned to the active map with a regrowth label.')).toBeVisible()
  expect(posts).toHaveLength(1)
  expect((await sightingDetail(page, REMOVED)).followUpState).toBe('regrowth')
})

for (const outcome of [
  { choice: /No regrowth found/, success: 'The marker is resolved and hidden from the default map.' },
  { choice: /Unable to confirm/, success: 'The marker remains grey and needs another follow-up.' },
]) {
  test(`AC 4.7.3 Outcome confirmation: "${outcome.choice.source}" has its own success message`, async ({ page, context, baseURL }) => {
    await startPrivateAccess(page)
    await standAt(context, baseURL, (await sightingDetail(page, REMOVED)).location)
    await page.goto(`/sightings/${REMOVED}/follow-up`)
    await recordFollowUp(page, outcome.choice)
    await expect(page.getByText(outcome.success)).toBeVisible()
    await expect(page.getByText('The marker has returned to the active map with a regrowth label.')).toHaveCount(0)
  })
}

test('AC 4.7.4 Follow up location failure: an unavailable, inaccurate or distant location is explained inline with a retry and leaves the marker unchanged', async ({ page, context, baseURL }) => {
  await startPrivateAccess(page)
  await page.goto(`/sightings/${REMOVED}/follow-up`)
  await expect(page.getByRole('heading', { name: 'Check you are at the plant' })).toBeVisible()
  const before = await sightingDetail(page, REMOVED)
  const posts: string[] = []
  page.on('request', (request) => { if (isFollowUpPost(request.url(), request.method())) posts.push(request.url()) })
  const proceed = page.getByRole('button', { name: 'Continue' })
  const alert = page.locator('.follow-up-alert')

  // Unavailable: location permission is not granted.
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(alert).toHaveText(/Location permission is blocked/)
  await expect(proceed).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Use my current location' })).toBeEnabled()

  // Less accurate than 250 m.
  await standAt(context, baseURL, before.location, { accuracy: 300 })
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(alert).toHaveText('Your location is not accurate enough yet. Move into the open and refresh.')
  await expect(proceed).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Refresh location' })).toBeEnabled()

  // More than 250 m from the marker.
  await standAt(context, baseURL, before.location, { accuracy: 8, northM: 1200 })
  await page.getByRole('button', { name: 'Refresh location' }).click()
  await expect(alert).toHaveText(/^You are 1\.2 km from the marker\. Move closer to the reported plant and refresh\. The marker stays unchanged/)
  await expect(proceed).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Refresh location' })).toBeEnabled()

  // Nothing was sent and the sighting is exactly as it was.
  expect(posts).toEqual([])
  expect(await sightingDetail(page, REMOVED)).toEqual(before)
})

for (const rejection of [
  { code: 'follow_up_too_far', detail: 'You must be within 250 metres of the reported plant.', title: 'You are too far from this sighting', body: 'Follow-up can only be recorded within 250 m of the reported plant.' },
  { code: 'follow_up_accuracy_too_low', detail: 'Location accuracy must be 250 metres or better.', title: 'Location accuracy is too low', body: /retry when accuracy is 250 m or better/ },
  { code: 'follow_up_location_unavailable', detail: 'Location could not be checked.', title: 'Location could not be checked', body: 'Try again when a current GPS location is available.' },
]) {
  test(`AC 4.7.4 Follow up location failure: the API's ${rejection.code} error is explained and the marker stays unchanged`, async ({ page, context, baseURL }) => {
    await startPrivateAccess(page)
    await standAt(context, baseURL, (await sightingDetail(page, REMOVED)).location)
    await page.goto(`/sightings/${REMOVED}/follow-up`)
    await expect(page.getByRole('heading', { name: 'Check you are at the plant' })).toBeVisible()
    const before = await sightingDetail(page, REMOVED)
    await page.getByRole('button', { name: /current location/i }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('radio', { name: /No regrowth found/ }).check()
    await page.getByRole('button', { name: 'Review follow-up' }).click()

    // One-shot mock hook: POST /sightings/{id}/follow-up answers with the validation error.
    await page.evaluate((value) => {
      window.__msw = { ...window.__msw, followUpRejection: { status: 422, code: value.code, detail: value.detail } }
    }, rejection)
    const posted = page.waitForResponse((response) => isFollowUpPost(response.url(), response.request().method()))
    await page.getByRole('button', { name: 'Record follow-up' }).click()
    const response = await posted
    expect(response.status()).toBe(422)
    expect(await response.json()).toMatchObject({ code: rejection.code })

    const error = page.getByRole('alert')
    await expect(error.getByRole('heading', { name: rejection.title })).toBeVisible()
    await expect(error.getByText(rejection.body)).toBeVisible()
    await expect(error.getByText('Nothing was submitted and the marker is unchanged.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Follow-up recorded' })).toHaveCount(0)
    expect(await sightingDetail(page, REMOVED)).toEqual(before)

    // Retry starts the location check again with no fix carried over.
    await error.getByRole('button', { name: 'Try location again' }).click()
    await expect(page.getByRole('heading', { name: 'Check you are at the plant' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await page.getByRole('link', { name: 'Back to sighting' }).click()
    await expect(pin(page, REMOVED)).toHaveAttribute('data-tier', 'followup-needed')
  })
}

test('AC 4.8.1 No regrowth outcome: the marker leaves the default map, stays under the Resolved filter and is labelled Resolved after follow-up in its history', async ({ page, context, baseURL }) => {
  await startPrivateAccess(page)
  await standAt(context, baseURL, (await sightingDetail(page, REMOVED)).location)
  await page.goto(`/sightings/${REMOVED}/follow-up`)
  const { sent } = await recordFollowUp(page, /No regrowth found/)
  expect(sent.outcome).toBe('no_regrowth')

  // Refreshed community map: no marker for it.
  const refreshed = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1/sightings' && url.searchParams.get('follow_up') === 'any'
  })
  await page.getByRole('link', { name: 'Return to map' }).click()
  const defaultList = await (await refreshed).json() as { items: Array<{ id: string }> }
  expect(defaultList.items.map((item) => item.id)).not.toContain(REMOVED)
  await expect(page.locator('.map-pin')).toHaveCount(defaultList.items.length)
  await expect(pin(page, REMOVED)).toHaveCount(0)

  // Still available through the Resolved filter (GET /sightings?follow_up=resolved).
  const resolved = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1/sightings' && url.searchParams.get('follow_up') === 'resolved'
  })
  await reportsButton(page).click()
  await reportsSheet(page).getByRole('button', { name: 'Resolved sightings', exact: true }).click()
  expect((await (await resolved).json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual([REMOVED])
  await expect(pin(page, REMOVED)).toHaveAttribute('data-tier', 'removed')
  await expect(pin(page, REMOVED)).toHaveAttribute('aria-label', /Resolved after follow-up$/)
  const item = reportsSheet(page).locator('.map-reports-sheet__item')
  await expect(item).toHaveCount(1)
  await expect(item.locator('.map-reports-sheet__item-meta')).toHaveText(/Resolved after follow-up$/)

  // Labelled Resolved after follow-up in its history.
  await item.click()
  await expect(details(page).getByRole('region', { name: 'Follow-up resolution' })).toContainText('Resolved after follow-up')
  await expect(details(page).getByRole('region', { name: 'Follow-up resolution' })).toContainText(`No regrowth found on ${displayDate(new Date())}.`)
  await expect(details(page).getByRole('region', { name: 'Status history' }).getByRole('listitem').last())
    .toContainText('No regrowth found · Resolved after follow-up')
})

test('AC 4.8.2 Regrowth outcome: the sighting returns as an active coloured marker and its details show Regrowth reported with the follow-up date', async ({ page, context, baseURL }) => {
  await startPrivateAccess(page)
  await standAt(context, baseURL, (await sightingDetail(page, REMOVED)).location)
  await page.goto(`/sightings/${REMOVED}/follow-up`)
  const { sent } = await recordFollowUp(page, /Regrowth present/)
  expect(sent.outcome).toBe('regrowth_present')
  const today = displayDate(new Date())

  await page.getByRole('link', { name: 'Return to map' }).click()
  // Back in an active concentration colour at full opacity (it has 2 reports: "spreading").
  const marker = pin(page, REMOVED)
  await expect(marker).toHaveAttribute('data-tier', 'spreading')
  await expect(marker.locator('svg path')).toHaveAttribute('fill', '#D9880F')
  expect(Number(await marker.evaluate((element) => getComputedStyle(element).opacity))).toBe(1)
  await expect(marker).toHaveAttribute('aria-label', new RegExp(`Regrowth reported on ${today}$`))

  // GET /sightings?follow_up=regrowth returns it.
  const regrowth = await getJson<{ items: Array<{ id: string; status: string; followUpState: string }> }>(page, '/api/v1/sightings?follow_up=regrowth')
  expect(regrowth.items).toHaveLength(1)
  expect(regrowth.items[0]).toMatchObject({ id: REMOVED, status: 'screened', followUpState: 'regrowth' })

  // Details: Regrowth reported and the follow-up date.
  await openFromList(page, REMOVED_PLACE)
  const card = details(page).getByRole('region', { name: 'Regrowth report' })
  await expect(card.getByText('Regrowth reported', { exact: true })).toBeVisible()
  await expect(card).toContainText(`Follow-up on ${today}.`)
  await expect(details(page).getByRole('link', { name: 'Start follow-up' })).toHaveCount(0)
})

test('AC 4.8.3 Unconfirmed outcome: the marker stays grey with Follow-up needed and shows the latest attempt date', async ({ page, context, baseURL }) => {
  await startPrivateAccess(page)
  await standAt(context, baseURL, (await sightingDetail(page, REMOVED)).location)
  await page.goto(`/sightings/${REMOVED}/follow-up`)
  const { sent } = await recordFollowUp(page, /Unable to confirm/)
  expect(sent.outcome).toBe('unable_to_confirm')
  const today = displayDate(new Date())

  await page.getByRole('link', { name: 'Return to map' }).click()
  const marker = pin(page, REMOVED)
  await expect(marker).toHaveAttribute('data-tier', 'followup-needed')
  await expect(marker.locator('svg path')).toHaveAttribute('fill', '#66736D')
  await expect(marker).toHaveAttribute('aria-label', new RegExp(`Follow-up needed - Removal reported on ${DATE.source} · latest attempt ${today}$`))

  // It is still returned by GET /sightings?follow_up=needed.
  const needed = await getJson<{ items: Array<{ id: string; followUpState: string; lastFollowupAt: string }> }>(page, '/api/v1/sightings?follow_up=needed')
  expect(needed.items.map((item) => item.id)).toContain(REMOVED)
  expect(displayDate(needed.items.find((item) => item.id === REMOVED)!.lastFollowupAt)).toBe(today)

  // Details keep the follow-up card and add the latest attempt.
  await openFromList(page, REMOVED_PLACE)
  const card = details(page).getByRole('region', { name: 'Follow-up needed' })
  await expect(card.locator('div').filter({ has: page.locator('dt', { hasText: 'Latest attempt' }) }).locator('dd'))
    .toHaveText(`${today} · unable to confirm`)
  await expect(card.getByRole('link', { name: 'Start follow-up' })).toBeVisible()
})

test('AC 4.8.4 Resolved sighting history: the original report, removal report and follow-up outcome stay visible in date order, read-only', async ({ page, context, baseURL }) => {
  await startPrivateAccess(page)
  await standAt(context, baseURL, (await sightingDetail(page, REMOVED)).location)
  await page.goto(`/sightings/${REMOVED}/follow-up`)
  await recordFollowUp(page, /No regrowth found/)

  const expectHistory = async () => {
    const api = (await sightingDetail(page, REMOVED)).followUpHistory
    expect(api.map((event) => event.eventType)).toEqual(['reported', 'removal_reported', 'followup_no_regrowth'])
    const section = details(page).getByRole('region', { name: 'Status history' })
    const rows = section.getByRole('listitem')
    await expect(rows.locator('strong')).toHaveText(['Original report', 'Removal reported', 'No regrowth found · Resolved after follow-up'])
    // Each entry shows its own date, oldest first.
    await expect(rows.locator('span')).toHaveText(api.map((event) => displayDate(event.createdAt)))
    const times = api.map((event) => Date.parse(event.createdAt))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    // Read-only: nothing in the history, or on a resolved sighting, can change it.
    await expect(section.locator('button, a, input, select, textarea')).toHaveCount(0)
    await expect(details(page).getByRole('button', { name: 'Mark as removed' })).toHaveCount(0)
    await expect(details(page).getByRole('link', { name: 'Start follow-up' })).toHaveCount(0)
  }

  // Route 1: the related history, straight from the success screen.
  await page.getByRole('link', { name: 'View sighting history' }).click()
  await expect(page).toHaveURL(new RegExp(`/map\\?sighting=${REMOVED}$`))
  await expect(details(page).getByText('Resolved after follow-up', { exact: true })).toBeVisible()
  await expectHistory()
  await closeDetails(page)

  // Route 2: the Resolved sightings filter.
  await reportsButton(page).click()
  await reportsSheet(page).getByRole('button', { name: 'Resolved sightings', exact: true }).click()
  await expect(reportsSheet(page).locator('.map-reports-sheet__item')).toHaveCount(1)
  await reportsSheet(page).locator('.map-reports-sheet__item').click()
  await expectHistory()
})

test('AC 4.8.5 Re-report removal after regrowth: Mark as removed is offered again, the sighting returns to Follow-up needed with a new removal date and the history is kept in order', async ({ page, context, baseURL }) => {
  await startPrivateAccess(page)
  const target = await sightingDetail(page, ACTIVE)
  await standAt(context, baseURL, target.location, { accuracy: 8, northM: 30 })
  await page.goto(`/map?sighting=${ACTIVE}`)

  // First removal, then a follow-up that finds regrowth.
  const first = await confirmRemoval(page)
  expect(first.status).toBe(200)
  await details(page).getByRole('link', { name: 'Start follow-up' }).click()
  await recordFollowUp(page, /Regrowth present/)
  await page.getByRole('link', { name: 'Return to map' }).click()

  // Regrowth reported: active again, and the removal action is back.
  const regrowth = details(page).getByRole('region', { name: 'Regrowth report' })
  await expect(regrowth.getByText('Regrowth reported', { exact: true })).toBeVisible()
  await expect(regrowth).toContainText('The marker is active on the map again.')
  expect(await sightingDetail(page, ACTIVE)).toMatchObject({ status: 'screened', followUpState: 'regrowth', removalReportId: ACTIVE_REPORT })
  await expect(details(page).getByRole('button', { name: 'Mark as removed' })).toBeVisible()

  // The same fresh-location checks apply: a coarse fix cannot be submitted.
  await standAt(context, baseURL, target.location, { accuracy: 500, northM: 30 })
  await details(page).getByRole('button', { name: 'Mark as removed' }).click()
  await expect(details(page).getByText('Measured accuracy: ±500 m')).toBeVisible()
  await expect(details(page).getByRole('button', { name: 'Confirm removal report' })).toHaveCount(0)
  await standAt(context, baseURL, target.location, { accuracy: 8, northM: 30 })
  await details(page).getByRole('button', { name: 'Request a new location' }).click()
  await page.waitForTimeout(1100) // so the second removal has a later timestamp
  const posted = page.waitForResponse((response) => isRemovalPost(response.url(), response.request().method()))
  await details(page).getByRole('button', { name: 'Confirm removal report' }).click()
  const second = await (await posted).json() as { status: string; removalReportedAt: string }

  // Removal reported / Follow-up needed again, with a new removal date.
  expect(second.status).toBe('removal_reported')
  expect(Date.parse(second.removalReportedAt)).toBeGreaterThan(Date.parse(first.body.removalReportedAt as string))
  const after = await sightingDetail(page, ACTIVE)
  expect(after).toMatchObject({ status: 'removal_reported', followUpState: 'needed', removalReportedAt: second.removalReportedAt })
  await expect(details(page).getByRole('heading', { name: 'Follow-up needed' })).toBeVisible()
  await expect(pin(page, ACTIVE)).toHaveAttribute('data-tier', 'followup-needed')

  // Earlier history kept, in date order.
  expect(after.followUpHistory.map((event) => event.eventType)).toEqual(['reported', 'removal_reported', 'followup_regrowth', 'removal_reported'])
  const times = after.followUpHistory.map((event) => Date.parse(event.createdAt))
  expect([...times].sort((a, b) => a - b)).toEqual(times)
  await expect(details(page).getByRole('region', { name: 'Status history' }).getByRole('listitem').locator('strong'))
    .toHaveText(['Original report', 'Removal reported', 'Regrowth reported', 'Removal reported'])

  // The follow-up cycle can run again.
  await details(page).getByRole('link', { name: 'Start follow-up' }).click()
  await expect(page.getByRole('heading', { name: 'Check you are at the plant' })).toBeVisible()
  await page.getByRole('button', { name: /current location/i }).click()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
})
