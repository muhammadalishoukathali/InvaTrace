// Epic 4, stories 4.1 to 4.4: reporting a scan, the public map and its detail
// panel, nearest-feature context and My Records. One test per acceptance
// criterion, against the dev MSW mocks and the pinned development model.
//
// The mock API keeps its state in page memory, so a test navigates in-app
// (links and buttons) once it has created a report: a page.goto() would reload
// the page and drop that report.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { atLocation, KL_FIX, pinModelSpecies, referenceImage, scanPhoto, startPrivateAccess } from '../fixtures/app'

const MIKANIA = 'mikania_micrantha'
// More than 2 km from every landmark the mock knows, but inside Malaysia.
const REMOTE_FIX = { latitude: 2.9, longitude: 101.4, accuracy: 15 }

type StubTable = Record<string, { status?: number; body: unknown; delayMs?: number }>

/** MSW answers API calls inside the page, so neither page.route nor
 *  context.route ever sees them. For a response the mock cannot produce, wrap
 *  window.fetch before the app loads; keys are "METHOD /pathname". */
async function stubApi(page: Page, stubs: StubTable) {
  await page.addInitScript((table) => {
    const state = window as unknown as { __acStubs: typeof table }
    state.__acStubs = table
    const real = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      const hit = state.__acStubs[`${method} ${new URL(href, window.location.href).pathname}`]
      if (!hit) return real(input, init)
      if (hit.delayMs) await new Promise((resolve) => setTimeout(resolve, hit.delayMs))
      return new Response(JSON.stringify(hit.body), {
        status: hit.status ?? 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  }, stubs)
}

/** The live Overpass lookup is the one call MSW passes through to the network. */
async function stubOverpass(context: BrowserContext, mode: 'empty' | 'fail') {
  await context.route('https://overpass-api.de/**', (route) => mode === 'fail'
    ? route.abort('failed')
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [] }) }))
}

async function openReportForm(page: Page, file?: string) {
  await scanPhoto(page, file)
  await page.getByRole('button', { name: /Report sighting/ }).click()
  await expect(page).toHaveURL(/\/report$/)
}

/** Location -> Extent -> Consent -> Preview, leaving the wizard on the review step. */
async function fillWizardToPreview(page: Page, note?: string) {
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Single plant', { exact: true }).click()
  if (note) await page.getByRole('textbox').fill(note)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('checkbox', { name: /accurate/i }).check()
  await page.getByRole('checkbox', { name: /personal information/i }).check()
  await page.getByRole('button', { name: 'Review submission' }).click()
}

/** Submits the open wizard and returns what POST /api/v1/reports answered. */
async function submitReport(page: Page) {
  const created = page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/v1/reports' && response.request().method() === 'POST'
  ))
  await page.getByRole('button', { name: 'Submit report' }).click()
  const response = await created
  return {
    status: response.status(),
    sent: response.request().postDataJSON() as Record<string, unknown>,
    report: await response.json() as {
      id: string
      status: string
      trackingUrl: string
      sightingId: string | null
      submission: { location: { lat: number; lng: number }; locationAccuracyM: number }
    },
  }
}

async function publishReport(page: Page, file?: string) {
  await openReportForm(page, file)
  await fillWizardToPreview(page)
  const result = await submitReport(page)
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  return result
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

/** A flat grey photo whose development-model hash lands in the "uncertain"
 *  band. The model hashes the red channel of an 8x8 downscale and takes it
 *  modulo (classes + 5), so the grey level is worked out from the shipped
 *  class list instead of relying on how one fixture photo happens to hash. */
async function uncertainPhoto(page: Page) {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'public/models/invatrace-student33-v1/student33_species.json'), 'utf8',
  )) as { unknown_index?: number; classes: Array<{ class_index: number }> }
  const classes = manifest.classes.filter((entry) => entry.class_index !== manifest.unknown_index).length
  let level = -1
  for (let grey = 30; grey < 226 && level < 0; grey += 1) {
    let hash = 0
    for (let pixel = 0; pixel < 64; pixel += 1) hash = ((hash << 5) - hash + grey) | 0
    hash = Math.abs(hash)
    // A hash divisible by 17 is the development model's "too blurry" case.
    if (hash % 17 !== 0 && hash % (classes + 5) >= classes) level = grey
  }
  expect(level, 'a grey level in the uncertain band exists').toBeGreaterThan(0)
  const dataUrl = await page.evaluate((grey) => {
    const canvas = document.createElement('canvas')
    canvas.width = 320
    canvas.height = 320
    const context = canvas.getContext('2d')!
    context.fillStyle = `rgb(${grey}, ${grey}, ${grey})`
    context.fillRect(0, 0, 320, 320)
    return canvas.toDataURL('image/png')
  }, level)
  return { name: 'uncertain.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') }
}

const sightingDetailsDialog = (page: Page) => page.getByRole('dialog', { name: 'Sighting details' })

