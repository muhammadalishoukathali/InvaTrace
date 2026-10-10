// Epic 1 - plant identification and Malaysian status. One test per acceptance
// criterion, run against the mock service worker and the development model
// (playwright.config.ts). Where the app does not do what a criterion says the
// correct assertion is kept and the test is marked fixme with the reason.
//
// What this layer cannot prove is said next to each test: the development
// model is a deterministic stand-in, so nothing here measures the real ONNX
// model, its cached assets, or the backend's own copy of the catalogue.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import {
  atLocation, pinModelSpecies, referenceImage, scanPhoto, startPrivateAccess,
} from '../fixtures/app'

// A fake camera device lets the live-camera path (getUserMedia -> capture) run
// headless; without it AC 1.1.2 could only be exercised through the gallery.
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
})

// Set AC_RUN_FIXME=1 to run the fixme tests and re-check each finding.
const KNOWN_GAP = !process.env.AC_RUN_FIXME

const readJson = <T>(file: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8')) as T
const modelManifest = readJson<{ classes: Array<{ machine_label: string; scientific_name: string }> }>(
  'public/models/invatrace-student33-v1/student33_species.json',
)
const plantStatus = readJson<{ records: Array<{ model_label: string; scientific_name: string; ui_state: string }> }>(
  'shared/catalogue/plant-status.json',
)

const SCAN_HISTORY_KEY = 'invatrace-scan-history-v1'
const STATE_LABELS = ['Invasive in Malaysia', 'Information only', 'Status uncertain']

interface ApiStub { method: string; path: string; status?: number; json: unknown }

/** Local helper (not in the shared fixture): answers one API call with a fixed
 *  response. The mock service worker answers API calls before page.route or
 *  context.route can see them, so the stub wraps window.fetch instead. It is
 *  installed by an init script, so it applies from the next navigation; a
 *  later stub for the same path wins over an earlier one. */
async function stubApi(page: Page, stub: ApiStub) {
  await page.addInitScript((s) => {
    const real = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(raw, window.location.origin)
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (url.pathname === s.path && method === s.method) {
        return new Response(JSON.stringify(s.json), {
          status: s.status ?? 200, headers: { 'content-type': 'application/json' },
        })
      }
      return real(input, init)
    }
  }, stub)
}

/** Pins the development model after the first navigation, so one identity can
 *  scan several species. The fixture's pinModelSpecies is an init script and
 *  would overwrite this on the reload scanPhoto() does. */
async function pinSpeciesNow(page: Page, speciesId: string) {
  await page.evaluate((id) => localStorage.setItem('invatrace.development-model-species', id), speciesId)
}

function scanHistoryRecords(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as { records: unknown[] }).records : []
  }, SCAN_HISTORY_KEY)
}

/** Re-encodes a bundled reference photo in the page, so the PNG and WebP
 *  inputs are real decodable images and not just renamed JPEGs. */
async function encodedPhoto(page: Page, mimeType: string) {
  const base64 = await page.evaluate(async (type) => {
    const source = await (await fetch('/reference-images/mikania-micrantha.jpg')).blob()
    const bitmap = await createImageBitmap(source)
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 400
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, 400, 400)
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((result) => resolve(result!), type, 0.9))
    if (blob.type !== type) throw new Error(`Browser encoded ${blob.type} instead of ${type}`)
    let binary = ''
    for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, mimeType)
  return { name: `plant.${mimeType.split('/')[1]}`, mimeType, buffer: Buffer.from(base64, 'base64') }
}

