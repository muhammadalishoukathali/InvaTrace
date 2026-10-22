// Epic 6 (adopted areas) acceptance criteria against the dev server with the
// MSW mocks. The mock keeps adoptions in localStorage keyed by profile id, so
// "another user's adoption" is a seeded record with a different profileId -
// that proves the per-identity behaviour of the UI and of the mock handler,
// not the database constraint behind the real API (see the per-test notes).
import { expect, test, type Locator, type Page } from '@playwright/test'
import { atLocation, KL_FIX, pinModelSpecies, scanPhoto, startPrivateAccess } from '../fixtures/app'

const BUKIT_KIARA = '10000000-0000-4000-8000-000000000001'
const KOTA_DAMANSARA = '10000000-0000-4000-8000-000000000003'
const RIMBA_ILMU = '10000000-0000-4000-8000-000000000004'
const TITIWANGSA = 'e56ae54c-ca04-5fbf-b2c2-01b6e7fbdf46'
// Mock polygon of Bukit Kiara (src/mocks/handlers.ts); every seed sighting sits inside it.
const BUKIT_KIARA_BOUNDS = { minLng: 101.632, maxLng: 101.651, minLat: 3.143, maxLat: 3.158 }
const ADOPTIONS_KEY = 'invatrace-mock-adoptions-v1'
const ADOPTIONS_PATH = '/api/v1/adopted-areas'
const OTHER_PROFILE = 'another-anonymous-profile'

// Words that would turn a monitoring bookmark into a claim over the land, or a
// report count into a statement about the environment.
const OWNERSHIP_LANGUAGE = /\b(own|owns|owned|owner|owners|claim|claimed|steward|guardian|in charge|belongs to you)\b/i
const ECOLOGY_LANGUAGE = /environmental health|ecological|health score|invasion density|abundance|recovery|recovered|improv|deteriorat|infestation level/i
const SCORE_LANGUAGE = /\bscore\b|\bindex\b|\brating\b|\bhealth\b/i

interface MockAdoption { adoptionId: string; profileId: string; placeId: string; adoptedAt: string }
interface PublicSighting {
  id: string
  speciesId: string
  status: string
  location: { lat: number; lng: number }
  lastReportedAt: string
  removalReportedAt?: string | null
}
interface AreaCard {
  adoptionId: string
  placeId: string
  name: string
  type: string
  adoptedAt: string
  mostRecentReportAt: string | null
  geometryVersion: string
  metricsLabel: string
  metrics: {
    activeReports: number
    distinctApprovedSpecies: number
    newReportsLast30Days: number
    removalReportsLast30Days: number
    daysSinceMostRecentReport: number | null
  }
}
interface ActivityMarker {
  sightingId: string
  speciesId: string
  scientificName: string
  communityLabel: string
  observationDate: string
  status: 'screened' | 'removal_reported'
  statusDate: string
  latitude: number
  longitude: number
}
interface Activity {
  adoptionId: string
  placeId: string
  name: string
  geometry: { type: string; coordinates: unknown }
  geometryVersion: string
  markers: ActivityMarker[]
  filteredCount: number
  concentrationCount: number
  concentrations: Array<{ concentrationId: string; reportCount: number; latitude: number; longitude: number }>
  comparison: { recent0To29Days: number; prior30To59Days: number; direction: string }
  emptyMessage: string | null
  disclaimer: string
}

const pathOf = (url: string) => new URL(url).pathname
const isActivity = (url: string) => /^\/api\/v1\/adopted-areas\/[^/]+\/activity$/.test(pathOf(url))

/** Same formatter the pages use (en-GB, medium), evaluated in the browser so the time zone matches. */
const mediumDate = (page: Page, iso: string) => page.evaluate(
  (value) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value)),
  iso,
)

const storedAdoptions = (page: Page) => page.evaluate(
  (key) => JSON.parse(localStorage.getItem(key) ?? '[]') as MockAdoption[],
  ADOPTIONS_KEY,
)

/** Writes adoption records straight into the mock's store; the handlers read it on every request. */
async function seedAdoptions(page: Page, records: MockAdoption[]) {
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: ADOPTIONS_KEY, value: records },
  )
}

const adoption = (profileId: string, placeId: string, adoptedAt = '2026-08-15T03:00:00.000Z'): MockAdoption => ({
  adoptionId: `seed-${profileId.slice(0, 8)}-${placeId.slice(-4)}`,
  profileId,
  placeId,
  adoptedAt,
})

// The app keeps its session token in memory only, so the tests learn it the way
// the server does: from the Authorization header of the app's own API calls. A
// reload re-bootstraps the session and rotates the token; the latest one wins.
const sessionTokens = new WeakMap<Page, string>()
test.beforeEach(({ page }) => {
  page.on('request', (request) => {
    const authorization = request.headers().authorization
    if (authorization?.startsWith('Bearer ') && pathOf(request.url()).startsWith('/api/v1/')) {
      sessionTokens.set(page, authorization.slice('Bearer '.length))
    }
  })
})
const liveToken = (page: Page) => sessionTokens.get(page) ?? ''

/** An API call made with the app's live session token, as a second tab or a retry would make it. */
async function appFetch<T>(page: Page, path: string, init: { method?: string; body?: unknown } = {}) {
  return page.evaluate(async ({ path, method, body, token }) => {
    const response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }, { path, method: init.method ?? 'GET', body: init.body, token: liveToken(page) }) as Promise<{ status: number; body: T }>
}

/** The activity filter selects are wrapped by their label, whose text therefore includes every option. */
const filterSelect = (page: Page, label: 'Plant' | 'Status' | 'Period') => (
  page.locator('.activity-filters label').filter({ hasText: new RegExp(`^${label}`) }).locator('select')
)

/** Client-side navigation through the History API, which the router listens
 *  to. (Importing the app's router module from the test can hand back a second
 *  module instance when the dev server has hot-updated a file.) A full reload
 *  would drop the mock's in-memory reports. */