test('AC 4.1.1 Report eligibility and prefilling: an accepted invasive scan opens the report with its photo, species and confidence read-only, and submits the scan ID', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, MIKANIA)
  await startPrivateAccess(page)

  const scanSaved = page.waitForRequest((request) => (
    new URL(request.url()).pathname === '/api/v1/scans' && request.method() === 'POST'
  ))
  await scanPhoto(page)
  const scan = (await scanSaved).postDataJSON() as { captureId: string; predictedSpeciesId: string; confidence: number }
  expect(scan.predictedSpeciesId).toBe('mikania-micrantha')
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()

  // Opening the form calls no scan or report API: the scan travels in frontend state.
  const calledOnOpen: string[] = []
  const recordCall = (request: { url(): string; method(): string }) => {
    const pathname = new URL(request.url()).pathname
    if (/^\/api\/v1\/(scans|reports|uploads)/.test(pathname)) calledOnOpen.push(`${request.method()} ${pathname}`)
  }
  page.on('request', recordCall)
  await page.getByRole('button', { name: /Report sighting/ }).click()
  await expect(page).toHaveURL(/\/report$/)
  await expect(page.getByRole('heading', { name: 'Report a sighting' })).toBeVisible()
  await expect(page.getByText(/Accurate to ~15 m/)).toBeVisible()
  expect(calledOnOpen).toEqual([])
  page.off('request', recordCall)

  // The wizard shows photo, species and confidence on its review step (the
  // first step is the location), and offers no control to change them.
  await fillWizardToPreview(page)
  const form = page.getByRole('main')
  await expect(form.getByRole('img', { name: 'Report photo' })).toBeVisible()
  await expect(form.getByText('Mile-a-minute weed', { exact: true })).toBeVisible()
  await expect(form.getByText(`target · ${Math.round(scan.confidence * 100)}% confidence`)).toBeVisible()
  await expect(form.locator('input, select, textarea, [contenteditable="true"]')).toHaveCount(0)
  // The internal scan ID is not shown to the user...
  await expect(page.getByText(scan.captureId)).toHaveCount(0)

  // ...but it is submitted with the report, with the scan's species and confidence.
  const { status, sent } = await submitReport(page)
  expect(status).toBe(201)
  expect(sent).toMatchObject({
    captureId: scan.captureId,
    speciesId: 'mikania-micrantha',
    outcome: 'target',
    confidence: scan.confidence,
  })
})

test('AC 4.1.1 Report eligibility and prefilling: an uncertain result has no report control', async ({ page, context, baseURL }) => {
  // Not pinned: the photo itself decides the outcome. Information-only results
  // cannot be produced here (every class the shipped model knows is listed as
  // invasive); that branch is covered by malaysia-status.test.ts.
  await atLocation(context, baseURL)
  await startPrivateAccess(page)
  await page.goto('/scan')
  await page.locator('input[aria-label="Choose photo from gallery"]').setInputFiles(await uncertainPhoto(page))
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 5000 })
  const scanSaved = page.waitForRequest((request) => (
    new URL(request.url()).pathname === '/api/v1/scans' && request.method() === 'POST'
  ))
  await page.getByRole('button', { name: /Analyse plant/ }).click()
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 5000 })
  expect((await scanSaved).postDataJSON()).toMatchObject({ outcome: 'uncertain', predictedSpeciesId: null })

  const actions = page.getByRole('group', { name: 'Scan result actions' })
  await expect(actions.getByRole('button', { name: 'Scan again' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Report sighting/ })).toHaveCount(0)
  // The report route itself is closed without a draft.
  await page.goto('/report')
  await expect(page).toHaveURL(/\/scan$/)
})

test('AC 4.1.2 GPS and time capture: a granted location is shown for confirmation and submitted with its accuracy and the scan time', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, MIKANIA)
  await startPrivateAccess(page)
  const beforeScan = Date.now()
  await openReportForm(page)
  const afterScan = Date.now()

  // Latitude, longitude and reported accuracy are displayed before anything is sent.
  await expect(page.getByText('3.14970, 101.64120')).toBeVisible()
  await expect(page.getByText(/Accurate to ~15 m/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()

  await fillWizardToPreview(page)
  await expect(page.getByText('3.14970, 101.64120')).toBeVisible()
  await expect(page.getByText('±15 m GPS')).toBeVisible()
  // Slow the submission down so the observation time is clearly the scan's.
  await page.waitForTimeout(1200)
  const { sent } = await submitReport(page)
  expect(sent).toMatchObject({
    location: { lat: KL_FIX.latitude, lng: KL_FIX.longitude },
    locationAccuracyM: KL_FIX.accuracy,
  })
  const observedAt = Date.parse(sent.observedAt as string)
  expect(observedAt).toBeGreaterThanOrEqual(beforeScan - 1000)
  expect(observedAt).toBeLessThanOrEqual(afterScan)
})

test('AC 4.1.2 GPS and time capture: denied location keeps submission disabled and keeps the scan for Retry location or Cancel', async ({ page }) => {
  // No geolocation permission is granted, so the browser refuses the request.
  await pinModelSpecies(page, MIKANIA)
  await startPrivateAccess(page)
  await openReportForm(page)

  await expect(page.getByText('Location access denied')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Retry location' })).toBeEnabled()
  await page.getByRole('button', { name: 'Retry location' }).click()
  await expect(page.getByText('Location access denied')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()

  // Cancel drops the report but keeps the scan: its photo is still loaded, its
  // record is still saved, and it can be analysed and reported again.
  await page.getByRole('button', { name: /Cancel report/ }).click()
  await expect(page).toHaveURL(/\/scan(\/result)?$/)
  await expect(page.getByText('Photo quality check passed')).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('invatrace-scan-history-v1') ?? '{"records":[]}') as {
    records: Array<{ speciesId: string; outcome: string }>
  })
  expect(saved.records).toHaveLength(1)
  expect(saved.records[0]).toMatchObject({ speciesId: 'mikania-micrantha', outcome: 'target' })
  if (!/\/scan\/result$/.test(page.url())) await page.getByRole('button', { name: /Analyse plant/ }).click()
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Report sighting/ })).toBeVisible()
})

test('AC 4.1.2 GPS and time capture: coordinates outside Malaysia keep submission disabled', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL, { latitude: 51.5072, longitude: -0.1276, accuracy: 15 })
  await pinModelSpecies(page, MIKANIA)
  await startPrivateAccess(page)
  await openReportForm(page)

  await expect(page.getByText('51.50720, -0.12760')).toBeVisible()
  await expect(page.getByText('Location is outside Malaysia')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
})