test('AC 1.1.1 Accepted image input', async ({ page }) => {
  const recordRequests: string[] = []
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'POST' && ['/api/v1/scans', '/api/v1/reports', '/api/v1/uploads/presign'].includes(pathname)) {
      recordRequests.push(pathname)
    }
  })
  await startPrivateAccess(page)
  await page.goto('/scan')
  const gallery = page.locator('input[aria-label="Choose photo from gallery"]')

  // Device-camera capture is offered alongside the gallery: a live-camera
  // button, plus a capture input that opens the phone's rear camera. The
  // capture itself is exercised end to end in AC 1.1.2.
  await expect(page.getByRole('button', { name: /Open camera/ })).toBeEnabled()
  const cameraInput = page.locator('input[aria-label="Take photo"]')
  await expect(cameraInput).toHaveAttribute('capture', 'environment')
  await expect(cameraInput).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
  await expect(gallery).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')

  // JPEG, PNG and WebP under 10 MB each give a preview and an enabled classify
  // control. The app labels that control "Analyse plant" rather than "Classify".
  const accepted = [
    referenceImage('mikania-micrantha.jpg'),
    await encodedPhoto(page, 'image/png'),
    await encodedPhoto(page, 'image/webp'),
  ]
  for (const file of accepted) {
    await gallery.setInputFiles(file)
    await expect(page.getByAltText('Captured plant')).toBeVisible()
    await expect(page.getByText('Photo quality check passed')).toBeVisible()
    await expect(page.getByRole('button', { name: /Analyse plant/ })).toBeEnabled()
    await page.getByRole('button', { name: 'Discard photo and retake' }).click()
    await expect(page.getByAltText('Captured plant')).toHaveCount(0)
  }

  // Rejections: an empty file, a file over 10 MB and an unsupported type never
  // reach the preview, never enable classification, and create no scan or
  // report record - locally or on the server.
  const rejected = [
    { name: 'empty.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(0) },
    { name: 'too-large.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) },
    { name: 'animation.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') },
  ]
  for (const file of rejected) {
    await gallery.setInputFiles(file)
    // The capture button shows "Preparing photo…" while a file is checked;
    // wait for that to settle so the absence checks below are not premature.
    await expect(page.getByRole('button', { name: /Open camera/ })).toBeEnabled()
    await expect(page.getByAltText('Captured plant')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Analyse plant/ })).toHaveCount(0)
    await expect(page).toHaveURL(/\/scan$/)
  }
  expect(await scanHistoryRecords(page)).toEqual([])
  expect(recordRequests).toEqual([])
})

test('AC 1.1.2 Supported classification result', async ({ page }) => {
  // Proves: a live-camera capture is classified, and the result page shows the
  // scientific name, common name and the model statement inside 15 seconds,
  // with a label that is one of the released model labels.
  // Does not prove: the real ONNX model or its offline asset cache - the
  // development model has no assets to cache. Confidence display is the
  // separate fixme test below.
  await pinModelSpecies(page, 'mikania_micrantha')
  const scanBodies: Array<{ captureSource: string; outcome: string; predictedSpeciesId: string | null }> = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/scans') {
      scanBodies.push(request.postDataJSON())
    }
  })
  await startPrivateAccess(page)
  await page.goto('/scan')

  // The development quality check rejects roughly one frame in seventeen as
  // blurry, and the fake camera's frame changes over time, so retake until a
  // frame passes - which is what a user would do.
  await expect(async () => {
    const retake = page.getByRole('button', { name: 'Retake photo' })
    if (await retake.isVisible()) await retake.click()
    await page.getByRole('button', { name: /Open camera/ }).click()
    await expect(page.getByLabel('Live rear camera preview')).toBeVisible()
    await page.getByRole('button', { name: 'Capture plant photo' }).click()
    await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 3000 })
  }).toPass({ timeout: 20_000 })
  await expect(page.getByAltText('Captured plant')).toBeVisible()

  const modelConfig = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/model-config')
  const startedAt = Date.now()
  await page.getByRole('button', { name: /Analyse plant/ }).click()
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 15_000 })
  await expect(page.getByText('This identification was generated by the InvaTrace image-recognition model.'))
    .toBeVisible()
  expect(Date.now() - startedAt).toBeLessThan(15_000)

  // Top predicted scientific name and the available common name.
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed', level: 2 })).toBeVisible()
  const scientificName = page.locator('.scan-result p', { hasText: /^Mikania micrantha$/ })
  await expect(scientificName).toBeVisible()
  expect(modelManifest.classes.map((entry) => entry.scientific_name))
    .toContain(await scientificName.innerText())

  // GET /api/v1/model-config supplies the supported versions and threshold.
  const config = await (await modelConfig).json() as { supportedVersions: string[]; acceptanceThreshold: number }
  expect(config.supportedVersions.length).toBeGreaterThan(0)
  expect(config.acceptanceThreshold).toBeGreaterThan(0)

  await expect.poll(() => scanBodies.length).toBe(1)
  expect(scanBodies[0]).toMatchObject({
    captureSource: 'camera', outcome: 'target', predictedSpeciesId: 'mikania-micrantha',
  })
})