async function navigateInApp(page: Page, destination: string) {
  await page.evaluate((target) => {
    window.history.pushState(null, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, destination)
}

async function adoptThroughPlacePage(page: Page, placeId: string) {
  await page.goto(`/places/${placeId}`)
  page.once('dialog', (dialog) => dialog.accept())
  const created = page.waitForResponse((response) => (
    pathOf(response.url()) === ADOPTIONS_PATH && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'Adopt for monitoring', exact: true }).click()
  const body = await (await created).json() as MockAdoption
  await expect(page.getByRole('button', { name: 'Adopted for monitoring' })).toBeVisible()
  return body
}

/** Scan and submit a report at the current geolocation, stopping on the first confirmation screen. */
async function submitReport(page: Page) {
  await scanPhoto(page)
  await page.getByRole('button', { name: /Report sighting/ }).click()
  await expect(page).toHaveURL(/\/report$/)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Single plant', { exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('checkbox', { name: /accurate/i }).check()
  await page.getByRole('checkbox', { name: /personal information/i }).check()
  await page.getByRole('button', { name: 'Review submission' }).click()
  const created = page.waitForResponse((response) => (
    pathOf(response.url()) === '/api/v1/reports' && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'Submit report' }).click()
  const report = await (await created).json() as { id: string }
  await expect(page.locator('.report-submission-result')).toBeVisible({ timeout: 8000 })
  return report
}

async function openActivity(page: Page, adoptionId: string) {
  const loaded = page.waitForResponse((response) => isActivity(response.url()))
  await page.goto(`/adopted-areas/${adoptionId}/activity`)
  const activity = await (await loaded).json() as Activity
  await expect(page.locator('.activity-facts')).toBeVisible()
  await expect(page.locator('.activity-page__map canvas')).toBeVisible()
  return activity
}

/** Replaces the activity response from here on. MSW answers these requests in
 *  the page, so neither page.route nor context.route ever sees them. */
async function overrideActivity(page: Page, body: Activity) {
  await page.evaluate((payload) => {
    const original = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/\/api\/v1\/adopted-areas\/[^/]+\/activity/.test(url)) {
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return original(input, init)
    }
  }, body)
}

const insideBukitKiara = (point: { lat: number; lng: number }) => (
  point.lng > BUKIT_KIARA_BOUNDS.minLng && point.lng < BUKIT_KIARA_BOUNDS.maxLng
  && point.lat > BUKIT_KIARA_BOUNDS.minLat && point.lat < BUKIT_KIARA_BOUNDS.maxLat
)

test('AC 6.1.1 Adopt from an area', async ({ page }) => {
  await startPrivateAccess(page)
  await page.goto(`/places/${BUKIT_KIARA}`)
  await expect(page.getByRole('heading', { name: 'Bukit Kiara' })).toBeVisible()
  const token = liveToken(page)
  expect(token).toBeTruthy()
  const adoptRequests: Array<{ body: unknown; authorization: string | undefined }> = []
  page.on('request', (request) => {
    if (pathOf(request.url()) === ADOPTIONS_PATH && request.method() === 'POST') {
      adoptRequests.push({ body: request.postDataJSON(), authorization: request.headers().authorization })
    }
  })

  // "...and confirms": cancelling the confirmation must not adopt anything.
  const adoptButton = page.getByRole('button', { name: 'Adopt for monitoring', exact: true })
  page.once('dialog', (dialog) => dialog.dismiss())
  await adoptButton.click()
  await expect(adoptButton).toBeEnabled()
  expect(adoptRequests).toEqual([])

  let confirmation = ''
  page.once('dialog', (dialog) => { confirmation = dialog.message(); void dialog.accept() })
  const created = page.waitForResponse((response) => (
    pathOf(response.url()) === ADOPTIONS_PATH && response.request().method() === 'POST'
  ))
  await adoptButton.click()
  const response = await created
  expect(confirmation).toContain('Adopt Bukit Kiara for monitoring?')

  // The client's wire format is camelCase: place_id travels as `placeId`.
  expect(adoptRequests).toEqual([{ body: { placeId: BUKIT_KIARA }, authorization: `Bearer ${token}` }])
  expect(response.status()).toBe(201)
  const body = await response.json() as MockAdoption
  expect(body.adoptionId).toMatch(/^[0-9a-f-]{36}$/)
  expect(body.placeId).toBe(BUKIT_KIARA)
  expect(Number.isNaN(Date.parse(body.adoptedAt))).toBe(false)

  // The control changes state and can no longer be pressed.
  const adopted = page.getByRole('button', { name: 'Adopted for monitoring' })
  await expect(adopted).toBeVisible()
  await expect(adopted).toBeDisabled()
  await expect(adoptButton).toHaveCount(0)

  // It belongs to this identity's list, and the place still reads as adopted on a later visit.
  const listed = await appFetch<{ items: AreaCard[] }>(page, `${ADOPTIONS_PATH}?sort=recent_activity`)
  expect(listed.body.items.map((item) => [item.adoptionId, item.placeId])).toEqual([[body.adoptionId, BUKIT_KIARA]])
  await page.goto('/adopted-areas')
  await expect(page.getByRole('heading', { level: 3, name: 'Bukit Kiara' })).toHaveCount(1)
  await page.goto(`/places/${BUKIT_KIARA}`)
  await expect(page.getByRole('button', { name: 'Adopted for monitoring' })).toBeDisabled()
})

test('AC 6.1.2 Post-report adoption prompt', async ({ page, context, baseURL }) => {
  // KL_FIX is inside the Bukit Kiara polygon, so the report is "inside a supported place".
  await atLocation(context, baseURL, KL_FIX)
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  const adoptRequests: string[] = []
  page.on('request', (request) => {
    if (pathOf(request.url()).startsWith(ADOPTIONS_PATH) && request.method() !== 'GET') adoptRequests.push(request.method())
  })
  const report = await submitReport(page)

  // The report's own page carries the prompt; the submission confirmation
  // screen is the next test.
  await navigateInApp(page, `/reports/${report.id}`)
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  const prompt = page.getByRole('region', { name: 'Adopt this area for monitoring?' })
  await expect(prompt).toBeVisible()
  await expect(prompt.getByRole('heading', { name: /Adopt this area for monitoring/ })).toBeVisible()
  // It names the place that would be saved.
  await expect(prompt.locator('strong')).toHaveText('Bukit Kiara')
  await expect(prompt).toContainText('Your report is inside or along Bukit Kiara.')
  await expect(prompt.getByRole('button', { name: 'Adopt for monitoring' })).toBeVisible()

  // Declining: no adoption record, and the submitted report is untouched.
  await prompt.getByRole('button', { name: 'Not now' }).click()
  await expect(prompt).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible()
  expect(adoptRequests).toEqual([])
  expect(await storedAdoptions(page)).toEqual([])
  const listed = await appFetch<{ items: AreaCard[] }>(page, `${ADOPTIONS_PATH}?sort=recent_activity`)
  expect(listed.body.items).toEqual([])
  const stored = await appFetch<{ id: string; status: string; sightingId: string | null }>(page, `/api/v1/reports/${report.id}`)
  expect(stored.status).toBe(200)
  expect(stored.body.status).toBe('screened')
  expect(stored.body.sightingId).toBeTruthy()
  const mine = await appFetch<{ items: Array<{ id: string }> }>(page, '/api/v1/reports/mine')
  expect(mine.body.items.map((item) => item.id)).toContain(report.id)
})

test('AC 6.1.2 Post-report adoption prompt - offered on the submission confirmation screen', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL, KL_FIX)
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  const adoptRequests: string[] = []
  page.on('request', (request) => {
    if (pathOf(request.url()).startsWith(ADOPTIONS_PATH) && request.method() !== 'GET') adoptRequests.push(request.method())
  })
  const report = await submitReport(page)
  const confirmation = page.locator('.report-submission-result')
  await expect(confirmation.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  await expect(confirmation.getByText(/Adopt this area for monitoring/)).toBeVisible()
  // It names the place that will be saved, with the non-ownership wording.
  const prompt = confirmation.getByRole('region', { name: 'Adopt this area for monitoring?' })
  await expect(prompt.locator('strong')).toHaveText('Bukit Kiara')
  await expect(prompt).toContainText('Your report is inside or along Bukit Kiara.')
  await expect(prompt).toContainText('non-exclusive monitoring bookmark')
  await expect(prompt).toContainText('does not grant ownership, responsibility, access rights or removal permission')
  await expect(prompt.getByRole('button', { name: 'Adopt for monitoring' })).toBeVisible()

  // Declining: the prompt goes, nothing is adopted, the report stays published.
  await prompt.getByRole('button', { name: 'Not now' }).click()
  await expect(prompt).toHaveCount(0)
  await expect(confirmation.getByRole('heading', { name: 'Report published' })).toBeVisible()
  await expect(confirmation.getByRole('button', { name: 'View on map' })).toBeVisible()
  expect(adoptRequests).toEqual([])
  expect(await storedAdoptions(page)).toEqual([])
  const stored = await appFetch<{ status: string; sightingId: string | null }>(page, `/api/v1/reports/${report.id}`)
  expect(stored.body.status).toBe('screened')
  expect(stored.body.sightingId).toBeTruthy()
})

