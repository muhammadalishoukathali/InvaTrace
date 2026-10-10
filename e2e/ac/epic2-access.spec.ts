// Epic 2 - anonymous access, report integrity and duplicate/abuse controls.
// One test per acceptance criterion, run against the mock service worker
// (playwright.config.ts).
//
// Most of this epic is server rules. The mock handlers in
// src/mocks/handlers.ts mirror those rules in the browser, so a test here can
// show the client sends the right evidence and reacts correctly to each server
// answer - but it cannot show that the FastAPI backend enforces the rule. Each
// test says which half it proves; the unproven half is listed in the PR notes
// as "needs real stack".
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import {
  atLocation, KL_FIX, pinModelSpecies, referenceImage, scanPhoto, startPrivateAccess,
} from '../fixtures/app'

// Set AC_RUN_FIXME=1 to run the fixme tests and re-check each finding.
const KNOWN_GAP = !process.env.AC_RUN_FIXME

const START_PATH = '/api/v1/profiles/start'
const BOOTSTRAP_PATH = '/api/v1/profiles/bootstrap'
const RESTORE_PATH = '/api/v1/profiles/restore'
const ACKNOWLEDGE_PATH = '/api/v1/profiles/me/recovery-setup/acknowledge'
const SCANS_PATH = '/api/v1/scans'
const REPORTS_PATH = '/api/v1/reports'
const GENERIC_RESTORE_ERROR = 'We couldn’t restore this access. Check the profile ID and recovery code, then try again.'
const IDENTITY_INPUTS = [
  'input[type="email"]', 'input[type="password"]', 'input[type="tel"]',
  'input[name="username"]', 'input[autocomplete="username"]', 'input[autocomplete="name"]',
].join(', ')

interface StartPayload {
  accessToken: string
  profile: { id: string; displayName: string | null; role: string; trustLevel: string }
  recoveryCodes: string[]
}

interface ScanBody {
  captureId: string
  predictedSpeciesId: string | null
  outcome: string
  confidence: number
  modelVersion: string
  imageSha256Hex: string
  captureSource: string
}

interface ReportBody {
  captureId: string
  speciesId: string | null
  outcome: string
  confidence: number
  modelVersion: string
  imageSha256: string
  photoKey: string
  captureSource: string
  location: { lat: number; lng: number }
  locationAccuracyM: number
  [key: string]: unknown
}

interface ReportJson {
  id: string
  status: string
  createdAt: string
  sightingId: string | null
  submission: { photoKey: string }
}

const pathOf = (url: string) => new URL(url).pathname

/** Creates the identity but stops on the recovery-kit screen; the shared
 *  fixture acknowledges the kit for you, which AC 2.1.1 and 2.1.2 must not. */
async function startWithoutAcknowledging(page: Page) {
  await page.goto('/')
  const started = page.waitForResponse((response) => pathOf(response.url()) === START_PATH)
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  const response = await started
  await expect(page).toHaveURL(/\/private-access\/recovery$/)
  return { status: response.status(), payload: await response.json() as StartPayload }
}

/** Reads the installation record without creating the database as a side
 *  effect - opening a missing database would leave an empty one behind and
 *  break the app's own upgrade step. */
async function readStoredIdentity(page: Page) {
  return page.evaluate(async () => {
    const known = await indexedDB.databases()
    if (!known.some((info) => info.name === 'invatrace-identity')) return null
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('invatrace-identity')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      if (!db.objectStoreNames.contains('identity')) return null
      return await new Promise<{ installationToken: string; profileId: string | null } | null>((resolve, reject) => {
        const request = db.transaction('identity', 'readonly').objectStore('identity').get('current')
        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      })
    } finally {
      db.close()
    }
  })
}

/** Stands in for "another device": the browser forgets its installation. */
async function forgetInstallation(page: Page) {
  await page.evaluate(async () => {
    const request = indexedDB.deleteDatabase('invatrace-identity')
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Identity database deletion was blocked.'))
    })
  })
}

function browserStorageText(page: Page) {
  return page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]))
}

/** A direct API call from the page, for server answers the UI never asks for
 *  (a tampered body, an eleventh submission). Goes through the same mock
 *  service worker as the app's own calls. */