test('AC 4.1.2 GPS and time capture: accuracy worse than 350 m warns but does not disable submission, and screening returns needs_rescan', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL, { ...KL_FIX, accuracy: 500 })
  await pinModelSpecies(page, MIKANIA)
  const session = followSession(page)
  await startPrivateAccess(page)
  await openReportForm(page)

  // The form warns that the report is likely to come back for another scan...
  await expect(page.getByText(/Accurate to ~500 m/)).toBeVisible()
  await expect(page.getByText('GPS accuracy is worse than 350 m')).toBeVisible()
  await expect(page.getByText(/Automated screening sends reports with accuracy above 350 m back for a rescan\./)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Re-locate me' })).toBeVisible()
  // ...but a non-negative accuracy inside Malaysia keeps submission enabled.
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()

  await fillWizardToPreview(page)
  await expect(page.getByRole('note')).toContainText('GPS accuracy is ±500 m. Reports above 350 m are sent back for a rescan')
  await expect(page.getByRole('button', { name: 'Submit report' })).toBeEnabled()
  const { status, sent, report } = await submitReport(page)
  expect(status).toBe(201)
  expect(sent.locationAccuracyM).toBe(500)

  // Server-side screening returns it as needs_rescan; it is never published.
  await expect(page.getByRole('heading', { name: 'A better GPS fix is needed' })).toBeVisible({ timeout: 8000 })
  const screened = await getJson<{ status: string; validation: { reasonCodes: string[] } }>(page, `/api/v1/reports/${report.id}`, session.current())
  expect(screened.status).toBe('needs_rescan')
  expect(screened.validation.reasonCodes.length).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { name: 'Report published' })).toHaveCount(0)
})

test('AC 4.1.3 Relational report persistence: presign, upload and report run in order and the response carries the ID, coordinates and processing status', async ({ page, context, baseURL }) => {
  // Mock layer: proves the request sequence, the submitted fields and the
  // response contract, and that the marker waits for "screened". The single
  // relational row and the rollback are server rules (see ac-real).
  await atLocation(context, baseURL)
  await pinModelSpecies(page, MIKANIA)
  const session = followSession(page)
  const { profile } = await startPrivateAccess(page)

  const calls: string[] = []
  let presigned: { photoKey: string; uploadUrl: string } | null = null
  page.on('response', async (response) => {
    const url = new URL(response.url())
    const method = response.request().method()
    if (url.pathname === '/api/v1/uploads/presign') {
      calls.push('presign')
      presigned = await response.json() as { photoKey: string; uploadUrl: string }
    } else if (method === 'PUT' && url.hostname === 'mock-s3.local') {
      calls.push(`upload ${response.url()}`)
    } else if (url.pathname === '/api/v1/reports' && method === 'POST') {
      calls.push('report')
    }
  })

  await openReportForm(page)
  await fillWizardToPreview(page, 'Beside the marked trail.')
  const { status, sent, report } = await submitReport(page)

  expect(status).toBe(201)
  expect(presigned).not.toBeNull()
  expect(calls).toEqual(['presign', `upload ${presigned!.uploadUrl}`, 'report'])
  // Everything the report row needs is in the one submission.
  expect(sent).toMatchObject({
    photoKey: presigned!.photoKey,
    speciesId: 'mikania-micrantha',
    location: { lat: KL_FIX.latitude, lng: KL_FIX.longitude },
    locationAccuracyM: KL_FIX.accuracy,
    notes: 'Beside the marked trail.',
  })
  expect(sent.captureId).toEqual(expect.any(String))
  expect(sent.observedAt).toEqual(expect.any(String))
  // The identity comes from the session, never from the request body.
  expect(JSON.stringify(sent)).not.toContain(profile.id)

  // The response returns the report ID, the coordinates and the current status.
  expect(report.id).toEqual(expect.any(String))
  expect(report.status).toBe('processing')
  expect(report.submission.location).toEqual({ lat: KL_FIX.latitude, lng: KL_FIX.longitude })

  // No public marker while processing; one marker once the report is screened.
  const marker = `report-${report.id}`
  const whileProcessing = await getJson<{ items: Array<{ id: string }> }>(page, '/api/v1/sightings')
  expect(whileProcessing.items.map((item) => item.id)).not.toContain(marker)
  await expect.poll(async () => (
    (await getJson<{ status: string }>(page, `/api/v1/reports/${report.id}`, session.current())).status
  ), { timeout: 8000 }).toBe('screened')
  const afterScreening = await getJson<{ items: Array<{ id: string }> }>(page, '/api/v1/sightings')
  expect(afterScreening.items.filter((item) => item.id === marker)).toHaveLength(1)
  const mine = await getJson<{ items: Array<{ id: string }> }>(page, '/api/v1/reports/mine', session.current())
  expect(mine.items.filter((item) => item.id === report.id)).toHaveLength(1)
})

test('AC 4.1.3 Relational report persistence: a failed save leaves no report and no public marker', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, MIKANIA)
  const session = followSession(page)
  await startPrivateAccess(page)
  await openReportForm(page)
  await fillWizardToPreview(page)
  const markersBefore = (await getJson<{ items: unknown[] }>(page, '/api/v1/sightings')).items.length

  // One-shot mock hook: the report transaction answers 500.
  await page.evaluate(() => { window.__msw = { ...window.__msw, failReport: true } })
  const { status } = await submitReport(page)
  expect(status).toBe(500)

  // The user is told it was not sent; it is never described as submitted or published.
  await expect(page.getByRole('heading', { name: 'Saved for later' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Report (submitted|published)/ })).toHaveCount(0)
  const mine = await getJson<{ items: unknown[] }>(page, '/api/v1/reports/mine', session.current())
  expect(mine.items).toHaveLength(0)
  expect((await getJson<{ items: unknown[] }>(page, '/api/v1/sightings')).items).toHaveLength(markersBefore)
})

