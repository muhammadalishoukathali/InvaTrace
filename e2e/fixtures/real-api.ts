// Request-level helpers for the real-stack AC specs in e2e/ac-real. They drive
// the FastAPI service directly, because the rules under test (duplicate
// screening, vicinity checks, rate limits) live on the server and a browser
// journey through the mock service worker cannot prove them.
import { expect, type APIRequestContext, type Browser } from '@playwright/test'

// Set REAL_API_URL when the Compose API is published on a port other than 8000.
export const API_URL = process.env.REAL_API_URL ?? 'http://localhost:8000'
export const MODEL_VERSION = 'oe_v4_31class_web_fp16'
export const SPECIES = 'mikania-micrantha'

export type Session = {
  accessToken: string
  installationToken: string
  profile: { id: string; publicId?: string }
  recoveryCodes: string[]
  headers: { Authorization: string }
}

export type ReportBody = {
  id: string
  status: string
  sightingId: string | null
  [key: string]: unknown
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function newInstallationToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function startProfile(request: APIRequestContext): Promise<Session> {
  const installationToken = newInstallationToken()
  const start = () => request.post(`${API_URL}/api/v1/profiles/start`, { data: { installationToken } })
  let started = await start()
  // New identities are limited to ten a minute per address. A full run starts
  // more than that, so wait out the window rather than fail on the limiter.
  while (started.status() === 429) {
    await new Promise((resolve) => setTimeout(resolve, (Number(started.headers()['retry-after']) || 5) * 1000))
    started = await start()
  }
  expect(started.status()).toBe(201)
  const body = await started.json() as Omit<Session, 'headers' | 'installationToken'>
  return { ...body, installationToken, headers: { Authorization: `Bearer ${body.accessToken}` } }
}

/** A 640x480 JPEG with enough variation to pass the screening worker's quality
 *  checks. Each seed gives different pixels, so two photos never collide on the
 *  exact or perceptual duplicate paths unless a test reuses the bytes on purpose. */
export async function makeJpeg(browser: Browser, seed = Math.floor(Math.random() * 1e9)): Promise<Buffer> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const encoded = await page.evaluate(async (value) => {
    const canvas = new OffscreenCanvas(640, 480)
    const draw = canvas.getContext('2d')!
    draw.fillStyle = `hsl(${value % 360}, 70%, 40%)`
    draw.fillRect(0, 0, 640, 480)
    for (let i = 0; i < 60; i++) {
      draw.fillStyle = `hsl(${(value + i * 17) % 360}, 80%, 55%)`
      draw.beginPath()
      draw.arc(((value >> (i % 24)) & 0xff) * 2.5, ((value >> ((i * 3) % 24)) & 0xff) * 1.9, 20 + (i % 40), 0, Math.PI * 2)
      draw.fill()
    }
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, seed)
  await context.close()
  return Buffer.from(encoded, 'base64')
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

type SubmitOptions = {
  photo: Buffer
  location?: { lat: number; lng: number }
  accuracyM?: number
  /** Overrides merged into the report body after the scan has been stored. */
  report?: Record<string, unknown>
  scan?: Record<string, unknown>
}

/** Stores a scan, uploads the photo and posts the report. Returns the raw
 *  response so a test can assert on a rejection as easily as on a success. */
export async function submitReport(request: APIRequestContext, session: Session, options: SubmitOptions) {
  const captureId = crypto.randomUUID()
  const imageSha256 = await sha256Hex(options.photo)
  const scan = await request.post(`${API_URL}/api/v1/scans`, {
    headers: session.headers,
    data: {
      captureId,
      predictedSpeciesId: SPECIES,
      outcome: 'target',
      confidence: 0.91,
      modelVersion: MODEL_VERSION,
      imageSha256Hex: imageSha256,
      captureSource: 'camera',
      ...options.scan,
    },
  })
  expect(scan.ok(), await scan.text()).toBe(true)

  const presign = await request.post(`${API_URL}/api/v1/uploads/presign`, {
    headers: { ...session.headers, 'Idempotency-Key': `ac-real-${captureId}:upload` },
    data: { contentType: 'image/jpeg', sizeBytes: options.photo.length },
  })
  expect(presign.ok(), await presign.text()).toBe(true)
  const { uploadUrl, photoKey } = await presign.json() as { uploadUrl: string; photoKey: string }
  const put = await request.put(uploadUrl, { headers: { 'Content-Type': 'image/jpeg' }, data: options.photo })
  expect(put.status()).toBeLessThan(400)

  const response = await request.post(`${API_URL}/api/v1/reports`, {
    headers: { ...session.headers, 'Idempotency-Key': `ac-real-${captureId}` },
    data: {
      photoKey,
      speciesId: SPECIES,
      outcome: 'target',
      confidence: 0.91,
      modelVersion: MODEL_VERSION,
      observedAt: new Date().toISOString(),
      captureId,
      captureSource: 'camera',
      imageSha256,
      location: options.location ?? { lat: 3.1497, lng: 101.6412 },
      locationAccuracyM: options.accuracyM ?? 12,
      extent: 'single',
      consent: { accurate: true, noPII: true },
      ...options.report,
    },
  })
  return { response, captureId, photoKey, imageSha256 }
}

/** Polls until the screening worker moves the report out of `processing`. */
export async function waitForScreening(request: APIRequestContext, session: Session, reportId: string): Promise<ReportBody> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const poll = await request.get(`${API_URL}/api/v1/reports/${reportId}`, { headers: session.headers })
    expect(poll.status()).toBe(200)
    const body = await poll.json() as ReportBody
    if (body.status !== 'processing' || Date.now() > deadline) return body
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** A point `metres` north of the given one; good to well under a metre here. */
export function northOf(point: { lat: number; lng: number }, metres: number) {
  return { lat: point.lat + metres / 111_320, lng: point.lng }
}

/** Each test gets its own patch of ground so the near-duplicate and vicinity
 *  rules never see another test's sighting. Stays inside Peninsular Malaysia. */
export function isolatedPoint() {
  return { lat: 3.0 + Math.random() * 0.4, lng: 101.5 + Math.random() * 0.3 }
}

/** Publishes one screened sighting at `point` and returns its report. */
export async function publishSighting(
  request: APIRequestContext, browser: Browser, session: Session, point: { lat: number; lng: number },
) {
  const submitted = await submitReport(request, session, { photo: await makeJpeg(browser), location: point })
  expect(submitted.response.status(), await submitted.response.text()).toBe(201)
  const report = await waitForScreening(request, session, (await submitted.response.json() as { id: string }).id)
  expect(report.status).toBe('screened')
  return report as ReportBody & { sightingId: string }
}

/** A fresh GPS fix as the removal and follow-up endpoints expect it. */
export function fix(point: { lat: number; lng: number }, accuracyM = 10, capturedAt = new Date()) {
  return { latitude: point.lat, longitude: point.lng, accuracyM, capturedAt: capturedAt.toISOString() }
}