test('AC 6.1.2 Post-report adoption prompt - accepting on the confirmation screen saves the named place', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL, KL_FIX)
  await pinModelSpecies(page, 'mikania_micrantha')
  const session = await startPrivateAccess(page)
  const report = await submitReport(page)
  const confirmation = page.locator('.report-submission-result')
  const prompt = confirmation.getByRole('region', { name: 'Adopt this area for monitoring?' })
  await expect(prompt.locator('strong')).toHaveText('Bukit Kiara', { timeout: 8000 })

  const created = page.waitForResponse((response) => (
    pathOf(response.url()) === ADOPTIONS_PATH && response.request().method() === 'POST'
  ))
  await prompt.getByRole('button', { name: 'Adopt for monitoring' }).click()
  const response = await created
  expect(response.request().postDataJSON()).toEqual({ placeId: BUKIT_KIARA })
  expect(response.status()).toBe(201)
  await expect(prompt.getByRole('status')).toHaveText('Bukit Kiara is adopted for monitoring.')
  await expect(prompt.getByRole('button', { name: 'Adopt for monitoring' })).toHaveCount(0)
  expect(await storedAdoptions(page)).toEqual([
    expect.objectContaining({ profileId: session.profile.id, placeId: BUKIT_KIARA }),
  ])

  // Already adopted now, so the report's own page no longer offers it.
  await navigateInApp(page, `/reports/${report.id}`)
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible()
  await expect(page.locator('.report-tracking__meta')).toBeVisible()
  await expect(page.getByText(/Adopt this area for monitoring/)).toHaveCount(0)
})

test('AC 6.1.2 Post-report adoption prompt - not offered for an already adopted area', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL, KL_FIX)
  await pinModelSpecies(page, 'mikania_micrantha')
  const session = await startPrivateAccess(page)
  await seedAdoptions(page, [adoption(session.profile.id, BUKIT_KIARA)])
  const placeLookup = page.waitForResponse((response) => pathOf(response.url()) === '/api/v1/places/at-location')
  const adoptionsLoaded = page.waitForResponse((response) => pathOf(response.url()) === ADOPTIONS_PATH)
  await submitReport(page)
  const confirmation = page.locator('.report-submission-result')
  await expect(confirmation.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  // The place was resolved and the user's adoptions were read; only then is "no prompt" meaningful.
  expect((await (await placeLookup).json() as { place: { placeId: string } }).place.placeId).toBe(BUKIT_KIARA)
  await adoptionsLoaded
  await expect(confirmation.getByRole('button', { name: 'View on map' })).toBeVisible()
  await expect(confirmation.getByText(/Adopt this area for monitoring/)).toHaveCount(0)
})

test('AC 6.1.2 Post-report adoption prompt - not offered outside a supported place', async ({ page, context, baseURL }) => {
  // More than 2 km from every mapped place in the mock.
  await atLocation(context, baseURL, { latitude: 3.3, longitude: 101.5, accuracy: 15 })
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  const placeLookup = page.waitForResponse((response) => pathOf(response.url()) === '/api/v1/places/at-location')
  await submitReport(page)
  const confirmation = page.locator('.report-submission-result')
  await expect(confirmation.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  expect((await (await placeLookup).json() as { place: unknown }).place).toBeNull()
  await expect(confirmation.getByRole('button', { name: 'View on map' })).toBeVisible()
  await expect(confirmation.getByText(/Adopt this area for monitoring/)).toHaveCount(0)
})

test('AC 6.1.3 Non-exclusive adoption', async ({ page }) => {
  // Mock layer only: shows a second identity can adopt a place someone else has
  // already adopted and that the other record is left alone. The database
  // uniqueness on (anonymous_identity_id, place_id) needs the real stack.
  const session = await startPrivateAccess(page)
  const theirs = adoption(OTHER_PROFILE, BUKIT_KIARA, '2026-07-01T00:00:00.000Z')
  await seedAdoptions(page, [theirs])

  // The other user's adoption is not shown as mine, and does not block me.
  await page.goto(`/places/${BUKIT_KIARA}`)
  await expect(page.getByRole('button', { name: 'Adopt for monitoring', exact: true })).toBeEnabled()
  const mine = await adoptThroughPlacePage(page, BUKIT_KIARA)
  expect(mine.adoptionId).not.toBe(theirs.adoptionId)

  const stored = await storedAdoptions(page)
  expect(stored).toHaveLength(2)
  expect(stored).toContainEqual(theirs)
  expect(stored).toContainEqual(expect.objectContaining({
    adoptionId: mine.adoptionId, profileId: session.profile.id, placeId: BUKIT_KIARA,
  }))

  await page.goto('/adopted-areas')
  await expect(page.locator('.areas-list article')).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 3, name: 'Bukit Kiara' })).toHaveCount(1)
})