test('AC 4.1.4 Successful publication feedback: Report submitted with a tracking page, then Report published with View on map once screened', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, MIKANIA)
  await startPrivateAccess(page)
  await openReportForm(page)
  await fillWizardToPreview(page)

  // GET /api/v1/reports/{id} turning screened is what switches the screen over.
  const screened = page.waitForResponse(async (response) => (
    /^\/api\/v1\/reports\/[^/]+$/.test(new URL(response.url()).pathname)
    && response.request().method() === 'GET'
    && (await response.json() as { status: string }).status === 'screened'
  ))
  const { report } = await submitReport(page)
  expect(report.status).toBe('processing')
  // While the API still says processing the screen says submitted, not published,
  // and offers the tracking page.
  await expect(page.getByRole('heading', { name: 'Report submitted' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Report published' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'View report' })).toBeVisible()
  expect(report.trackingUrl).toBe(`/reports/${report.id}`)

  expect(new URL((await screened).url()).pathname).toBe(`/api/v1/reports/${report.id}`)
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible()
  await expect(page.getByText(/^Community report [-–] not expert validated$/)).toBeVisible()
  const viewOnMap = page.getByRole('button', { name: 'View on map' })
  await expect(viewOnMap).toBeVisible()

  // The marker exists now that the sightings API returns the screened sighting.
  const listed = await getJson<{ items: Array<{ id: string; status: string }> }>(page, '/api/v1/sightings')
  expect(listed.items.find((item) => item.id === `report-${report.id}`)).toMatchObject({ status: 'screened' })
  await viewOnMap.click()
  await expect(page).toHaveURL(new RegExp(`/map\\?sighting=report-${report.id}$`))
  await expect(page.locator(`.map-pin[data-sighting-id="report-${report.id}"]`)).toHaveCount(1)
  await expect(sightingDetailsDialog(page).getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()
})

test('AC 4.1.4 Successful publication feedback: the tracking page follows the report from the submitted screen', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, MIKANIA)
  await startPrivateAccess(page)
  await openReportForm(page)
  await fillWizardToPreview(page)
  const { report } = await submitReport(page)

  await expect(page.getByRole('heading', { name: 'Report submitted' })).toBeVisible()
  await page.getByRole('button', { name: 'View report' }).click()
  await expect(page).toHaveURL(new RegExp(`/reports/${report.id}$`))
  await expect(page.getByText(`Report ${report.id.slice(0, 8)}`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText(/Community report [-–] not expert validated/)).toBeVisible()
})

test('AC 4.1.4 Successful publication feedback: a needs_rescan report is never described as published and gets no marker', async ({ page, context, baseURL }) => {
  // ±500 m is above the screening limit (250 m in the AC, 350 m in code for now).
  await atLocation(context, baseURL, { ...KL_FIX, accuracy: 500 })
  await pinModelSpecies(page, MIKANIA)
  const session = followSession(page)
  await startPrivateAccess(page)
  await openReportForm(page)
  await fillWizardToPreview(page)
  const { report } = await submitReport(page)

  await expect(page.getByRole('heading', { name: 'A better GPS fix is needed' })).toBeVisible({ timeout: 8000 })
  expect((await getJson<{ status: string }>(page, `/api/v1/reports/${report.id}`, session.current())).status).toBe('needs_rescan')
  await expect(page.getByText(/published/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'View on map' })).toHaveCount(0)
  const listed = await getJson<{ items: Array<{ id: string }> }>(page, '/api/v1/sightings')
  expect(listed.items.map((item) => item.id)).not.toContain(`report-${report.id}`)

  await page.getByRole('button', { name: 'View report' }).click()
  await expect(page.getByRole('heading', { name: 'A new scan is needed' })).toBeVisible()
  await expect(page.getByText(/published/i)).toHaveCount(0)
})

for (const status of ['processing', 'rejected', 'validation_unavailable'] as const) {
  test(`AC 4.1.4 Successful publication feedback: a ${status} report's tracking page does not say published`, async ({ page }) => {
    // The mock cannot hold a report in these states, so the tracking response is stubbed.
    const id = `00000000-0000-4000-8000-0000000000${status.length}`
    await stubApi(page, {
      [`GET /api/v1/reports/${id}`]: {
        body: {
          id, status, createdAt: new Date().toISOString(), trackingUrl: `/reports/${id}`,
          sightingId: null, retainedReportId: null,
          validation: { reasonCodes: [], retryable: false, policyVersion: null, screeningMethod: null },
          submission: {
            photoKey: 'evidence/x.jpg', speciesId: 'mikania-micrantha', outcome: 'target', confidence: 0.9,
            modelVersion: 'development-model', observedAt: new Date().toISOString(), captureId: 'capture',
            captureSource: 'gallery', location: { lat: 3.1497, lng: 101.6412 }, locationAccuracyM: 15,
            extent: 'single', notes: '', consent: { accurate: true, noPII: true },
          },
        },
      },
    })
    await startPrivateAccess(page)
    await page.goto(`/reports/${id}`)
    await expect(page.getByText(`Report ${id.slice(0, 8)}`)).toBeVisible()
    await expect(page.locator('.report-tracking h1')).not.toHaveText(/published/i)
    await expect(page.getByText(/Report published|visible on the shared map/i)).toHaveCount(0)
    await expect(page.getByRole('link', { name: /View on map/i })).toHaveCount(0)
  })
}

test('AC 4.2.1 Public report markers: one community-report marker per returned sighting and the counts match the API', async ({ page }) => {
  const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/sightings')
  await startPrivateAccess(page)
  const api = await (await loaded).json() as { items: Array<{ id: string; status: string; location: { lat: number; lng: number } }> }
  expect(api.items.length).toBeGreaterThan(1)

  // One marker per returned sighting, no more and no fewer.
  const pins = page.locator('.map-pin')
  await expect(pins).toHaveCount(api.items.length)
  const pinIds = await pins.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.sightingId))
  expect([...pinIds].sort()).toEqual(api.items.map((item) => item.id).sort())

  // Every published community report carries the community-report wording.
  const screened = api.items.filter((item) => item.status === 'screened')
  expect(screened.length).toBeGreaterThan(0)
  for (const item of screened) {
    await expect(page.locator(`.map-pin[data-sighting-id="${item.id}"]`))
      .toHaveAttribute('aria-label', /Community report - not expert validated$/)
  }

  // The marker count, the live count and the list count all equal the API result count.
  await expect(page.getByRole('button', { name: /Open reports list/ }))
    .toHaveAttribute('aria-label', new RegExp(`^Showing ${api.items.length} reports\\.`))
  await page.getByRole('button', { name: /Open reports list/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Community reports list' })
  await expect(sheet.locator('.map-reports-sheet__count')).toHaveText(`${api.items.length} community reports match the current filters.`)
  await expect(sheet.locator('.map-reports-sheet__item')).toHaveCount(api.items.length)
  await expect(sheet.locator('.map-reports-sheet__item-meta').filter({ hasText: 'Community report - not expert validated' }))
    .toHaveCount(screened.length)

  // "When the map ... refreshes": a refetch draws the same set again.
  await sheet.getByRole('button', { name: 'Follow-up needed', exact: true }).click()
  await expect(pins).not.toHaveCount(api.items.length)
  await sheet.getByRole('button', { name: 'Follow-up needed', exact: true }).click()
  await expect(pins).toHaveCount(api.items.length)
})