test('AC 1.1.2 Supported classification result - confidence is shown as a percentage', async ({ page }) => {
  test.fixme(KNOWN_GAP, 'Result page hides model confidence; the percentage only appears on the report review step.')
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  await expect(page.getByRole('heading', { name: 'Mile-a-minute weed', level: 2 })).toBeVisible()
  // The development model reports 0.84 for this class.
  await expect(page.locator('.scan-result')).toContainText(/84(\.0+)?\s?%/)
})

test('AC 1.1.3 Honest uncertain result', async ({ page }) => {
  // The development model reports 0.84 for this class; a server threshold of
  // 0.85 puts the top prediction below MODEL_ACCEPTANCE_THRESHOLD.
  await stubApi(page, {
    method: 'GET',
    path: '/api/v1/model-config',
    json: {
      modelVersion: 'invatrace-student33-tinyvit5m-320-fp16',
      supportedVersions: [],
      acceptanceThreshold: 0.85,
      thresholdVersion: 'invatrace-student33-tinyvit5m-320-fp16@0.8500',
      configVersion: 'invatrace-student33-tinyvit5m-320-fp16@0.8500',
    },
  })
  await pinModelSpecies(page, 'mikania_micrantha')
  const scanBodies: Array<{ outcome: string; predictedSpeciesId: string | null }> = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/scans') {
      scanBodies.push(request.postDataJSON())
    }
  })
  await startPrivateAccess(page)
  await scanPhoto(page)

  const result = page.locator('.scan-result')
  await expect(result.getByText('Uncertain result. Take another photo.')).toBeVisible()
  // No invasive or non-invasive verdict of any kind.
  await expect(result.getByText('Invasive in Malaysia')).toHaveCount(0)
  await expect(result.getByText('Possible invasive match')).toHaveCount(0)
  await expect(result.getByText('Not a target species')).toHaveCount(0)
  await expect(result.getByText('Information only')).toHaveCount(0)
  await expect(result).not.toContainText(/non-invasive|is native|harmless/i)
  // Guidance and reporting are hidden; Retake photo is offered.
  await expect(page.getByRole('heading', { name: 'Guidance for Malaysia' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: 'Permission and safety gate' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Report sighting/ })).toHaveCount(0)
  await expect.poll(() => scanBodies.length).toBe(1)
  expect(scanBodies[0]).toMatchObject({ outcome: 'uncertain', predictedSpeciesId: null })

  await page.getByRole('button', { name: 'Retake photo' }).click()
  await expect(page).toHaveURL(/\/scan$/)
  await expect(page.getByRole('heading', { name: 'Photograph a clear plant feature' })).toBeVisible()
  await expect(page.getByAltText('Captured plant')).toHaveCount(0)
})

test('AC 1.1.3 Honest uncertain result - server threshold boundary and unsupported version', async ({ page }) => {
  // Proves the client applies whatever GET /api/v1/model-config returns: at
  // the threshold is accepted, just above is uncertain, and a model version
  // the server no longer lists is uncertain.
  // Does not prove the backend's own threshold value or its versioning.
  await pinModelSpecies(page, 'mikania_micrantha')
  const confidences: number[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/scans') {
      confidences.push((request.postDataJSON() as { confidence: number }).confidence)
    }
  })
  await startPrivateAccess(page)

  // Unstubbed: the config carries a threshold and a version naming it.
  const configResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/model-config')
  await scanPhoto(page)
  const config = await (await configResponse).json() as {
    acceptanceThreshold: number; thresholdVersion: string; supportedVersions: string[]
  }
  expect(typeof config.acceptanceThreshold).toBe('number')
  expect(config.thresholdVersion).toContain(config.acceptanceThreshold.toFixed(4))
  expect(Array.isArray(config.supportedVersions)).toBe(true)
  await expect(page.getByText('Invasive in Malaysia', { exact: true }).first()).toBeVisible()
  await expect.poll(() => confidences.length).toBe(1)
  const confidence = confidences[0]

  const configWith = (acceptanceThreshold: number, supportedVersions: string[] = []) => ({
    method: 'GET',
    path: '/api/v1/model-config',
    json: {
      modelVersion: 'boundary-test', supportedVersions, acceptanceThreshold,
      thresholdVersion: `boundary-test@${acceptanceThreshold}`, configVersion: `boundary-test@${acceptanceThreshold}`,
    },
  })

  // Exactly at the threshold: accepted.
  await stubApi(page, configWith(confidence))
  await scanPhoto(page)
  await expect(page.getByText('Invasive in Malaysia', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Report sighting/ })).toBeVisible()

  // Just above the model's confidence: uncertain.
  await stubApi(page, configWith(confidence + 0.0001))
  await scanPhoto(page)
  await expect(page.getByText('Uncertain result. Take another photo.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Report sighting/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retake photo' })).toBeVisible()

  // Confident enough, but not a model version the server supports.
  await stubApi(page, configWith(0.5, ['retired-model-version']))
  await scanPhoto(page)
  await expect(page.getByText('Uncertain result. Take another photo.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Report sighting/ })).toHaveCount(0)
})