test('AC 6.1.4 Duplicate adoption handling', async ({ page }) => {
  // Mock layer only: the mock handler mirrors the idempotent contract. That the
  // real endpoint creates no second row needs the real stack.
  const session = await startPrivateAccess(page)
  const first = await adoptThroughPlacePage(page, BUKIT_KIARA)

  // The UI itself cannot repeat the request...
  await expect(page.getByRole('button', { name: 'Adopted for monitoring' })).toBeDisabled()
  // ...so repeat it the way a second tab or a retry would.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const repeat = await appFetch<MockAdoption>(page, ADOPTIONS_PATH, { method: 'POST', body: { placeId: BUKIT_KIARA } })
    expect([200, 201]).toContain(repeat.status)
    expect(repeat.body.adoptionId).toBe(first.adoptionId)
    expect(repeat.body.adoptedAt).toBe(first.adoptedAt)
  }

  const mine = (await storedAdoptions(page)).filter((item) => item.profileId === session.profile.id)
  expect(mine.map((item) => item.adoptionId)).toEqual([first.adoptionId])
  await page.goto('/adopted-areas')
  await expect(page.locator('.areas-list article')).toHaveCount(1)
})

test('AC 6.1.5 Remove an adoption', async ({ page }) => {
  await startPrivateAccess(page)
  const theirs = adoption(OTHER_PROFILE, BUKIT_KIARA)
  await seedAdoptions(page, [theirs])
  const mine = await adoptThroughPlacePage(page, BUKIT_KIARA)
  const sightingsBefore = await appFetch<{ items: PublicSighting[] }>(page, '/api/v1/sightings')
  expect(sightingsBefore.body.items.length).toBeGreaterThan(0)

  await page.goto('/adopted-areas')
  const card = page.locator('.areas-list article').filter({ hasText: 'Bukit Kiara' })
  await expect(card).toHaveCount(1)
  const token = liveToken(page)
  expect(token).toBeTruthy()
  const deletes: Array<{ path: string; authorization: string | undefined }> = []
  page.on('request', (request) => {
    if (request.method() === 'DELETE') deletes.push({ path: pathOf(request.url()), authorization: request.headers().authorization })
  })

  // "...and confirms": cancelling keeps the adoption.
  page.once('dialog', (dialog) => dialog.dismiss())
  await card.getByRole('button', { name: 'Stop monitoring' }).click()
  await expect(card).toHaveCount(1)
  expect(deletes).toEqual([])

  let confirmation = ''
  page.once('dialog', (dialog) => { confirmation = dialog.message(); void dialog.accept() })
  const removed = page.waitForResponse((response) => response.request().method() === 'DELETE')
  await card.getByRole('button', { name: 'Stop monitoring' }).click()
  expect((await removed).status()).toBe(204)
  expect(confirmation).toBe('Stop monitoring Bukit Kiara? Public reports and place data will not be deleted.')
  // The delete addresses the adoption by id and travels on the active anonymous session.
  expect(deletes).toEqual([{ path: `${ADOPTIONS_PATH}/${mine.adoptionId}`, authorization: `Bearer ${token}` }])

  await expect(page.getByRole('heading', { name: 'No monitoring areas yet' })).toBeVisible()
  await expect(page.locator('.areas-list article')).toHaveCount(0)

  // Public reports and the place itself are untouched.
  const sightingsAfter = await appFetch<{ items: PublicSighting[] }>(page, '/api/v1/sightings')
  expect(sightingsAfter.body.items.map((item) => item.id)).toEqual(sightingsBefore.body.items.map((item) => item.id))
  expect((await appFetch<{ placeId: string }>(page, `/api/v1/places/${BUKIT_KIARA}`)).body.placeId).toBe(BUKIT_KIARA)

  // Ownership (mock layer): this session cannot delete another identity's
  // adoption, and removing mine left theirs in place.
  const foreign = await appFetch(page, `${ADOPTIONS_PATH}/${theirs.adoptionId}`, { method: 'DELETE' })
  expect(foreign.status).toBe(404)
  expect(await storedAdoptions(page)).toEqual([theirs])

  await page.goto(`/places/${BUKIT_KIARA}`)
  await expect(page.getByRole('heading', { name: 'Bukit Kiara' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adopt for monitoring', exact: true })).toBeEnabled()
})

test('AC 6.1.6 No ownership implication', async ({ page }) => {
  await startPrivateAccess(page)
  const bookmarkWording = async (scope: Locator) => {
    const text = await scope.innerText()
    expect(text).toMatch(/bookmark/i)
    expect(text).toMatch(/non-exclusive/i)
    expect(text).toMatch(/does not (create|grant) ownership/i)
    expect(text).toMatch(/responsibility/i)
    expect(text).toMatch(/permission to remove plants|removal permission/i)
    expect(text).not.toMatch(OWNERSHIP_LANGUAGE)
  }

  // Place screen, before adopting: the control is "Adopt for monitoring".
  await page.goto(`/places/${BUKIT_KIARA}`)
  const place = page.locator('.place-detail')
  await expect(place.getByRole('button', { name: 'Adopt for monitoring', exact: true })).toBeVisible()
  await bookmarkWording(place)

  // The confirmation the user accepts says the same thing.
  let confirmation = ''
  page.once('dialog', (dialog) => { confirmation = dialog.message(); void dialog.accept() })
  await place.getByRole('button', { name: 'Adopt for monitoring', exact: true }).click()
  await expect(place.getByRole('button', { name: 'Adopted for monitoring' })).toBeVisible()
  expect(confirmation).toMatch(/for monitoring\?/)
  expect(confirmation).toMatch(/non-exclusive bookmark/)
  expect(confirmation).toMatch(/does not grant removal permission/)
  expect(confirmation).not.toMatch(OWNERSHIP_LANGUAGE)
  await bookmarkWording(place)

  // My adopted areas.
  await page.goto('/adopted-areas')
  await expect(page.getByRole('heading', { name: 'Your monitoring bookmarks' })).toBeVisible()
  await expect(page.locator('.areas-page')).toContainText('This is a non-exclusive monitoring bookmark.')
  await bookmarkWording(page.locator('.areas-page'))

  // The area's activity screen.
  await page.getByRole('link', { name: 'Open activity map' }).click()
  await expect(page.locator('.activity-page__disclaimer')).toContainText('This is a non-exclusive monitoring bookmark.')
  await bookmarkWording(page.locator('.activity-page__summary'))
})

test('AC 6.2.1 Adopted area list', async ({ page }) => {
  const session = await startPrivateAccess(page)
  const kiara = adoption(session.profile.id, BUKIT_KIARA, '2026-08-15T03:00:00.000Z')
  const forest = adoption(session.profile.id, KOTA_DAMANSARA, '2026-09-02T03:00:00.000Z')
  // Another identity's adoption sits in the same store and must not be listed.
  const theirs = adoption(OTHER_PROFILE, TITIWANGSA, '2026-06-01T03:00:00.000Z')
  await seedAdoptions(page, [kiara, theirs, forest])

  const loaded = page.waitForResponse((response) => pathOf(response.url()) === ADOPTIONS_PATH)
  await page.goto('/adopted-areas')
  const list = await (await loaded).json() as { items: AreaCard[] }
  expect(list.items.map((item) => item.adoptionId).sort()).toEqual([kiara.adoptionId, forest.adoptionId].sort())

  const cards = page.locator('.areas-list article')
  await expect(cards).toHaveCount(2)
  await expect(page.getByText('Taman Tasik Titiwangsa')).toHaveCount(0)

  const kiaraApi = list.items.find((item) => item.placeId === BUKIT_KIARA)!
  expect(kiaraApi.mostRecentReportAt).toBeTruthy()
  const kiaraCard = cards.filter({ has: page.getByRole('heading', { level: 3, name: 'Bukit Kiara' }) })
  await expect(kiaraCard).toHaveCount(1)
  await expect(kiaraCard).toContainText(`park · adopted ${await mediumDate(page, kiara.adoptedAt)}`)
  await expect(kiaraCard).toContainText(
    `Most recent community report: ${await mediumDate(page, kiaraApi.mostRecentReportAt!)}`,
  )

  // An area nobody has reported in says so instead of inventing a date.
  const forestApi = list.items.find((item) => item.placeId === KOTA_DAMANSARA)!
  expect(forestApi.mostRecentReportAt).toBeNull()
  const forestCard = cards.filter({ has: page.getByRole('heading', { level: 3, name: 'Kota Damansara Community Forest' }) })
  await expect(forestCard).toHaveCount(1)
  await expect(forestCard).toContainText(`forest · adopted ${await mediumDate(page, forest.adoptedAt)}`)
  await expect(forestCard).toContainText('Most recent community report: No reports')
})

test('AC 6.2.2 Defined monitoring indicators', async ({ page }) => {
  const session = await startPrivateAccess(page)
  await seedAdoptions(page, [adoption(session.profile.id, BUKIT_KIARA)])
  const loaded = page.waitForResponse((response) => pathOf(response.url()) === ADOPTIONS_PATH)
  await page.goto('/adopted-areas')
  const [area] = (await (await loaded).json() as { items: AreaCard[] }).items

  // Recompute the indicators from the public sightings the area contains. The
  // seed has one removal_reported sighting, so "active" really is a subset.
  const sightings = (await appFetch<{ items: PublicSighting[] }>(page, '/api/v1/sightings')).body.items
    .filter((item) => insideBukitKiara(item.location))
  const active = sightings.filter((item) => item.status === 'screened')
  expect(sightings.some((item) => item.status === 'removal_reported')).toBe(true)
  expect(active.length).toBeLessThan(sightings.length)
  const monthAgo = Date.now() - 30 * 86_400_000
  const latest = Math.max(...sightings.map((item) => Date.parse(item.lastReportedAt)))
  expect(area.metrics).toEqual({
    activeReports: active.length,
    distinctApprovedSpecies: new Set(active.map((item) => item.speciesId)).size,
    newReportsLast30Days: sightings.filter((item) => Date.parse(item.lastReportedAt) > monthAgo).length,
    removalReportsLast30Days: sightings.filter((item) => (
      item.status === 'removal_reported' && item.removalReportedAt && Date.parse(item.removalReportedAt) > monthAgo
    )).length,
    daysSinceMostRecentReport: Math.floor((Date.now() - latest) / 86_400_000),
  })

  // The card shows exactly those five indicators with the API's values.
  const metrics = page.locator('.areas-list article').first().locator('.areas-metrics > div')
  await expect(metrics).toHaveCount(5)
  const shown = Object.fromEntries(await metrics.evaluateAll((rows) => rows.map((row) => [
    row.querySelector('dt')?.textContent ?? '',
    row.querySelector('dd')?.textContent ?? '',
  ])))
  expect(shown).toEqual({
    'Active reports': String(area.metrics.activeReports),
    'Supported invasive plants': String(area.metrics.distinctApprovedSpecies),
    'New in 30 days': String(area.metrics.newReportsLast30Days),
    'Removal reports in 30 days': String(area.metrics.removalReportsLast30Days),
    'Days since most recent report': String(area.metrics.daysSinceMostRecentReport),
  })
})

test('AC 6.2.3 Consistent area membership', async ({ page }) => {
  // Mock layer only: the list card and the activity map agree on the count and
  // on the geometry version they were computed from. Polygon / 750 m trail
  // buffer membership in PostGIS needs the real stack.
  const session = await startPrivateAccess(page)
  const mine = adoption(session.profile.id, BUKIT_KIARA)
  await seedAdoptions(page, [mine])
  const loaded = page.waitForResponse((response) => pathOf(response.url()) === ADOPTIONS_PATH)
  await page.goto('/adopted-areas')
  const [area] = (await (await loaded).json() as { items: AreaCard[] }).items
  const cardActive = page.locator('.areas-metrics > div').filter({ hasText: 'Active reports' }).locator('dd')
  await expect(cardActive).toHaveText(String(area.metrics.activeReports))

  const activityLoaded = page.waitForResponse((response) => isActivity(response.url()))
  await page.getByRole('link', { name: 'Open activity map' }).click()
  const activity = await (await activityLoaded).json() as Activity
  expect(activity.geometryVersion).toBe(area.geometryVersion)
  await expect(page.getByText(`geometry v${area.geometryVersion}`)).toBeVisible()

  // Same membership rule on both screens: the map's active markers are the card's active count.
  const filtered = page.waitForResponse((response) => isActivity(response.url()) && response.url().includes('status=screened'))
  await filterSelect(page, 'Status').selectOption('screened')
  const activeOnly = await (await filtered).json() as Activity
  expect(activeOnly.filteredCount).toBe(area.metrics.activeReports)
  await expect(page.locator('.activity-facts')).toContainText(`${area.metrics.activeReports} reports match these filters.`)
  await expect(page.locator('.activity-marker')).toHaveCount(area.metrics.activeReports)
})

test('AC 6.2.4 Monitoring language', async ({ page }) => {
  const session = await startPrivateAccess(page)
  await seedAdoptions(page, [adoption(session.profile.id, BUKIT_KIARA)])
  await page.goto('/adopted-areas')

  // The indicators' heading is the approved label...
  const card = page.locator('.areas-list article').first()
  await expect(card.getByRole('heading', { level: 4 })).toHaveText('Community monitoring activity')
  await expect(card.locator('.areas-metrics dt')).toHaveText([
    'Active reports',
    'Supported invasive plants',
    'New in 30 days',
    'Removal reports in 30 days',
    'Days since most recent report',
  ])
  // ...and nothing on the page reads as an environmental measurement or a combined score.
  const listText = await page.locator('.areas-page').innerText()
  expect(listText).not.toMatch(ECOLOGY_LANGUAGE)
  expect(listText).not.toMatch(SCORE_LANGUAGE)

  await card.getByRole('link', { name: 'Open activity map' }).click()
  const summary = page.locator('.activity-page__summary')
  await expect(summary.getByText(/^Community monitoring activity/)).toBeVisible()
  await expect(page.locator('.activity-facts')).toBeVisible()
  const activityText = await summary.innerText()
  expect(activityText).not.toMatch(ECOLOGY_LANGUAGE)
  expect(activityText).not.toMatch(SCORE_LANGUAGE)
})

test('AC 6.2.5 Sorting and navigation', async ({ page, context, baseURL }) => {
  // The seed only has reports in Bukit Kiara, where both sort orders would
  // agree. A fresh report inside Taman Tasik Titiwangsa makes that area the
  // most recently active while it stays last alphabetically.
  await atLocation(context, baseURL, { latitude: 3.1778, longitude: 101.7069, accuracy: 15 })
  await pinModelSpecies(page, 'mikania_micrantha')
  const session = await startPrivateAccess(page)
  const kiara = adoption(session.profile.id, BUKIT_KIARA)
  const forest = adoption(session.profile.id, KOTA_DAMANSARA)
  const lake = adoption(session.profile.id, TITIWANGSA)
  await seedAdoptions(page, [forest, lake, kiara])
  const sorts: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === ADOPTIONS_PATH && request.method() === 'GET') sorts.push(url.searchParams.get('sort') ?? '')
  })
  // The confirmation screen reads the adoption list itself once the report is
  // published (for its adoption prompt), and the list page reuses that fresh
  // result - so the recent-activity response is captured from here.
  const recentLoaded = page.waitForResponse((response) => response.url().includes(`${ADOPTIONS_PATH}?sort=recent_activity`))
  await submitReport(page)
  await expect(page.locator('.report-submission-result').getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  const recent = await (await recentLoaded).json() as { items: AreaCard[] }
  const names = page.locator('.areas-list article h3')
  await navigateInApp(page, '/adopted-areas')

  // Recent activity is the default: newest report first, the area with no reports last.
  await expect(page.getByLabel('Sort by')).toHaveValue('recent_activity')
  await expect(names).toHaveText(['Taman Tasik Titiwangsa', 'Bukit Kiara', 'Kota Damansara Community Forest'])
  const times = recent.items.map((item) => item.mostRecentReportAt)
  expect(times[2]).toBeNull()
  expect(Date.parse(times[0]!)).toBeGreaterThan(Date.parse(times[1]!))

  await page.getByLabel('Sort by').selectOption({ label: 'Area name' })
  await expect(names).toHaveText(['Bukit Kiara', 'Kota Damansara Community Forest', 'Taman Tasik Titiwangsa'])
  await page.getByLabel('Sort by').selectOption({ label: 'Recent activity' })
  await expect(names).toHaveText(['Taman Tasik Titiwangsa', 'Bukit Kiara', 'Kota Damansara Community Forest'])
  expect(sorts.slice(0, 2)).toEqual(['recent_activity', 'name'])

  // Selecting an area opens its activity map.
  await page.locator('.areas-list article').first().getByRole('link', { name: 'Open activity map' }).click()
  await expect(page).toHaveURL(new RegExp(`/adopted-areas/${lake.adoptionId}/activity$`))
  await expect(page.getByRole('heading', { level: 2, name: 'Taman Tasik Titiwangsa' })).toBeVisible()
  await expect(page.locator('.activity-page__map canvas')).toBeVisible()
  await expect(page.locator('.activity-marker')).toHaveCount(1)
})

test('AC 6.2.6 Empty state', async ({ page }) => {
  await startPrivateAccess(page)
  const loaded = page.waitForResponse((response) => pathOf(response.url()) === ADOPTIONS_PATH)
  await page.goto('/adopted-areas')
  expect((await (await loaded).json() as { items: AreaCard[] }).items).toEqual([])

  const empty = page.locator('.areas-state')
  await expect(empty.getByRole('heading', { name: 'No monitoring areas yet' })).toBeVisible()
  // Explains the feature...
  await expect(empty).toContainText('Browse places to add a non-exclusive monitoring bookmark.')
  await expect(empty).toContainText('This is a non-exclusive monitoring bookmark.')
  // ...and offers the way in.
  await expect(empty.getByRole('link', { name: 'Browse places' })).toHaveAttribute('href', '/places')

  // Zero saved areas means zero cards, indicators, sort controls or sample reports.
  await expect(page.locator('.areas-list article')).toHaveCount(0)
  await expect(page.locator('.areas-metrics')).toHaveCount(0)
  await expect(page.getByLabel('Sort by')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Open activity map' })).toHaveCount(0)
  const text = await empty.innerText()
  expect(text).not.toMatch(/Active reports|New in 30 days|Most recent community report|Community monitoring activity/)

  await empty.getByRole('link', { name: 'Browse places' }).click()
  await expect(page).toHaveURL(/\/places$/)
  await expect(page.getByRole('heading', { name: 'Browse mapped places' })).toBeVisible()
})

test('AC 6.3.1 Area-restricted report map', async ({ page }) => {
  // Mock layer: proves the page shows exactly the API's markers for the area
  // and keeps them in view, and that another identity's adoption id is refused.
  // The PostGIS assignment of reports to the stored geometry needs the real stack.
  const session = await startPrivateAccess(page)
  const kiara = adoption(session.profile.id, BUKIT_KIARA)
  const woodland = adoption(session.profile.id, RIMBA_ILMU)
  const theirs = adoption(OTHER_PROFILE, BUKIT_KIARA)
  await seedAdoptions(page, [kiara, woodland, theirs])

  const activity = await openActivity(page, kiara.adoptionId)
  expect(activity.placeId).toBe(BUKIT_KIARA)
  // The response names the geometry version used for filtering, and the page shows it.
  expect(activity.geometryVersion).toBe('mock-osm-2026-09-01')
  await expect(page.getByText(`geometry v${activity.geometryVersion}`)).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Bukit Kiara' })).toBeVisible()

  // Only reports inside the area: every marker is within the polygon and the
  // set is exactly the public sightings that fall inside it.
  const sightings = (await appFetch<{ items: PublicSighting[] }>(page, '/api/v1/sightings')).body.items
  const expected = sightings.filter((item) => insideBukitKiara(item.location)).map((item) => item.id).sort()
  expect(expected.length).toBeGreaterThan(0)
  expect(activity.markers.map((marker) => marker.sightingId).sort()).toEqual(expected)
  for (const marker of activity.markers) {
    expect(insideBukitKiara({ lat: marker.latitude, lng: marker.longitude })).toBe(true)
  }
  const markers = page.locator('.activity-marker')
  await expect(markers).toHaveCount(activity.markers.length)

  // The camera is fitted to the area: every marker inside it is on screen, within the map.
  const map = (await page.locator('.activity-page__map').boundingBox())!
  for (const centre of await markers.evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }))) {
    expect(centre.x).toBeGreaterThan(map.x)
    expect(centre.x).toBeLessThan(map.x + map.width)
    expect(centre.y).toBeGreaterThan(map.y)
    expect(centre.y).toBeLessThan(map.y + map.height)
  }

  // A different adopted area two kilometres away shows none of those reports.
  const elsewhere = await openActivity(page, woodland.adoptionId)
  expect(elsewhere.placeId).toBe(RIMBA_ILMU)
  expect(elsewhere.markers).toEqual([])
  await expect(page.locator('.activity-marker')).toHaveCount(0)

  // Ownership: an adoption id that belongs to another identity is not served.
  const refused = page.waitForResponse((response) => isActivity(response.url()))
  await page.goto(`/adopted-areas/${theirs.adoptionId}/activity`)
  expect((await refused).status()).toBe(404)
  // The query retries with backoff before it gives up, hence the longer wait.
  await expect(page.locator('.areas-state[role="alert"]')).toHaveText('Activity could not be loaded.', { timeout: 20_000 })
  await expect(page.locator('.activity-marker')).toHaveCount(0)
})