test('AC 4.2.1 Public report markers: a record with another or a missing status is not rendered', async ({ page }) => {
  const base = {
    speciesId: 'mikania-micrantha', speciesName: 'Mikania micrantha', latinName: 'Mikania micrantha', risk: 'high',
    precisionReduced: false, reportCount: 1, lastReportedAt: new Date().toISOString(),
    place: { displayName: 'Test location', areaName: null, trailName: null, source: 'seed' },
    thumbnailUrl: null, confidence: 0.8, nearestFeatureType: null, nearestFeatureName: null,
    nearestFeatureDistanceM: null, screeningMethod: 'deterministic_rules',
  }
  await stubApi(page, {
    'GET /api/v1/sightings': {
      body: {
        items: [
          { ...base, id: 'ok', status: 'screened', location: { lat: 3.1497, lng: 101.6412 } },
          { ...base, id: 'still-processing', status: 'processing', location: { lat: 3.1507, lng: 101.6422 } },
          { ...base, id: 'no-status', location: { lat: 3.1487, lng: 101.6402 } },
        ],
      },
    },
  })
  await startPrivateAccess(page)
  await expect(page.locator('.map-pin[data-sighting-id="ok"]')).toHaveCount(1)
  await expect(page.locator('.map-pin')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Open reports list/ })).toHaveAttribute('aria-label', /^Showing 1 report\./)
})