async function apiCall(page: Page, call: {
  method: string; path: string; authorization?: string; body?: unknown; headers?: Record<string, string>
}) {
  return page.evaluate(async (c) => {
    const response = await fetch(c.path, {
      method: c.method,
      headers: {
        'Content-Type': 'application/json',
        ...(c.authorization ? { Authorization: c.authorization } : {}),
        ...c.headers,
      },
      body: c.body === undefined ? undefined : JSON.stringify(c.body),
    })
    const text = await response.text()
    let json: Record<string, unknown> | null = null
    try { json = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
    return { status: response.status, json, text, retryAfter: response.headers.get('Retry-After') }
  }, call)
}

async function restoreAttempt(page: Page, profileId: string, recoveryCode: string) {
  const installationToken = await page.evaluate(() => {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  })
  return apiCall(page, { method: 'POST', path: RESTORE_PATH, body: { profileId, recoveryCode, installationToken } })
}

/** Records what the app sends for scans and reports, plus the current bearer
 *  token (it changes whenever a reload re-bootstraps the session). */
function watchEvidence(page: Page) {
  const seen = { scans: [] as ScanBody[], reports: [] as ReportBody[], presigns: 0, authorization: '' }
  page.on('request', (request) => {
    const pathname = pathOf(request.url())
    if (!pathname.startsWith('/api/v1/')) return
    const authorization = request.headers().authorization
    if (authorization) seen.authorization = authorization
    if (request.method() !== 'POST') return
    if (pathname === SCANS_PATH) seen.scans.push(request.postDataJSON())
    if (pathname === REPORTS_PATH) seen.reports.push(request.postDataJSON())
    if (pathname === '/api/v1/uploads/presign') seen.presigns += 1
  })
  return seen
}

/** From an accepted invasive result: walks the wizard to the review step. */
async function reachReview(page: Page) {
  await page.getByRole('button', { name: /Report sighting/ }).click()
  await expect(page).toHaveURL(/\/report$/)
  await expect(page.getByText(/Accurate to ~15 m/)).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  // The radio is visually replaced by its label, so click the label.
  await page.getByText('Single plant', { exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('checkbox', { name: /accurate/i }).check()
  await page.getByRole('checkbox', { name: /personal information/i }).check()
  await page.getByRole('button', { name: 'Review submission' }).click()
  await expect(page.getByRole('button', { name: 'Submit report' })).toBeVisible()
}

async function submitFromReview(page: Page) {
  const created = page.waitForResponse((response) =>
    pathOf(response.url()) === REPORTS_PATH && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Submit report' }).click()
  return created
}

/** A second scan without reloading the page. The mock keeps reports in page
 *  memory, so the duplicate tests must not use scanPhoto(), which reloads. */
async function scanAgainInApp(page: Page, file: string) {
  await page.getByRole('button', { name: /Scan a plant|New scan/ }).first().click()
  await expect(page).toHaveURL(/\/scan$/)
  await page.locator('input[aria-label="Choose photo from gallery"]').setInputFiles(referenceImage(file))
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /Analyse plant/ }).click()
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 5000 })
}

/** Leaves the just-submitted result for the map. Must be clicked while the
 *  result still reads "Report submitted": once screening finishes the only
 *  exit is "View on map", which opens a sheet over the scan button. */