test('AC 6.3.2 Report status and date', async ({ page }) => {
  const session = await startPrivateAccess(page)
  const kiara = adoption(session.profile.id, BUKIT_KIARA)
  await seedAdoptions(page, [kiara])
  const activity = await openActivity(page, kiara.adoptionId)
  const removal = activity.markers.find((marker) => marker.status === 'removal_reported')!
  const active = activity.markers.find((marker) => marker.status === 'screened')!
  expect(removal).toBeTruthy()
  expect(active).toBeTruthy()

  // Removal-reported markers stay on the map and do not look like active ones.
  const removalMarkers = page.locator('.activity-marker--removal_reported')
  const activeMarkers = page.locator('.activity-marker--screened')
  await expect(removalMarkers).toHaveCount(activity.markers.filter((marker) => marker.status === 'removal_reported').length)
  await expect(activeMarkers).toHaveCount(activity.markers.filter((marker) => marker.status === 'screened').length)
  await expect(removalMarkers.first()).toBeVisible()
  const look = (locator: Locator) => locator.first().evaluate((node) => {
    const style = getComputedStyle(node)
    return { background: style.backgroundColor, radius: style.borderTopLeftRadius }
  })
  const removalLook = await look(removalMarkers)
  const activeLook = await look(activeMarkers)
  expect(removalLook.background).not.toBe(activeLook.background)
  expect(removalLook.radius).not.toBe(activeLook.radius)

  // Selecting a marker opens the detail panel. Markers can overlap at this
  // zoom, so the click is dispatched on the element rather than at a point.
  const panel = page.locator('.activity-selection')
  const row = (label: string) => panel.locator('dl > div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd')
  await removalMarkers.first().dispatchEvent('click')
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(removal.scientificName)
  await expect(panel.getByText('Community report - not expert validated')).toBeVisible()
  await expect(row('Observed')).toHaveText(await mediumDate(page, removal.observationDate))
  await expect(row('Status')).toHaveText('Removal reported')
  await expect(row('Status date')).toHaveText(await mediumDate(page, removal.statusDate))

  const activeLabel = `${active.scientificName}; ${active.communityLabel}; screened; ${await mediumDate(page, active.statusDate)}`
  await page.locator(`.activity-marker--screened[aria-label="${activeLabel}"]`).first().dispatchEvent('click')
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(active.scientificName)
  await expect(panel.getByText('Community report - not expert validated')).toBeVisible()
  await expect(row('Observed')).toHaveText(await mediumDate(page, active.observationDate))
  await expect(row('Status')).toHaveText('Active')
  await expect(row('Status date')).toHaveText(await mediumDate(page, active.statusDate))

  await panel.getByRole('button', { name: 'Close report details' }).click()
  await expect(panel).toHaveCount(0)
})