test('AC 4.2.2 Report detail panel: species, photo, confidence, time, location context and the community-report label, with no identity data', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await stubOverpass(context, 'empty')
  await pinModelSpecies(page, MIKANIA)
  const tokens = followSession(page)
  const session = await startPrivateAccess(page)

  // Part 1 - privacy on a sighting this very profile published.
  const { report } = await publishReport(page)
  const ownDetail = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/v1/sightings/report-${report.id}`
  ))
  await page.getByRole('button', { name: 'View on map' }).click()
  const ownPayload = JSON.stringify(await (await ownDetail).json())
  const dialog = sightingDetailsDialog(page)
  await expect(dialog.getByRole('heading', { name: 'Mile-a-minute weed' })).toBeVisible()
  const secrets = [...tokens.tokens, session.profile.id, session.recoveryCodes[0]]
  expect(tokens.tokens.length).toBeGreaterThan(0)
  if (session.profile.publicId) secrets.push(session.profile.publicId)
  const panelText = await dialog.innerText()
  for (const secret of secrets) {
    expect(ownPayload).not.toContain(secret)
    expect(panelText).not.toContain(secret)
  }
  expect(ownPayload).not.toMatch(/"(accessToken|recoveryCodes?|recoveryKey|installationToken|ownerProfileId|profileId|publicToken|publicId)"/)
  // A sighting published without a stored thumbnail shows the label as plain text.
  await expect(dialog.getByText('Community report - not expert validated', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close sighting details' }).click()

  // Part 2 - the same panel opened from the matching list item of a seeded sighting.
  await page.getByRole('button', { name: /Open reports list/ }).click()
  const detailLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/sightings/s-04')
  await page.getByRole('dialog', { name: 'Community reports list' })
    .locator('.map-reports-sheet__item').filter({ hasText: 'Ridge Path' }).click()
  const detail = await (await detailLoaded).json() as {
    speciesName: string; latinName: string; confidence: number; thumbnailUrl: string
    location: { lat: number; lng: number }; nearestFeatureName: string; nearestFeatureDistanceM: number
  }
  await expect(dialog.getByRole('heading', { name: detail.speciesName })).toBeVisible()
  await expect(dialog.getByText(detail.latinName, { exact: true })).toBeVisible()
  // Photo thumbnail: the reporter's evidence, straight from the API's thumbnailUrl.
  const photo = dialog.getByRole('img', { name: `Reporter photo of ${detail.speciesName}` })
  await expect(photo).toBeVisible()
  expect(await photo.getAttribute('src')).toContain(detail.thumbnailUrl)
  const record = dialog.getByRole('region', { name: 'Report information' })
  await expect(record.getByText(`${Math.round(detail.confidence * 100)}%`, { exact: true })).toBeVisible()
  await expect(record.locator('.pin-sheet__record-row').filter({ hasText: 'Reported' }).locator('dd')).toHaveText(/^\d+ (min|h|d) ago$/)
  // Location context: the named feature with its distance, and the coordinates.
  await expect(record.getByText(new RegExp(`^${detail.nearestFeatureName} · \\w+, about ${detail.nearestFeatureDistanceM} m away$`))).toBeVisible()
  await expect(record.getByText(`${detail.location.lat.toFixed(5)}, ${detail.location.lng.toFixed(5)}`)).toBeVisible()
  // With an evidence photo the label sits in the photo caption, and the exact
  // phrase is the panel's accessible summary.
  await expect(dialog.getByText('Community report evidence')).toBeVisible()
  await expect(dialog.getByText('Uploaded by a reporter · not expert validated')).toBeVisible()
  await expect(dialog.getByLabel(/Community report - not expert validated$/)).toBeVisible()
  const seededText = await dialog.innerText()
  for (const secret of secrets) expect(seededText).not.toContain(secret)
})

test('AC 4.2.3 Species filter and accessible fallback: one plant filters markers and list together and every marker has a keyboard-operable list item', async ({ page }) => {
  await startPrivateAccess(page)
  const pins = page.locator('.map-pin')
  await expect(pins.first()).toBeVisible()
  const total = await pins.count()
  expect(total).toBeGreaterThan(1)
  await page.getByRole('button', { name: /Open reports list/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Community reports list' })

  // The selection is sent to the API as a species query parameter.
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1/sightings' && url.searchParams.getAll('species').length > 0
  })
  await sheet.getByLabel('Plant').selectOption({ label: 'Mile-a-minute weed' })
  const response = await filtered
  expect(new URL(response.url()).searchParams.getAll('species')).toEqual(['mikania-micrantha'])
  const matching = (await response.json() as { items: Array<{ id: string; speciesId: string }> }).items
  expect(matching.length).toBeGreaterThan(0)
  expect(matching.length).toBeLessThan(total)
  expect(new Set(matching.map((item) => item.speciesId))).toEqual(new Set(['mikania-micrantha']))

  // Markers and list show only the matching reports.
  await expect(pins).toHaveCount(matching.length)
  const pinIds = await pins.evaluateAll((elements) => elements.map((element) => (element as HTMLElement).dataset.sightingId))
  expect([...pinIds].sort()).toEqual(matching.map((item) => item.id).sort())
  const items = sheet.locator('.map-reports-sheet__item')
  await expect(items).toHaveCount(matching.length)
  for (const name of await sheet.locator('.map-reports-sheet__item-name').allInnerTexts()) expect(name).toContain('Mikania micrantha')

  // The active filter and the result count are exposed.
  await expect(sheet.getByLabel('Plant')).toHaveValue('mikania-micrantha')
  await expect(sheet.locator('.map-reports-sheet__count')).toHaveText(`${matching.length} community reports match the current filters.`)
  await expect(page.getByRole('button', { name: /Open reports list/ }))
    .toHaveAttribute('aria-label', new RegExp(`^Showing ${matching.length} reports \\(1 filter active\\)`))

  // Accessible fallback: a screen-reader list mirrors every marker...
  const mirror = page.locator('section.sr-only[aria-label="Community reports list"]')
  await expect(mirror.getByRole('button')).toHaveCount(matching.length)
  // ...and a list item opens the report details from the keyboard alone.
  await items.first().focus()
  await expect(items.first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(sightingDetailsDialog(page).getByRole('heading', { name: 'Mikania micrantha' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sightingDetailsDialog(page)).toHaveCount(0)

  // Clearing restores every report (choosing an item closed the list).
  await page.getByRole('button', { name: /Open reports list/ }).click()
  await sheet.getByRole('button', { name: 'Clear filters' }).click()
  await expect(pins).toHaveCount(total)
})

test('AC 4.2.3 Species filter and accessible fallback: one species is selected at a time and sent as a single species parameter', async ({ page }) => {
  await startPrivateAccess(page)
  await expect(page.locator('.map-pin').first()).toBeVisible()
  await page.getByRole('button', { name: /Open reports list/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Community reports list' })
  const plant = sheet.getByLabel('Plant')
  // A single-choice control.
  expect(await plant.evaluate((element) => (element as HTMLSelectElement).multiple)).toBe(false)

  const speciesRequests: string[][] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/v1/sightings' && url.searchParams.has('species')) speciesRequests.push(url.searchParams.getAll('species'))
  })
  for (const choice of [
    { label: 'Mile-a-minute weed', speciesId: 'mikania-micrantha', latin: 'Mikania micrantha' },
    { label: 'Siam weed', speciesId: 'chromolaena-odorata', latin: 'Chromolaena odorata' },
  ]) {
    const filtered = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/v1/sightings' && url.searchParams.get('species') === choice.speciesId
    })
    await plant.selectOption({ label: choice.label })
    const matching = (await (await filtered).json() as { items: Array<{ speciesId: string }> }).items
    expect(matching.length).toBeGreaterThan(0)
    // The new choice replaces the previous one everywhere.
    await expect(plant).toHaveValue(choice.speciesId)
    await expect(page.locator('.map-pin')).toHaveCount(matching.length)
    await expect(sheet.locator('.map-reports-sheet__item')).toHaveCount(matching.length)
    for (const name of await sheet.locator('.map-reports-sheet__item-name').allInnerTexts()) expect(name).toContain(choice.latin)
    await expect(page.getByRole('button', { name: /Open reports list/ }))
      .toHaveAttribute('aria-label', new RegExp(`^Showing ${matching.length} reports? \\(1 filter active\\)`))
  }
  // Every filtered request carried exactly one species.
  expect(speciesRequests.length).toBeGreaterThanOrEqual(2)
  for (const sent of speciesRequests) expect(sent).toHaveLength(1)
})

test('AC 4.3.1 Nearest-feature lookup: the stored feature type, name and distance are shown and the coordinates are unchanged', async ({ page, context }) => {
  // Mock layer: proves the panel shows what the API stored. The 5 km search,
  // the tag allow-list and the geodesic distance are server rules.
  let liveLookups = 0
  await context.route('https://overpass-api.de/**', (route) => {
    liveLookups += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ elements: [{ type: 'way', id: 1, center: { lat: 3.1489, lon: 101.6398 }, tags: { leisure: 'park', name: 'A different live park' } }] }),
    })
  })
  await startPrivateAccess(page)
  const listed = await getJson<{ items: Array<{ id: string; location: { lat: number; lng: number } }> }>(page, '/api/v1/sightings')
  const detailLoaded = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/sightings/s-04')
  await page.goto('/map?sighting=s-04')
  const detail = await (await detailLoaded).json() as {
    location: { lat: number; lng: number }
    nearestFeatureType: string; nearestFeatureName: string; nearestFeatureDistanceM: number
  }
  expect(detail.nearestFeatureType).toBe('path')
  expect(detail.nearestFeatureName).toEqual(expect.any(String))
  expect(detail.nearestFeatureDistanceM).toBeLessThanOrEqual(5000)

  const record = sightingDetailsDialog(page).getByRole('region', { name: 'Report information' })
  const near = record.locator('.pin-sheet__record-row').filter({ hasText: 'Near' })
  // Name, feature type and distance exactly as stored; the live lookup does not replace them.
  await expect(near.locator('dd')).toHaveText(`${detail.nearestFeatureName} · trail, about ${detail.nearestFeatureDistanceM} m away`)
  await expect(near).toContainText('Recorded at publication time from OpenStreetMap')
  await expect.poll(() => liveLookups).toBeGreaterThan(0)
  await expect(near.locator('dd')).not.toContainText('A different live park')
  // The lookup does not move the report: list, detail and panel agree on the point.
  expect(detail.location).toEqual(listed.items.find((item) => item.id === 's-04')!.location)
  await expect(record.getByText(`${detail.location.lat.toFixed(5)}, ${detail.location.lng.toFixed(5)}`)).toBeVisible()
})

for (const scenario of [
  { name: 'no named feature within 5 km', overpass: 'empty' as const },
  { name: 'the lookup service fails', overpass: 'fail' as const },
]) {
  test(`AC 4.3.2 No-result and service-failure fallback: ${scenario.name}`, async ({ page, context, baseURL }) => {
    await atLocation(context, baseURL, REMOTE_FIX)
    await stubOverpass(context, scenario.overpass)
    // The location-context service is down as well; reporting must still work.
    if (scenario.overpass === 'fail') {
      await stubApi(page, { 'POST /api/v1/location-context': { status: 503, body: { detail: 'Location context unavailable' } } })
    }
    await pinModelSpecies(page, MIKANIA)
    await startPrivateAccess(page)

    // An otherwise valid report is still saved and published.
    await openReportForm(page)
    if (scenario.overpass === 'fail') {
      await expect(page.getByText('Protected-area boundary uncertain')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
    }
    await fillWizardToPreview(page)
    const { status, report } = await submitReport(page)
    expect(status).toBe(201)
    await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })

    const detailLoaded = page.waitForResponse((response) => (
      new URL(response.url()).pathname === `/api/v1/sightings/report-${report.id}`
    ))
    await page.getByRole('button', { name: 'View on map' }).click()
    const detail = await (await detailLoaded).json() as { nearestFeatureName: string | null; place: { source: string } }
    expect(detail.nearestFeatureName).toBeNull()
    expect(detail.place.source).toBe('fallback')

    // Map detail: the coordinates and the fixed sentence, never an invented place.
    const record = sightingDetailsDialog(page).getByRole('region', { name: 'Report information' })
    const near = record.locator('.pin-sheet__record-row').filter({ hasText: 'Near' })
    await expect(near.locator('dd')).toHaveText('No named trail, park or forest found nearby')
    await expect(record.getByText('2.90000, 101.40000')).toBeVisible()
    await sightingDetailsDialog(page).getByRole('button', { name: 'Close sighting details' }).click()

    // The matching list item says the same.
    await page.getByRole('button', { name: /Open reports list/ }).click()
    await expect(page.getByRole('dialog', { name: 'Community reports list' })
      .locator('.map-reports-sheet__item-place').first()).toHaveText('No named trail, park or forest found nearby')
  })
}

test('AC 4.4.1 View my records: device scans and this profile\'s submitted reports, each opening its report or the map', async ({ page, context, baseURL }) => {
  await atLocation(context, baseURL)
  await pinModelSpecies(page, MIKANIA)
  const session = followSession(page)
  await startPrivateAccess(page)

  // A first scan that is never reported stays a device-only record.
  await scanPhoto(page)
  await page.getByRole('button', { name: 'Scan again' }).click()
  await expect(page).toHaveURL(/\/scan$/)
  // A second scan (a different photo) is reported.
  await page.locator('input[aria-label="Choose photo from gallery"]').setInputFiles(referenceImage('chromolaena-odorata.jpg'))
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /Analyse plant/ }).click()
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 5000 })
  await page.getByRole('button', { name: /Report sighting/ }).click()
  await fillWizardToPreview(page)
  const { report } = await submitReport(page)
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  await page.getByRole('button', { name: 'View on map' }).click()
  await sightingDetailsDialog(page).getByRole('button', { name: 'Close sighting details' }).click()
  // A gallery scan is stored without a position. Give the device-only record
  // one, as a camera scan taken on site has, so its map action can be checked.
  await page.evaluate((fix) => {
    const key = 'invatrace-scan-history-v1'
    const history = JSON.parse(localStorage.getItem(key)!) as { records: Array<{ submission?: unknown; location: unknown; locationAccuracyM: unknown }> }
    const unsubmitted = history.records.filter((record) => !record.submission)
    unsubmitted[unsubmitted.length - 1].location = { lat: fix.latitude, lng: fix.longitude }
    unsubmitted[unsubmitted.length - 1].locationAccuracyM = fix.accuracy
    localStorage.setItem(key, JSON.stringify(history))
  }, KL_FIX)

  // Opening My Records asks for this profile's reports, authenticated, 100 at a time.
  const mineRequested = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/reports/mine')
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /^(Records|My records)$/ }).click()
  await expect(page).toHaveURL(/\/reports$/)
  const mineResponse = await mineRequested
  expect(new URL(mineResponse.url()).searchParams.get('limit')).toBe('100')
  expect(mineResponse.request().headers().authorization).toBe(`Bearer ${session.current()}`)
  const mine = await mineResponse.json() as { items: Array<{ id: string; createdAt: string }> }
  expect(mine.items.map((item) => item.id)).toEqual([report.id])

  const records = page.getByRole('region', { name: 'My records' })
  // Submitted report: species, current status, relative date and shortened reference.
  const submitted = records.locator('.my-reports__results').filter({ has: page.getByRole('heading', { name: 'Submitted records' }) })
  const row = submitted.locator('.my-reports__item')
  await expect(row).toHaveCount(mine.items.length)
  await expect(row.locator('.my-reports__species')).toContainText('Mile-a-minute weed')
  await expect(row.locator('.my-reports__species')).toContainText('Mikania micrantha')
  await expect(row.locator('.my-reports__status')).toHaveText('Published')
  await expect(row.locator('.my-reports__date')).toHaveText('Today')
  await expect(row.locator('.my-reports__ref')).toHaveText(`Ref ${report.id.slice(0, 8).toUpperCase()}`)
  await expect(row.getByRole('link', { name: /report on map$/ })).toHaveAttribute('href', `/map?sighting=report-${report.id}`)

  // Device scan: plant name, confidence, observation date, submission state and a map action.
  const local = records.locator('.my-reports__results').filter({ has: page.getByRole('heading', { name: 'Saved on this device' }) })
  const scanRow = local.locator('.my-reports__item')
  await expect(scanRow).toHaveCount(1)
  await expect(scanRow.locator('.my-reports__species')).toContainText('Mile-a-minute weed')
  await expect(scanRow.locator('.my-reports__confidence')).toHaveText(/^\d{2}% match$/)
  await expect(scanRow.locator('.my-reports__date')).toHaveText('Today')
  await expect(scanRow.locator('.my-reports__status')).toHaveText('Not submitted')
  await expect(scanRow.getByRole('link', { name: /scan location on map$/ })).toBeVisible()

  // Selecting the submitted report opens /reports/{report_id}.
  const reportOpened = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/reports/${report.id}`)
  await row.locator('.my-reports__link').click()
  await expect(page).toHaveURL(new RegExp(`/reports/${report.id}$`))
  expect((await reportOpened).status()).toBe(200)
  await expect(page.getByText(`Report ${report.id.slice(0, 8)}`)).toBeVisible()
})