async function backToMap(page: Page) {
  await expect(page.getByRole('heading', { name: 'Report submitted' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to map' }).click()
  await expect(page).toHaveURL(/\/map$/)
  // The result screen clears the finished scan and draft 150 ms after it is
  // left. A new photo chosen inside that window would be cleared with it.
  await page.waitForTimeout(400)
}

async function publicSightings(page: Page, authorization: string) {
  const response = await apiCall(page, { method: 'GET', path: '/api/v1/sightings', authorization })
  expect(response.status).toBe(200)
  return { ids: (response.json!.items as Array<{ id: string }>).map((item) => item.id), text: response.text }
}

test('AC 2.1.1 Anonymous identity creation', async ({ page }) => {
  // Proves: Start creates a public profile ID, a recovery code and a working
  // session from nothing but a random installation token - no email, phone,
  // name, username or password is asked for or sent.
  // Not proven here: the backend's own randomness source. The count of codes
  // is the separate fixme test below.
  const startBodies: Array<Record<string, unknown>> = []
  page.on('request', (request) => {
    if (pathOf(request.url()) === START_PATH) startBodies.push(request.postDataJSON())
  })

  await page.goto('/')
  // A new browser has no session: it is held on the access-start page.
  await expect(page).toHaveURL(/\/$/)
  expect(await readStoredIdentity(page)).toBeNull()
  await expect(page.locator(IDENTITY_INPUTS)).toHaveCount(0)

  const started = page.waitForResponse((response) => pathOf(response.url()) === START_PATH)
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  const response = await started
  expect(response.status()).toBe(201)
  const payload = await response.json() as StartPayload

  // The request carries only an opaque installation token.
  expect(startBodies).toHaveLength(1)
  expect(Object.keys(startBodies[0]).filter((key) => !['installationToken', 'displayName', 'publicId'].includes(key)))
    .toEqual([])
  expect(startBodies[0].installationToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(startBodies[0].displayName ?? null).toBeNull()

  // A public profile ID and recovery codes come back, and the session starts.
  expect(payload.profile.id).toMatch(/^[A-Z0-9]{4,12}$/)
  expect(payload.recoveryCodes.length).toBeGreaterThan(0)
  for (const code of payload.recoveryCodes) {
    // Base32 text, five bits a character: at least 128 bits per code.
    const symbols = code.replace(/-/g, '')
    expect(symbols).toMatch(/^[A-Z2-9]+$/)
    expect(symbols.length * 5).toBeGreaterThanOrEqual(128)
  }
  expect(new Set(payload.recoveryCodes).size).toBe(payload.recoveryCodes.length)
  const session = await apiCall(page, {
    method: 'GET', path: '/api/v1/reports/mine', authorization: `Bearer ${payload.accessToken}`,
  })
  expect(session.status).toBe(200)

  // The display name is optional, starts empty and can be skipped.
  await expect(page).toHaveURL(/\/private-access\/recovery$/)
  await expect(page.locator(IDENTITY_INPUTS)).toHaveCount(0)
  await page.getByText('Add a display name (optional)').click()
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('')
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
  expect(payload.profile.displayName).toBeNull()
})

test('AC 2.1.1 Anonymous identity creation - ten one-time recovery codes are issued', async ({ page }) => {
  test.fixme(KNOWN_GAP, 'POST /profiles/start returns 1 reusable recovery code, not ten one-time codes (mock and backend RECOVERY_CODES_PER_BATCH).')
  const { payload } = await startWithoutAcknowledging(page)
  expect(payload.recoveryCodes).toHaveLength(10)
})

test('AC 2.1.2 Recovery-key handling', async ({ page, context, baseURL }) => {
  // Proves: the kit screen lets the user copy and download the profile ID and
  // every issued code, will not continue without the acknowledgement, records
  // it through the acknowledge endpoint, never shows the code again, and that
  // the browser keeps no plain-text copy.
  // Not proven: HMAC-SHA256-only storage in the database and the absence of
  // codes from server logs - the mock keeps its own hash in localStorage.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL!).origin })
  const acknowledgements: string[] = []
  page.on('request', (request) => {
    if (pathOf(request.url()) === ACKNOWLEDGE_PATH) acknowledgements.push(request.method())
  })
  const { payload } = await startWithoutAcknowledging(page)
  const { id } = payload.profile
  const codes = payload.recoveryCodes
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible()
  await expect(page.locator('.recovery-card').first().locator('code')).toHaveText(id)
  for (const code of codes) await expect(page.locator('.recovery-card--code')).toContainText(code)

  // Copy the public profile ID.
  await page.locator('.recovery-card').first().getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.getByText('Public profile ID copied.')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id)

  // Copy the whole kit: the ID and every code.
  await page.locator('.recovery-card--code').getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.getByText('Recovery kit copied. Keep it private.')).toBeVisible()
  const copiedKit = await page.evaluate(() => navigator.clipboard.readText())
  expect(copiedKit).toContain(id)
  for (const code of codes) expect(copiedKit).toContain(code)

  // Download the kit: the same content as a file.
  const downloadStarted = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const download = await downloadStarted
  expect(download.suggestedFilename()).toBe(`invatrace-recovery-kit-${id}.txt`)
  const downloadedKit = fs.readFileSync(await download.path(), 'utf8')
  expect(downloadedKit).toContain(id)
  for (const code of codes) expect(downloadedKit).toContain(code)

  // Until the user acknowledges having saved it, the kit cannot be left.
  const acknowledge = page.getByRole('checkbox', { name: 'I have saved my recovery kit' })
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  await expect(acknowledge).not.toBeChecked()
  await expect(proceed).toBeDisabled()
  expect(acknowledgements).toEqual([])
  const storageBefore = await browserStorageText(page)
  for (const code of codes) expect(storageBefore).not.toContain(code)

  await acknowledge.check()
  const acknowledged = page.waitForResponse((response) => pathOf(response.url()) === ACKNOWLEDGE_PATH)
  await proceed.click()
  expect((await acknowledged).ok()).toBe(true)
  await expect(page).toHaveURL(/\/map$/)
  expect(acknowledgements).toEqual(['POST'])

  // The codes cannot be displayed again: the kit screen is gone, the profile
  // page does not show them, and nothing in browser storage holds them.
  await page.goto('/private-access/recovery')
  await expect(page).toHaveURL(/\/map$/)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'My profile', level: 1 })).toBeVisible()
  for (const code of codes) await expect(page.getByText(code)).toHaveCount(0)
  const storageAfter = await browserStorageText(page)
  const identityAfter = JSON.stringify(await readStoredIdentity(page))
  for (const code of codes) {
    expect(storageAfter).not.toContain(code)
    expect(identityAfter).not.toContain(code)
  }
})

test('AC 2.1.2 Recovery-key handling - a used recovery code becomes permanently invalid', async ({ page }) => {
  test.fixme(KNOWN_GAP, 'Recovery codes are reusable by design: a second restore with the same code returns 200, not a rejection.')
  const started = await startPrivateAccess(page)
  const first = await restoreAttempt(page, started.profile.id, started.recoveryCodes[0])
  expect(first.status).toBe(200)
  const second = await restoreAttempt(page, started.profile.id, started.recoveryCodes[0])
  expect(second.status).toBe(400)
})