test('AC 6.3.3 Activity filters', async ({ page }) => {
  const session = await startPrivateAccess(page)
  const kiara = adoption(session.profile.id, BUKIT_KIARA)
  await seedAdoptions(page, [kiara])
  const all = await openActivity(page, kiara.adoptionId)
  const markers = page.locator('.activity-marker')
  const facts = page.locator('.activity-facts')
  await expect(markers).toHaveCount(all.markers.length)

  const applyFilter = async (label: 'Plant' | 'Status' | 'Period', value: string, expectUrl: RegExp) => {
    const loaded = page.waitForResponse((response) => isActivity(response.url()) && expectUrl.test(response.url()))
    await filterSelect(page, label).selectOption(value)
    return await (await loaded).json() as Activity
  }
  const sameSet = async (response: Activity, expected: ActivityMarker[]) => {
    expect(expected.length).toBeGreaterThan(0)
    expect(response.markers.map((marker) => marker.sightingId).sort()).toEqual(expected.map((marker) => marker.sightingId).sort())
    expect(response.filteredCount).toBe(expected.length)
    await expect(markers).toHaveCount(expected.length)
    await expect(facts).toContainText(`${expected.length} reports match these filters.`)
  }

  // Plant: a strict subset, and every marker left is that plant.
  const mikania = all.markers.filter((marker) => marker.speciesId === 'mikania-micrantha')
  expect(mikania.length).toBeLessThan(all.markers.length)
  await sameSet(await applyFilter('Plant', 'mikania-micrantha', /species_id=mikania-micrantha/), mikania)
  for (const label of await markers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''))) {
    expect(label).toMatch(/^Mikania micrantha;/)
  }

  // Plant + status narrow together.
  const mikaniaRemoved = mikania.filter((marker) => marker.status === 'removal_reported')
  await sameSet(await applyFilter('Status', 'removal_reported', /status=removal_reported/), mikaniaRemoved)
  await expect(page.locator('.activity-marker--screened')).toHaveCount(0)

  // Observation period joins the same query; the seed reports are all recent.
  await sameSet(await applyFilter('Period', '30', /period=30/), mikaniaRemoved)
  await expect(page).toHaveURL(/species_id=mikania-micrantha/)
  await expect(page).toHaveURL(/status=removal_reported/)
  await expect(page).toHaveURL(/period=30/)

  // Clearing restores every qualifying report; nothing stored was changed.
  // (The unfiltered result is still cached, so the page may not re-request it;
  // the stored data is read back separately.)
  await page.getByRole('button', { name: 'Clear filters' }).click()
  const after = await appFetch<Activity>(page, `${ADOPTIONS_PATH}/${kiara.adoptionId}/activity?`)
  expect(after.body.markers).toEqual(all.markers)
  await expect(page).not.toHaveURL(/species_id|status=|period=/)
  await expect(filterSelect(page, 'Plant')).toHaveValue('')
  await expect(filterSelect(page, 'Status')).toHaveValue('')
  await expect(filterSelect(page, 'Period')).toHaveValue('all')
  await expect(markers).toHaveCount(all.markers.length)
  await expect(facts).toContainText(`${all.markers.length} reports match these filters.`)
})