test('AC 4.4.1 View my records: submitted reports are listed newest-first, after a loading state', async ({ page }) => {
  // Stubbed list in a scrambled order: the page must not depend on arrival order.
  const day = 86_400_000
  const stubbed = (id: string, daysAgo: number, status: string, speciesId: string) => ({
    id, status, createdAt: new Date(Date.now() - daysAgo * day - 60_000).toISOString(), trackingUrl: `/reports/${id}`,
    sightingId: null, retainedReportId: null,
    validation: { reasonCodes: [], retryable: false, policyVersion: null, screeningMethod: null },
    submission: {
      photoKey: 'evidence/x.jpg', speciesId, outcome: 'target', confidence: 0.9, modelVersion: 'development-model',
      observedAt: new Date(Date.now() - daysAgo * day).toISOString(), captureId: `capture-${id}`, captureSource: 'gallery',
      location: { lat: 3.1497, lng: 101.6412 }, locationAccuracyM: 15, extent: 'single', notes: '',
      consent: { accurate: true, noPII: true },
    },
  })
  await stubApi(page, {
    'GET /api/v1/reports/mine': {
      delayMs: 1500,
      body: {
        items: [
          stubbed('bbbbbbbb-0000-4000-8000-000000000002', 3, 'needs_rescan', 'chromolaena-odorata'),
          stubbed('aaaaaaaa-0000-4000-8000-000000000001', 0, 'processing', 'mikania-micrantha'),
          stubbed('cccccccc-0000-4000-8000-000000000003', 1, 'screened', 'eichhornia-crassipes'),
        ],
      },
    },
  })
  await startPrivateAccess(page)
  await page.goto('/reports')

  // Loading state while the request is in flight.
  await expect(page.getByText('Loading your records…')).toBeVisible()
  const rows = page.locator('.my-reports__item:not(.my-reports__item--skeleton)')
  await expect(rows).toHaveCount(3)
  await expect(page.getByText('Loading your records…')).toHaveCount(0)
  // Newest first, each with its own status, relative date and reference.
  await expect(rows.locator('.my-reports__ref')).toHaveText(['Ref AAAAAAAA', 'Ref CCCCCCCC', 'Ref BBBBBBBB'])
  await expect(rows.locator('.my-reports__status')).toHaveText(['Screening', 'Published', 'Needs rescan'])
  await expect(rows.locator('.my-reports__date')).toHaveText(['Today', 'Yesterday', '3 days ago'])
  await expect(rows.nth(1).locator('.my-reports__species')).toContainText('Water hyacinth')
})