test('AC 1.1.3 Honest uncertain result - an uncertain result names no catalogue species', async ({ page }) => {
  test.fixme(KNOWN_GAP, 'Uncertain result still links "View catalogue entry for <rejected species>", an invasive-catalogue entry.')
  await stubApi(page, {
    method: 'GET',
    path: '/api/v1/model-config',
    json: {
      modelVersion: 'm', supportedVersions: [], acceptanceThreshold: 0.85,
      thresholdVersion: 'm@0.8500', configVersion: 'm@0.8500',
    },
  })
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  await expect(page.getByText('Uncertain result. Take another photo.')).toBeVisible()
  // Every catalogue entry is an invasive record, so pointing the user at the
  // rejected prediction's entry is an invasive claim by another route.
  await expect(page.getByRole('link', { name: /View catalogue entry/ })).toHaveCount(0)
  await expect(page.locator('.scan-result')).not.toContainText('Mikania')
})

test('AC 1.2.1 Exact status lookup', async ({ page }) => {
  // Proves: an accepted label is matched to its own catalogue record and the
  // result shows exactly one of the three states, the one that record holds.
  // Cannot be shown here: Information only and Status uncertain. Every one of
  // the 32 shipped records is `invasive`, so neither state is reachable from a
  // scan; those branches are only covered by malaysia-status.test.ts.
  // Not proven: that the backend loads the same catalogue version/checksum.
  await startPrivateAccess(page)
  for (const label of ['mikania_micrantha', 'mimosa_pigra', 'acacia_mangium']) {
    const record = plantStatus.records.find((entry) => entry.model_label === label)!
    expect(modelManifest.classes.map((entry) => entry.machine_label)).toContain(label)
    expect(record.ui_state).toBe('invasive')

    await pinSpeciesNow(page, label)
    const speciesRequest = page.waitForRequest((request) =>
      new URL(request.url()).pathname === `/api/v1/species/${label.replaceAll('_', '-')}`)
    await scanPhoto(page)
    await speciesRequest

    const result = page.locator('.scan-result')
    await expect(result.locator('p', { hasText: new RegExp(`^${record.scientific_name}$`) }).first()).toBeVisible()
    // The outcome badge is the first element of the result.
    const badge = result.locator('> div').first()
    await expect(badge).toHaveText('Invasive in Malaysia')
    const shown = STATE_LABELS.filter((state) => state !== 'Invasive in Malaysia')
    for (const other of shown) await expect(badge).not.toContainText(other)
  }
})

test('AC 1.2.1 Exact status lookup - the bundled catalogue decides the state when the species API fails', async ({ page }) => {
  test.fixme(KNOWN_GAP, 'With GET /api/v1/species/{id} failing the badge reads "Possible invasive match", not one of the three states.')
  // The frontend catalogue is meant to be authoritative for result
  // presentation and available offline, so losing the runtime species call
  // must still give one of the three states - and never a fourth.
  await stubApi(page, {
    method: 'GET', path: '/api/v1/species/mikania-micrantha', status: 503, json: { detail: 'Service unavailable' },
  })
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  await scanPhoto(page)
  const badge = page.locator('.scan-result > div').first()
  await expect(badge).toHaveText(/^(Invasive in Malaysia|Information only|Status uncertain)/)
})