test('AC 2.1.3 Same-device return', async ({ page }) => {
  // Proves: a return visit on the same browser restores the same profile from
  // the stored installation credential alone, with no profile ID or recovery
  // code asked for. The credential is opaque and the access token stays out
  // of storage.
  // Not proven: server-side session expiry.
  const started = await startPrivateAccess(page)
  const identity = (await readStoredIdentity(page))!
  expect(identity.profileId).toBe(started.profile.id)
  // Opaque: 32 random bytes, base64url, carrying neither the profile ID nor a code.
  expect(identity.installationToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(identity.installationToken).not.toContain(started.profile.id)

  const bootstrapBodies: unknown[] = []
  const otherEntryCalls: string[] = []
  page.on('request', (request) => {
    const pathname = pathOf(request.url())
    if (pathname === BOOTSTRAP_PATH) bootstrapBodies.push(request.postDataJSON())
    if (pathname === RESTORE_PATH || pathname === START_PATH) otherEntryCalls.push(pathname)
  })
  const bootstrap = page.waitForResponse((response) => pathOf(response.url()) === BOOTSTRAP_PATH)
  await page.reload()
  const response = await bootstrap
  expect(response.status()).toBe(200)
  const session = await response.json() as { accessToken: string; profile: { id: string } }

  expect(bootstrapBodies[0]).toEqual({ installationToken: identity.installationToken })
  expect(session.profile.id).toBe(started.profile.id)
  expect(otherEntryCalls).toEqual([])
  await expect(page).toHaveURL(/\/map$/)
  await expect(page.getByLabel('Public profile ID')).toHaveCount(0)
  await expect(page.getByLabel('Recovery code')).toHaveCount(0)

  // The restored session works, and its token was never written to storage.
  const mine = await apiCall(page, {
    method: 'GET', path: '/api/v1/reports/mine', authorization: `Bearer ${session.accessToken}`,
  })
  expect(mine.status).toBe(200)
  const storage = await browserStorageText(page)
  expect(storage).not.toContain(session.accessToken)
  expect(storage).not.toContain(started.recoveryCodes[0])
})

test('AC 2.1.4 Cross-device restoration', async ({ page }) => {
  // Proves: Restore access needs the profile ID and the recovery code
  // together, gives a new session for the same identity, uses one generic
  // error for every failure, and - in the mock's mirror of the rule - blocks
  // a profile after five failed attempts.
  // Not proven: the backend's per-IP limit, and that /reports/mine returns
  // only this identity's reports (the mock returns every report it holds).
  const started = await startPrivateAccess(page)
  const { id } = started.profile
  const code = started.recoveryCodes[0]
  await forgetInstallation(page)
  await page.reload()
  await expect(page).toHaveURL(/\/$/)

  const restoreStatuses: number[] = []
  page.on('response', (response) => {
    if (pathOf(response.url()) === RESTORE_PATH) restoreStatuses.push(response.status())
  })
  await page.getByRole('link', { name: 'Already use InvaTrace? Restore access' }).click()
  await expect(page).toHaveURL(/\/private-access\/restore$/)
  const errorNotice = page.locator('.access-form-panel').getByText(GENERIC_RESTORE_ERROR)

  // The public profile ID alone restores nothing.
  await page.getByLabel('Public profile ID').fill(id)
  await page.getByRole('button', { name: 'Restore access' }).click()
  await expect(errorNotice).toBeVisible()
  await expect(page).toHaveURL(/\/private-access\/restore$/)
  expect(await readStoredIdentity(page)).toBeNull()

  // A wrong code gets the very same message.
  await page.getByLabel('Recovery code').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZ')
  const rejected = page.waitForResponse((response) => pathOf(response.url()) === RESTORE_PATH)
  await page.getByRole('button', { name: 'Restore access' }).click()
  expect((await rejected).status()).toBe(400)
  await expect(errorNotice).toBeVisible()
  await expect(page.getByText('Access was not restored')).toHaveCount(1)
  await expect(page).toHaveURL(/\/private-access\/restore$/)

  // The ID and the code together create a new session for that identity.
  await page.getByLabel('Recovery code').fill(code)
  const restored = page.waitForResponse((response) => pathOf(response.url()) === RESTORE_PATH)
  await page.getByRole('button', { name: 'Restore access' }).click()
  const restoredResponse = await restored
  expect(restoredResponse.status()).toBe(200)
  const session = await restoredResponse.json() as { accessToken: string; profile: { id: string } }
  expect(session.profile.id).toBe(id)
  expect(session.accessToken).not.toBe(started.accessToken)
  await expect(page).toHaveURL(/\/map$/)
  expect(restoreStatuses).toEqual([400, 200])
  expect((await readStoredIdentity(page))!.profileId).toBe(id)

  // The report history is requested with the new session's credential.
  const mineRequest = page.waitForRequest((request) => pathOf(request.url()) === '/api/v1/reports/mine')
  await page.getByRole('link', { name: /My records|Records|Reports/ }).first().click()
  expect((await mineRequest).headers().authorization).toBe(`Bearer ${session.accessToken}`)
  await expect(page).toHaveURL(/\/reports$/)

  // Five failures inside the window, each with the same generic answer...
  const failures = []
  for (let attempt = 0; attempt < 5; attempt += 1) {
    failures.push(await restoreAttempt(page, id, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZ'))
  }
  expect(failures.map((failure) => failure.status)).toEqual([400, 400, 400, 400, 400])
  expect(new Set(failures.map((failure) => failure.text)).size).toBe(1)
  expect(failures[0].json).toEqual({ detail: GENERIC_RESTORE_ERROR })
  const unknownProfile = await restoreAttempt(page, 'ZZZZZZ', code)
  expect(unknownProfile.text).toBe(failures[0].text)
  // ...then even the correct code is refused, still with the generic message.
  const blocked = await restoreAttempt(page, id, code)
  expect(blocked.status).toBe(429)
  expect(Number(blocked.retryAfter)).toBeGreaterThan(0)
  expect(Number(blocked.retryAfter)).toBeLessThanOrEqual(15 * 60)
  expect(blocked.json).toEqual({ detail: GENERIC_RESTORE_ERROR })
})

test('AC 2.1.5 Sign out from the current browser', async ({ page }) => {
  // Proves: sign-out asks for confirmation with Yes, sign out / Cancel, clears
  // this browser's identity, scan history and guidance choices, lands on the
  // access-start page, calls nothing that could delete server data, and the
  // profile can only be re-entered with its ID and recovery code.
  // Not directly observable: the in-memory access token, query cache and
  // report draft; and that the real backend still holds submitted reports.
  await pinModelSpecies(page, 'mikania_micrantha')
  const started = await startPrivateAccess(page)
  await scanPhoto(page)
  const localBefore = await page.evaluate(() => localStorage.getItem('invatrace-scan-history-v1'))
  expect((JSON.parse(localBefore!) as { records: unknown[] }).records).toHaveLength(1)

  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'My profile', level: 1 })).toBeVisible()
  expect((await readStoredIdentity(page))!.profileId).toBe(started.profile.id)

  // Confirmation with both actions; Cancel changes nothing.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByText('Sign out of this browser?')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Yes, sign out' })).toBeVisible()
  const confirmation = page.locator('.access-sign-out-confirmation')
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Sign out of this browser?')).toHaveCount(0)
  await expect(page).toHaveURL(/\/profile$/)
  expect((await readStoredIdentity(page))!.profileId).toBe(started.profile.id)

  const apiCalls: string[] = []
  page.on('request', (request) => {
    const pathname = pathOf(request.url())
    if (pathname.startsWith('/api/v1/')) apiCalls.push(`${request.method()} ${pathname}`)
  })
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Yes, sign out' }).click()

  // Redirected to the access-start page.
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('button', { name: 'Start privately' }).first()).toBeVisible()
  // Sign-out is client-side: no call that deletes or revokes anything.
  expect(apiCalls.filter((call) => !call.startsWith('GET '))).toEqual([])

  // The installation record, scan history and guidance choices are gone.
  expect(await readStoredIdentity(page)).toBeNull()
  const local = await page.evaluate(() => ({
    history: localStorage.getItem('invatrace-scan-history-v1'),
    decisions: localStorage.getItem('invatrace-guidance-decisions-v1'),
  }))
  expect(local.history === null ? [] : (JSON.parse(local.history) as { records: unknown[] }).records).toEqual([])
  expect(local.decisions).toBeNull()

  // The session does not come back on its own, and app pages are closed.
  await page.reload()
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/scan/result')
  await expect(page).toHaveURL(/\/$/)
  await page.goto('/reports')
  await expect(page).toHaveURL(/\/$/)

  // The server-side profile was not deleted: its ID and recovery code restore it.
  await page.getByRole('link', { name: 'Already use InvaTrace? Restore access' }).click()
  await page.getByLabel('Public profile ID').fill(started.profile.id)
  await page.getByLabel('Recovery code').fill(started.recoveryCodes[0])
  const restored = page.waitForResponse((response) => pathOf(response.url()) === RESTORE_PATH)
  await page.getByRole('button', { name: 'Restore access' }).click()
  const restoredResponse = await restored
  expect(restoredResponse.status()).toBe(200)
  expect((await restoredResponse.json() as { profile: { id: string } }).profile.id).toBe(started.profile.id)
  await expect(page).toHaveURL(/\/map$/)
})