test('AC 6.3.4 Recent reporting concentrations', async ({ page }) => {
  // Mock layer only. The 250 m / three-report / 30-day grouping is computed by
  // the server, and the mock's seed sightings are too spread out to form a
  // group, so a concentration is injected into the activity response. This
  // proves how the page presents one; the calculation needs the real stack.
  const session = await startPrivateAccess(page)
  const kiara = adoption(session.profile.id, BUKIT_KIARA)
  await seedAdoptions(page, [kiara])
  const activity = await openActivity(page, kiara.adoptionId)
  const groups = page.locator('.activity-concentration')
  const facts = page.locator('.activity-facts')

  // Nothing qualifies in the seed, and the page does not invent a group.
  expect(activity.concentrations).toEqual([])
  expect(activity.concentrationCount).toBe(0)
  await expect(groups).toHaveCount(0)
  await expect(facts).toContainText('0 active reports are in concentrations of at least three reports within 250 m during the last 30 days.')

  const active = activity.markers.filter((marker) => marker.status === 'screened').slice(0, 4)
  expect(active).toHaveLength(4)
  const centroid = {
    latitude: active.reduce((total, marker) => total + marker.latitude, 0) / active.length,
    longitude: active.reduce((total, marker) => total + marker.longitude, 0) / active.length,
  }
  await overrideActivity(page, {
    ...activity,
    concentrationCount: 4,
    concentrations: [{ concentrationId: 'recent-1', reportCount: 4, ...centroid }],
  })
  await filterSelect(page, 'Period').selectOption('30')

  // The layer is on by default: the group is named and shows its report count.
  const layer = page.getByLabel('Recent reporting concentrations')
  await expect(layer).toBeChecked()
  await expect(groups).toHaveCount(1)
  await expect(groups).toHaveText('4')
  await expect(groups).toHaveAttribute('aria-label', 'Recent reporting concentration: 4 active reports')
  await expect(groups).toBeVisible()
  await expect(facts).toContainText('4 active reports are in concentrations of at least three reports within 250 m during the last 30 days.')
  // The individual report markers stay on the map alongside it.
  await expect(page.locator('.activity-marker')).toHaveCount(activity.markers.length)

  // It is a reporting concentration, never a density or abundance claim.
  const text = await page.locator('.activity-page__summary').innerText()
  expect(text).toContain('Recent reporting concentrations')
  expect(text).not.toMatch(/density|abundance|infestation|hotspot/i)

  // "When the activity layer is enabled": switching it off hides the group, on brings it back.
  await layer.uncheck()
  await expect(groups).toHaveCount(0)
  await layer.check()
  await expect(groups).toHaveCount(1)
})