test('AC 1.2.2 Invasive-result pathway', async ({ page }) => {
  // Proves what the invasive result shows and enables. The app renders the
  // safe guidance inline ("Guidance for Malaysia") instead of behind a
  // "View safe guidance" button, so the guidance being present is asserted.
  // Not proven: the real GET /api/v1/species/{id} content.
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  const speciesResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/species/mikania-micrantha')
  await scanPhoto(page)
  const detail = await (await speciesResponse).json() as {
    malaysiaStatus: string; statusSourceId: string; statusReviewedAt: string | null
  }
  expect(detail.malaysiaStatus).toBe('invasive')

  const result = page.locator('.scan-result')
  // Malaysian status.
  await expect(result.locator('> div').first()).toHaveText('Invasive in Malaysia')
  // Short general description.
  const guidance = page.getByRole('region', { name: 'Guidance for Malaysia' })
  await expect(guidance).toBeVisible()
  await guidance.getByText('About this plant').click()
  const about = guidance.locator('details', { hasText: 'About this plant' }).locator('p')
  await expect(about).toBeVisible()
  expect((await about.innerText()).length).toBeGreaterThan(40)
  // Data source and last-reviewed date, taken from the status record.
  expect(detail.statusReviewedAt).toMatch(/^\d{4}-\d{2}/)
  await expect(result.getByText(/Malaysia status reviewed [A-Z][a-z]+ \d{4}/)).toContainText(detail.statusSourceId)

  // Safe guidance and reporting are both enabled.
  await expect(guidance.getByRole('group', { name: 'Permission and safety gate' })).toBeVisible()
  const report = page.getByRole('button', { name: /Report sighting/ })
  await expect(report).toBeEnabled()
  await report.click()
  await expect(page).toHaveURL(/\/report$/)
})

test('AC 1.2.3 Information-only and uncertain protection', async ({ page, context, baseURL }) => {
  // Proves: when the species API answers action_eligible=false and
  // report_eligible=false, the UI offers no report control and no removal
  // steps, even after every client-side gate is satisfied, and tells the user
  // not to act.
  // Not reachable here: a genuine information_only or status_uncertain
  // catalogue record (all 32 shipped records are invasive), and the real API
  // returning those eligibility fields.
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  // Start from the mock's own record so only the eligibility fields differ.
  const base = await page.evaluate(async () => (await fetch('/api/v1/species/mikania-micrantha')).json() as Promise<Record<string, unknown>>)
  await stubApi(page, {
    method: 'GET',
    path: '/api/v1/species/mikania-micrantha',
    json: { ...base, malaysiaStatus: 'information_only', actionEligible: false, reportEligible: false },
  })
  await scanPhoto(page)

  // General plant information and its source are still shown.
  const guidance = page.getByRole('region', { name: 'Guidance for Malaysia' })
  await guidance.getByText('About this plant').click()
  const about = guidance.locator('details', { hasText: 'About this plant' })
  expect((await about.locator('p').innerText()).length).toBeGreaterThan(40)
  await expect(about.getByRole('link').first()).toHaveAttribute('href', /^https?:\/\//)

  // No sighting-report control.
  await expect(page.getByRole('button', { name: /Report sighting/ })).toHaveCount(0)
  // The user is told not to act on the plant.
  await expect(guidance.getByText(/do not touch or remove the plant/i)).toBeVisible()

  // No removal steps, even with location checked, permission claimed and the
  // stop conditions cleared.
  await guidance.getByRole('button', { name: 'Check current location' }).click()
  await expect(guidance.getByText('No mapped protected-area intersection found')).toBeVisible()
  await guidance.getByRole('radio', { name: 'I have permission from the land manager' }).check()
  await guidance.getByRole('checkbox', { name: 'None of these apply here.' }).check()
  await expect(guidance.getByText('If the land manager has approved it')).toHaveCount(0)
  await expect(guidance.getByText('Beginner-safe action on an authorised site')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Report sighting/ })).toHaveCount(0)
})

test('AC 1.2.3 Information-only and uncertain protection - the supplied safety message is displayed', async ({ page }) => {
  test.fixme(KNOWN_GAP, 'SpeciesDetail.safetyMessage from GET /api/v1/species/{id} is never rendered on the result page.')
  await pinModelSpecies(page, 'mikania_micrantha')
  await startPrivateAccess(page)
  const base = await page.evaluate(async () => (await fetch('/api/v1/species/mikania-micrantha')).json() as Promise<Record<string, unknown>>)
  const safetyMessage = 'Leave this plant where it is. InvaTrace has no reviewed action for it (AC test message).'
  await stubApi(page, {
    method: 'GET',
    path: '/api/v1/species/mikania-micrantha',
    json: { ...base, malaysiaStatus: 'information_only', actionEligible: false, reportEligible: false, safetyMessage },
  })
  await scanPhoto(page)
  await expect(page.getByRole('button', { name: /Report sighting/ })).toHaveCount(0)
  await expect(page.locator('.scan-result')).toContainText(safetyMessage)
})
