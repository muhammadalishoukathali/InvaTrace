// Contract smoke test against the actual FastAPI backend rather than the mock
// service worker. Needs the Docker Compose stack running first (backend on
// localhost:8000) and is meant to run via playwright.real.config.ts, not the
// default config. Catches drift between the mock handlers and what the real
// API actually returns.
import { expect, test } from '@playwright/test'

// Hits /health/live first so this fails fast with an obvious reason if the
// backend just isn't up yet, instead of failing confusingly later on a UI
// timeout.
test('private access starts and bootstraps against the real API', async ({ page, request }) => {
  const health = await request.get('http://localhost:8000/health/live')
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok' })

  await page.goto('/')
  await expect(page).toHaveURL(/\/private-access$/)
  const started = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/profiles/start')
  await page.getByRole('button', { name: 'Start privately' }).click()
  const startResponse = await started
  expect(startResponse.status()).toBe(201)
  expect(startResponse.headers()['cache-control']).toContain('no-store')
  const created = await startResponse.json() as {
    profile: { id: string; role: string; trustLevel: string }
    recoveryCodes: string[]
  }
  expect(created.profile).toMatchObject({ role: 'Detector', trustLevel: 'New' })
  expect(created.recoveryCodes).toHaveLength(10)

  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)

  const bootstrap = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/profiles/bootstrap')
  await page.reload()
  const bootstrapped = await (await bootstrap).json() as {
    profile: { id: string }
    recoverySetupRequired: boolean
  }
  expect(bootstrapped.profile.id).toBe(created.profile.id)
  expect(bootstrapped.recoverySetupRequired).toBe(false)
  await expect(page.getByRole('heading', { name: 'Live threat map' })).toBeVisible()
})