test('AC 4.4.1 View my records: a profile with nothing recorded sees the empty state', async ({ page }) => {
  const mineRequested = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/reports/mine')
  await startPrivateAccess(page)
  await page.goto('/reports')
  expect((await (await mineRequested).json() as { items: unknown[] }).items).toEqual([])
  await expect(page.getByRole('heading', { name: 'No field records yet' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Scan your first plant' })).toBeVisible()
  await expect(page.locator('.my-reports__link')).toHaveCount(0)
})

test('AC 4.4.1 View my records: a failed request shows the connection error and being offline shows the offline notice', async ({ page }) => {
  await stubApi(page, { 'GET /api/v1/reports/mine': { status: 503, body: { detail: 'Service unavailable' } } })
  // Lets the test flip navigator.onLine without cutting the dev server off.
  await page.addInitScript(() => {
    const state = window as unknown as { __acOnline?: boolean }
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => state.__acOnline !== false })
  })
  await startPrivateAccess(page)
  await page.goto('/reports')

  // Connection error, after the client's retries, with a way to try again.
  const error = page.locator('.my-reports__error')
  await expect(error).toBeVisible({ timeout: 20_000 })
  await expect(error).toContainText('Could not load your reports.')
  await expect(error.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.locator('.my-reports__link')).toHaveCount(0)

  // Offline: the notice replaces the error and nothing claims to be current.
  await page.evaluate(() => {
    (window as unknown as { __acOnline: boolean }).__acOnline = false
    window.dispatchEvent(new Event('offline'))
  })
  await expect(page.getByText('You are offline. Reconnect to load the latest list.')).toBeVisible()
  await expect(error).toHaveCount(0)
})