test('AC 2.2.1 Classification-to-report consistency', async ({ page, context, baseURL }) => {
  // Proves: the report payload copies scan/capture ID, image, species and
  // confidence from the accepted scan, and no step of the form lets the user
  // pick a different species.
  // Mock mirror only: the 422 for a tampered species comes from the browser
  // mock. That the FastAPI backend re-reads the scan row is not proven here.
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  const seen = watchEvidence(page)
  await startPrivateAccess(page)
  await scanPhoto(page)

  // No species control anywhere in the wizard: the only free-text field is
  // the notes box, and the only choices are extent and the two consents.
  await page.getByRole('button', { name: /Report sighting/ }).click()
  await expect(page).toHaveURL(/\/report$/)
  const noSpeciesControl = async () => {
    await expect(page.getByRole('combobox')).toHaveCount(0)
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(page.locator('select, input[type="text"], input[type="search"], input:not([type])')).toHaveCount(0)
  }
  await expect(page.getByText(/Accurate to ~15 m/)).toBeVisible()
  await noSpeciesControl()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Single plant', { exact: true }).click()
  await noSpeciesControl()
  await expect(page.getByRole('textbox')).toHaveCount(1)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('checkbox', { name: /accurate/i }).check()
  await page.getByRole('checkbox', { name: /personal information/i }).check()
  await noSpeciesControl()
  await page.getByRole('button', { name: 'Review submission' }).click()
  await noSpeciesControl()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  // The review shows the scan's species and confidence, read-only.
  await expect(page.getByText('Mile-a-minute weed')).toBeVisible()
  await expect(page.getByText(/target · 84% confidence/)).toBeVisible()

  const created = await submitFromReview(page)
  expect(created.status()).toBe(201)
  expect(seen.scans).toHaveLength(1)
  expect(seen.reports).toHaveLength(1)
  const [scan] = seen.scans
  const [report] = seen.reports
  expect(scan).toMatchObject({ outcome: 'target', predictedSpeciesId: 'mikania-micrantha' })
  expect(report.captureId).toBe(scan.captureId)
  expect(report.speciesId).toBe(scan.predictedSpeciesId)
  expect(report.confidence).toBe(scan.confidence)
  expect(report.outcome).toBe(scan.outcome)
  expect(report.modelVersion).toBe(scan.modelVersion)
  expect(report.captureSource).toBe(scan.captureSource)
  expect(report.imageSha256).toBe(scan.imageSha256Hex)
  expect(report.imageSha256).toMatch(/^[0-9a-f]{64}$/)

  // A resubmission naming another approved species for the same scan is refused.
  const tampered = await apiCall(page, {
    method: 'POST',
    path: REPORTS_PATH,
    authorization: seen.authorization,
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: { ...report, speciesId: 'mimosa-pigra' },
  })
  expect(tampered.status).toBe(422)
  expect(tampered.json).toMatchObject({ code: 'scan_species_mismatch' })
  const inflated = await apiCall(page, {
    method: 'POST',
    path: REPORTS_PATH,
    authorization: seen.authorization,
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: { ...report, confidence: 0.99 },
  })
  expect(inflated.status).toBe(422)
  expect(inflated.json).toMatchObject({ code: 'scan_confidence_mismatch' })
})