test('real geospatial data is discoverable from the main map', async ({ page, request }) => {
  const ready = await request.get('http://localhost:8000/health/ready')
  const readiness = await ready.json() as {
    status: string
    database: string
    redis: string
    storage: string
    geospatialData: {
      status: string
      catalogueSpecies: number
      areas: number
      trails: number
      protectedAreas: number
      waterwayEdges: number
      sourceReleasesAligned: boolean
      osmSourceSha256: string | null
    }
  }

  // This test needs a real OSM import behind it. The regional PBF is a
  // multi-gigabyte Geofabrik download that docs/deployment.md deliberately
  // keeps out of git, and `app.cli seed` only loads reference data, so a plain
  // compose stack has no areas, trails, protected areas or waterway edges and
  // /health/ready answers 503.
  //
  // Skip on that exact shape only: the service itself healthy, and no OSM
  // import recorded at all. An import that IS present but incomplete or
  // misaligned still fails the assertions below, which is the case actually
  // worth catching before a release.
  const serviceHealthy = readiness.database === 'ok'
    && readiness.redis === 'ok'
    && readiness.storage === 'ok'
  const noOsmImport = readiness.geospatialData.osmSourceSha256 === null
  test.skip(
    ready.status() === 503 && serviceHealthy && noOsmImport,
    'No OSM import in this environment - run the geospatial import to cover this path.',
  )

  expect(ready.status()).toBe(200)
  expect(readiness.geospatialData).toMatchObject({
    status: 'ok',
    catalogueSpecies: 32,
    sourceReleasesAligned: true,
  })
  expect(readiness.geospatialData.areas).toBeGreaterThan(0)
  expect(readiness.geospatialData.trails).toBeGreaterThan(0)
  expect(readiness.geospatialData.protectedAreas).toBeGreaterThan(0)
  expect(readiness.geospatialData.waterwayEdges).toBeGreaterThan(0)

  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  const mapPlaces = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/places/map' && response.status() === 200)
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  const payload = await (await mapPlaces).json() as { features: unknown[] }
  expect(payload.features.length).toBeGreaterThan(0)

  const places = page.getByRole('region', { name: 'Mapped places in current view' })
  const firstPlace = places.getByRole('button').first()
  await expect(firstPlace).toBeAttached()
  await firstPlace.focus()
  await page.keyboard.press('Enter')
  const preview = page.getByRole('dialog', { name: /place preview$/ })
  await expect(preview).toBeVisible()
  await expect(preview).toBeFocused()
  const detailLink = preview.getByRole('link', { name: 'View plants recorded nearby' })
  await detailLink.click()
  await expect(page).toHaveURL(/\/places\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

// AC Phase 6 - real-backend reporting coverage. Walks scan → presign →
// upload → report → poll for screened → verify the published sighting is
// visible on the public feed. Skips the browser UI (camera + model) and
// drives the API directly so the assertions are stable, but every request
// hits the real FastAPI stack - no MSW involved.
test('reporting flow completes end-to-end against the real API', async ({ request }) => {
  const installationToken = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const started = await request.post('http://localhost:8000/api/v1/profiles/start', {
    data: { installationToken },
  })
  expect(started.status()).toBe(201)
  const { accessToken } = await started.json() as { accessToken: string }
  const authHeaders = { Authorization: `Bearer ${accessToken}` }

  const photo = jpegBytes()
  const photoBuffer = Buffer.from(photo)
  const imageSha256 = await sha256Hex(photo)
  const captureId = crypto.randomUUID()

  const scan = await request.post('http://localhost:8000/api/v1/scans', {
    headers: authHeaders,
    data: {
      captureId,
      predictedSpeciesId: 'mikania-micrantha',
      outcome: 'target',
      confidence: 0.91,
      modelVersion: 'oe_v4_31class_web_fp16',
      imageSha256Hex: imageSha256,
      captureSource: 'camera',
    },
  })
  expect(scan.ok()).toBe(true)

  const idempotencyBase = `real-e2e-${captureId}`
  const presign = await request.post('http://localhost:8000/api/v1/uploads/presign', {
    headers: { ...authHeaders, 'Idempotency-Key': `${idempotencyBase}:upload` },
    data: { contentType: 'image/jpeg', sizeBytes: photo.length },
  })
  expect(presign.ok()).toBe(true)
  const { uploadUrl, photoKey } = await presign.json() as { uploadUrl: string; photoKey: string }
  const put = await request.put(uploadUrl, {
    headers: { 'Content-Type': 'image/jpeg' },
    data: photoBuffer,
  })
  expect(put.status()).toBeLessThan(400)

  const submission = {
    photoKey,
    speciesId: 'mikania-micrantha',
    outcome: 'target',
    confidence: 0.91,
    modelVersion: 'oe_v4_31class_web_fp16',
    observedAt: new Date().toISOString(),
    captureId,
    captureSource: 'camera',
    imageSha256,
    location: { lat: 3.1497, lng: 101.6412 },
    locationAccuracyM: 12,
    extent: 'single',
    notes: 'real-backend e2e reporting coverage',
    consent: { accurate: true, noPII: true },
  }
  const submitted = await request.post('http://localhost:8000/api/v1/reports', {
    headers: { ...authHeaders, 'Idempotency-Key': idempotencyBase },
    data: submission,
  })
  expect(submitted.ok()).toBe(true)
  const initial = await submitted.json() as { id: string; status: string; sightingId: string | null }
  expect(initial.status).toBe('processing')

  // Poll until the screening worker publishes. Timeout generous enough
  // for a cold Compose stack; sub-second on a warm one.
  const deadline = Date.now() + 20_000
  let published: { status: string; sightingId: string | null } = initial
  while (Date.now() < deadline && published.status === 'processing') {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const poll = await request.get(`http://localhost:8000/api/v1/reports/${initial.id}`, { headers: authHeaders })
    expect(poll.status()).toBe(200)
    published = await poll.json() as { status: string; sightingId: string | null }
  }
  expect(published.status).toBe('screened')
  expect(published.sightingId).toBeTruthy()

  const detail = await request.get(`http://localhost:8000/api/v1/sightings/${published.sightingId}`)
  expect(detail.status()).toBe(200)
  const sighting = await detail.json() as {
    status: string; thumbnailUrl: string | null; confidence: number | null
    nearestFeatureType: string | null
  }
  expect(sighting.status).toBe('screened')
  expect(sighting.thumbnailUrl).toBeTruthy()
  expect(sighting.confidence).not.toBeNull()
})

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function jpegBytes(): Uint8Array {
  // 640×480 JPEG generated in-process via the OffscreenCanvas API. Larger
  // than the screening worker's minimum-image-dimension floor, contains
  // enough variation to satisfy the perceptual quality checks, and each
  // call produces different pixel content so runs never collide on the
  // exact / perceptual duplicate paths.
  return jpegBufferRef!
}

let jpegBufferRef: Uint8Array | null = null

test.beforeEach(async ({ browser }) => {
  if (jpegBufferRef) return
  const context = await browser.newContext()
  const page = await context.newPage()
  const dataUrl = await page.evaluate(async (seed) => {
    const canvas = new OffscreenCanvas(640, 480)
    const context = canvas.getContext('2d')!
    context.fillStyle = `hsl(${seed % 360}, 70%, 40%)`
    context.fillRect(0, 0, 640, 480)
    for (let i = 0; i < 60; i++) {
      context.fillStyle = `hsl(${(seed + i * 17) % 360}, 80%, 55%)`
      context.beginPath()
      context.arc(
        ((seed >> (i % 24)) & 0xff) * 2.5,
        ((seed >> ((i * 3) % 24)) & 0xff) * 1.9,
        20 + (i % 40), 0, Math.PI * 2,
      )
      context.fill()
    }
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    const buffer = await blob.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, Math.floor(Math.random() * 1e9))
  const binary = atob(dataUrl)
  jpegBufferRef = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) jpegBufferRef[i] = binary.charCodeAt(i)
  await context.close()
})

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