test('AC 6.3.5 Reporting change comparison', async ({ page }) => {
  const session = await startPrivateAccess(page)
  const kiara = adoption(session.profile.id, BUKIT_KIARA)
  await seedAdoptions(page, [kiara])
  const activity = await openActivity(page, kiara.adoptionId)
  const facts = page.locator('.activity-facts')

  // Seed data: every report is from the last few hours, so days 0-29 hold them all and days 30-59 none.
  const recent = activity.markers.filter((marker) => Date.parse(marker.observationDate) > Date.now() - 30 * 86_400_000).length
  expect(recent).toBeGreaterThan(0)
  expect(activity.comparison).toEqual({ recent0To29Days: recent, prior30To59Days: 0, direction: 'increased' })
  await expect(facts).toContainText(`Raw report counts increased: ${recent} in days 0–29 versus 0 in days 30–59.`)

  // The other two outcomes cannot be produced by the mock's seed, so the
  // activity response is replaced in the page and re-requested via a filter.
  const period = filterSelect(page, 'Period')
  await overrideActivity(page, { ...activity, comparison: { recent0To29Days: 2, prior30To59Days: 5, direction: 'decreased' } })
  await period.selectOption('60')
  await expect(facts).toContainText('Raw report counts decreased: 2 in days 0–29 versus 5 in days 30–59.')

  await overrideActivity(page, { ...activity, comparison: { recent0To29Days: 3, prior30To59Days: 3, direction: 'unchanged' } })
  await period.selectOption('30')
  await expect(facts).toContainText('Raw report counts unchanged: 3 in days 0–29 versus 3 in days 30–59.')

  // A change in report count is never described as an ecological change.
  const text = await page.locator('.activity-page__summary').innerText()
  expect(text).not.toMatch(ECOLOGY_LANGUAGE)
  expect(text).not.toMatch(/\bbetter\b|\bworse\b|\bspreading\b|\bdeclin/i)
})

test('AC 6.3.6 No activity state', async ({ page }) => {
  const session = await startPrivateAccess(page)
  const forest = adoption(session.profile.id, KOTA_DAMANSARA)
  await seedAdoptions(page, [forest])
  const activity = await openActivity(page, forest.adoptionId)

  // The area is still drawn: the response carries its geometry and the map renders.
  expect(activity.geometry.type).toBe('Polygon')
  expect(activity.markers).toEqual([])
  expect(activity.concentrations).toEqual([])
  await expect(page.getByRole('heading', { level: 2, name: 'Kota Damansara Community Forest' })).toBeVisible()
  await expect(page.getByLabel('Community activity map').locator('canvas')).toBeVisible()
  await expect(page.locator('.activity-page__overlay')).toHaveText('No community reports recorded for this area.')

  // No synthetic markers or counts.
  await expect(page.locator('.activity-marker')).toHaveCount(0)
  await expect(page.locator('.activity-concentration')).toHaveCount(0)
  await expect(page.locator('.activity-facts')).toContainText('0 reports match these filters.')
  await expect(page.locator('.activity-facts')).toContainText('Raw report counts unchanged: 0 in days 0–29 versus 0 in days 30–59.')

  // No reports is not evidence of no plants.
  const text = await page.locator('.activity-page').innerText()
  expect(text).not.toMatch(/no invasive|free (of|from)|absent|absence|clear of|not present/i)
})

test('AC 6.3.1 Activity map reachable on a phone', async ({ page }) => {
  // Below 820px the summary stacks above the map. The page must grow with that
  // summary; a fixed height with overflow hidden clipped the map out of reach.
  await page.setViewportSize({ width: 375, height: 812 })
  const session = await startPrivateAccess(page)
  const kiara = adoption(session.profile.id, BUKIT_KIARA)
  await seedAdoptions(page, [kiara])
  await openActivity(page, kiara.adoptionId)

  const section = page.locator('.activity-page')
  const clipped = await section.evaluate((element) => element.scrollHeight - element.clientHeight)
  expect(clipped).toBeLessThanOrEqual(1)

  const map = page.getByLabel('Community activity map')
  await map.scrollIntoViewIfNeeded()
  const box = await map.boundingBox()
  const nav = await page.locator('nav.bottom-tabs').boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThan(300)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  if (nav) expect(box!.y).toBeLessThan(nav.y)
})