test('AC 2.2.2 Required evidence validation', async ({ page, context, baseURL }) => {
  // Proves: a rejected report shows the server's field-specific error and is
  // not published; an accepted one carries an accepted invasive scan, a stored
  // image reference and in-range numeric coordinates, and comes back with a
  // server timestamp; a report with no accepted scan behind it is refused.
  // Not proven: the backend's own range checks on latitude/longitude and its
  // per-field error shapes - the mock only validates the scan linkage.
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  const seen = watchEvidence(page)
  await startPrivateAccess(page)
  await scanPhoto(page)
  await reachReview(page)
  const before = await publicSightings(page, seen.authorization)

  // An invalid report: the field-specific error is shown and nothing is published.
  const fieldError = 'location.lat: latitude must be between -90 and 90.'
  await page.evaluate((detail) => {
    window.__msw = { reportRejection: { status: 422, code: 'invalid_location', detail } }
  }, fieldError)
  const refused = await submitFromReview(page)
  expect(refused.status()).toBe(422)
  await expect(page.getByRole('alert').filter({ hasText: fieldError })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Report submitted|Report published|Saved for later/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Submit report' })).toBeEnabled()
  const mineAfterRefusal = await apiCall(page, { method: 'GET', path: '/api/v1/reports/mine', authorization: seen.authorization })
  expect(mineAfterRefusal.json!.items).toEqual([])
  expect((await publicSightings(page, seen.authorization)).ids).toEqual(before.ids)

  // A report with no accepted scan behind it is refused with its own code.
  const withoutScan = await apiCall(page, {
    method: 'POST',
    path: REPORTS_PATH,
    authorization: seen.authorization,
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: { ...seen.reports[0], captureId: crypto.randomUUID() },
  })
  expect(withoutScan.status).toBe(422)
  expect(withoutScan.json).toMatchObject({ code: 'scan_missing' })
  expect((await publicSightings(page, seen.authorization)).ids).toEqual(before.ids)

  // The valid report is accepted, with every required piece of evidence.
  const accepted = await submitFromReview(page)
  expect(accepted.status()).toBe(201)
  await expect(page.getByRole('heading', { name: 'Report submitted' })).toBeVisible()
  expect(seen.presigns).toBeGreaterThan(0)
  const sent = seen.reports[seen.reports.length - 1]
  expect(sent.outcome).toBe('target')
  expect(sent.speciesId).toBe(seen.scans[0].predictedSpeciesId)
  expect(sent.captureId).toBe(seen.scans[0].captureId)
  expect(sent.photoKey).toMatch(/\S/)
  expect(typeof sent.location.lat).toBe('number')
  expect(typeof sent.location.lng).toBe('number')
  expect(sent.location.lat).toBeCloseTo(KL_FIX.latitude, 4)
  expect(sent.location.lng).toBeCloseTo(KL_FIX.longitude, 4)
  expect(Math.abs(sent.location.lat)).toBeLessThanOrEqual(90)
  expect(Math.abs(sent.location.lng)).toBeLessThanOrEqual(180)
  const stored = await accepted.json() as ReportJson
  expect(stored.submission.photoKey).toMatch(/\S/)
  // The submission timestamp is the server's, not a field the client sent.
  expect(sent).not.toHaveProperty('createdAt')
  expect(Math.abs(Date.parse(stored.createdAt) - Date.now())).toBeLessThan(60_000)
})

test('AC 2.2.3 Honest publication status', async ({ page, context, baseURL }) => {
  // Proves: the client never sends a status; a new report comes back as
  // `processing` with no sighting and is absent from the public list; after
  // screening it reads `screened` and the UI says it is a community report,
  // not expert validated.
  // Mock mirror only: status transitions being server-controlled and
  // unsupported transitions being rejected are backend rules.
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  const seen = watchEvidence(page)
  await startPrivateAccess(page)
  await scanPhoto(page)
  await reachReview(page)
  const before = await publicSightings(page, seen.authorization)

  const created = await submitFromReview(page)
  expect(created.status()).toBe(201)
  const report = await created.json() as ReportJson
  expect(seen.reports[0]).not.toHaveProperty('status')
  expect(report.status).toBe('processing')
  expect(report.sightingId).toBeNull()
  // Not on the public map while processing.
  const during = await publicSightings(page, seen.authorization)
  expect(during.ids).toEqual(before.ids)
  expect(during.ids).not.toContain(`report-${report.id}`)
  // And the user is not told it was published.
  await expect(page.getByRole('heading', { name: 'Report submitted' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Report published' })).toHaveCount(0)

  // Screening succeeds: status becomes screened and the public wording appears.
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible({ timeout: 8000 })
  // The app writes this with a hyphen where the criterion has an en dash.
  await expect(page.getByText(/Community report [–-] not expert validated/)).toBeVisible()
  const screened = await apiCall(page, { method: 'GET', path: `${REPORTS_PATH}/${report.id}`, authorization: seen.authorization })
  expect(screened.json).toMatchObject({ status: 'screened', sightingId: `report-${report.id}` })
  const after = await publicSightings(page, seen.authorization)
  expect(after.ids).toContain(`report-${report.id}`)
  expect(after.ids).toHaveLength(before.ids.length + 1)

  // A client that names its own status is ignored: a second, distinct report
  // sent with status "screened" still starts as processing and unpublished.
  const secondCapture = crypto.randomUUID()
  const secondHash = 'ab'.repeat(32)
  const scan = await apiCall(page, {
    method: 'POST',
    path: SCANS_PATH,
    authorization: seen.authorization,
    body: { ...seen.scans[0], captureId: secondCapture, imageSha256Hex: secondHash },
  })
  expect(scan.status).toBe(201)
  const forced = await apiCall(page, {
    method: 'POST',
    path: REPORTS_PATH,
    authorization: seen.authorization,
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: {
      ...seen.reports[0],
      captureId: secondCapture,
      imageSha256: secondHash,
      location: { lat: KL_FIX.latitude + 0.05, lng: KL_FIX.longitude + 0.05 },
      status: 'screened',
      sightingId: 'client-chosen',
    },
  })
  expect(forced.status).toBe(201)
  expect(forced.json).toMatchObject({ status: 'processing', sightingId: null })
  const afterForced = await publicSightings(page, seen.authorization)
  expect(afterForced.ids).toEqual(after.ids)
})

test('AC 2.3.1 Exact-image duplicate check', async ({ page, context, baseURL }) => {
  // Proves: reporting the same photo and species twice from one identity gets
  // the first report's ID back and adds no second public marker, and the
  // image hash is not in the public sightings payload.
  // Mock mirror only: the SHA-256/species/owner check itself runs in the
  // browser mock here; the backend check and its usability-testing switch are
  // not proven.
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  const seen = watchEvidence(page)
  await startPrivateAccess(page)
  await scanPhoto(page)
  await reachReview(page)
  const before = await publicSightings(page, seen.authorization)

  const first = await submitFromReview(page)
  expect(first.status()).toBe(201)
  const original = await first.json() as ReportJson
  await backToMap(page)
  await expect.poll(async () => (await publicSightings(page, seen.authorization)).ids)
    .toContain(`report-${original.id}`)
  const published = await publicSightings(page, seen.authorization)
  expect(published.ids).toHaveLength(before.ids.length + 1)

  // The same photo again, as a new scan.
  await scanAgainInApp(page, 'mikania-micrantha.jpg')
  await reachReview(page)
  const second = await submitFromReview(page)
  const duplicate = await second.json() as ReportJson
  expect(seen.scans).toHaveLength(2)
  expect(seen.scans[1].captureId).not.toBe(seen.scans[0].captureId)
  expect(seen.reports[1].imageSha256).toBe(seen.reports[0].imageSha256)
  expect(seen.reports[1].speciesId).toBe(seen.reports[0].speciesId)

  // The existing report ID comes back and no second marker is created.
  expect(duplicate.id).toBe(original.id)
  const after = await publicSightings(page, seen.authorization)
  expect(after.ids).toEqual(published.ids)
  const mine = await apiCall(page, { method: 'GET', path: '/api/v1/reports/mine', authorization: seen.authorization })
  expect((mine.json!.items as unknown[])).toHaveLength(1)
  await expect(page.getByRole('heading', { name: 'Report published' })).toHaveCount(0)

  // The hash is for duplicate detection only: not in the public payload.
  expect(after.text).not.toContain(seen.reports[0].imageSha256)
})

test('AC 2.3.2 Near-duplicate merging', async ({ page, context, baseURL }) => {
  // Proves: a different photo of the same species from the same identity, at
  // the same spot minutes later, comes back as `merged` with the retained
  // report's ID, adds no second marker, and the user is told it was merged.
  // Mock mirror only: the 25 m / 10 minute calculation from stored
  // coordinates and the merge audit record are backend rules, not proven.
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  const seen = watchEvidence(page)
  await startPrivateAccess(page)
  await scanPhoto(page)
  await reachReview(page)
  const before = await publicSightings(page, seen.authorization)

  const first = await submitFromReview(page)
  const original = await first.json() as ReportJson
  await backToMap(page)
  await expect.poll(async () => (await publicSightings(page, seen.authorization)).ids)
    .toContain(`report-${original.id}`)
  const published = await publicSightings(page, seen.authorization)

  // A different photo (so not an exact-image duplicate), same pinned species,
  // same GPS fix, well inside ten minutes.
  await scanAgainInApp(page, 'limnocharis_flava.jpg')
  await reachReview(page)
  const second = await submitFromReview(page)
  const merged = await second.json() as ReportJson
  expect(seen.reports[1].imageSha256).not.toBe(seen.reports[0].imageSha256)
  expect(seen.reports[1].speciesId).toBe(seen.reports[0].speciesId)
  expect(seen.reports[1].location).toEqual(seen.reports[0].location)

  expect(merged.status).toBe('merged')
  expect(merged.id).toBe(original.id)
  // The user is told the submission was merged.
  await expect(page.getByRole('heading', { name: 'Added to a recent nearby report' })).toBeVisible()
  await expect(page.getByText(/merged with that existing sighting instead of creating a\s+new marker/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Report published' })).toHaveCount(0)
  // No second public marker.
  const after = await publicSightings(page, seen.authorization)
  expect(after.ids).toEqual(published.ids)
  expect(after.ids).toHaveLength(before.ids.length + 1)
})

test('AC 2.3.3 Submission rate limit', async ({ page, context, baseURL }) => {
  // Proves: once ten submissions have been made in the window, the next gets
  // HTTP 429 with a retry-after time, the app keeps the user's report instead
  // of losing it, and existing reports stay readable.
  // Mock mirror only: the limit is counted in the browser mock. That the
  // backend enforces it per token and per IP, and that it is configurable
  // without a code change, is not proven here.
  await atLocation(context, baseURL)
  await pinModelSpecies(page, 'mikania_micrantha')
  const seen = watchEvidence(page)
  await startPrivateAccess(page)
  await scanPhoto(page)
  await reachReview(page)

  // One real report first, so there is an existing report to stay accessible.
  const first = await submitFromReview(page)
  expect(first.status()).toBe(201)
  const existing = await first.json() as ReportJson
  await backToMap(page)

  // Nine more submissions inside the window brings the token to ten.
  const further = []
  for (let index = 0; index < 9; index += 1) {
    further.push(await apiCall(page, {
      method: 'POST',
      path: REPORTS_PATH,
      authorization: seen.authorization,
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: { ...seen.reports[0], captureId: crypto.randomUUID() },
    }))
  }
  expect(further.map((response) => response.status)).not.toContain(429)

  // The eleventh is refused with a retry-after time.
  const limited = await apiCall(page, {
    method: 'POST',
    path: REPORTS_PATH,
    authorization: seen.authorization,
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: { ...seen.reports[0], captureId: crypto.randomUUID() },
  })
  expect(limited.status).toBe(429)
  expect(limited.json).toMatchObject({ code: 'rate_limited' })
  expect(Number(limited.retryAfter)).toBeGreaterThan(0)
  expect(Number(limited.retryAfter)).toBeLessThanOrEqual(10 * 60)
  expect(limited.json!.retryAfterSeconds).toBe(Number(limited.retryAfter))

  // Existing reports remain accessible while limited.
  const mine = await apiCall(page, { method: 'GET', path: '/api/v1/reports/mine', authorization: seen.authorization })
  expect(mine.status).toBe(200)
  expect((mine.json!.items as Array<{ id: string }>).map((item) => item.id)).toContain(existing.id)
  const single = await apiCall(page, { method: 'GET', path: `${REPORTS_PATH}/${existing.id}`, authorization: seen.authorization })
  expect(single.status).toBe(200)

  // Through the app: a rate-limited submission is kept for later, not lost
  // and not reported as submitted.
  await scanAgainInApp(page, 'limnocharis_flava.jpg')
  await reachReview(page)
  const refused = await submitFromReview(page)
  expect(refused.status()).toBe(429)
  expect(Number(refused.headers()['retry-after'])).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { name: 'Saved for later' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Report submitted|Report published/ })).toHaveCount(0)
})
