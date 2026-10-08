import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

test.skip(process.env.RUN_INVATRACE_IT3_E2E !== '1' && process.env.PLAYWRIGHT_EPIC9 !== '1', 'Set RUN_INVATRACE_IT3_E2E=1 or PLAYWRIGHT_EPIC9=1 for iteration-3 browser coverage.')

async function startPrivateAccess(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
}

async function reachReportPreview(page: Page) {
  await page.evaluate(() => window.localStorage.setItem('invatrace.development-model-species', 'mikania_micrantha'))
  await page.getByRole('button', { name: /Scan a plant|New scan/ }).first().click()
  await page.locator('input[aria-label="Choose photo from gallery"]').setInputFiles(path.join(process.cwd(), 'public/reference-images/mikania-micrantha.jpg'))
  await expect(page.getByText('Photo quality check passed')).toBeVisible()
  await page.getByRole('button', { name: /Analyse plant/ }).click()
  await page.getByRole('button', { name: /Report sighting/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByText('Single plant', { exact: true }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('checkbox', { name: /accurate/i }).check()
  await page.getByRole('checkbox', { name: /personal information/i }).check()
  await page.getByRole('button', { name: 'Review submission' }).click()
}

test('event rejection keeps the scan and permits an ordinary report submission', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 3.1442, longitude: 101.6438, accuracy: 10 })
  // The dev mock service worker answers API calls before page.route can see
  // them, so the rejection is injected through the mock's one-shot flag.
  await page.addInitScript(() => { window.__msw = { reportRejection: { status: 422, code: 'checkin_required', detail: 'Check-in required.' } } })
  const reportEventIds = () => page.evaluate(() => window.__msw?.reportEventIds ?? [])

  await startPrivateAccess(page)
  const profileId = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('invatrace-identity', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const value = await new Promise<{ profileId: string }>((resolve, reject) => { const request = db.transaction('identity', 'readonly').objectStore('identity').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }); db.close(); return value.profileId
  })
  const now = new Date()
  await page.evaluate(({ profileId, startAt, endAt }) => localStorage.setItem('invatrace.active-event.v1', JSON.stringify({ eventId: 'event-1', profileId, startAt, endAt, checkedInAt: new Date().toISOString() })), { profileId, startAt: new Date(now.getTime() - 60 * 60_000).toISOString(), endAt: new Date(now.getTime() + 60 * 60_000).toISOString() })
  await reachReportPreview(page)
  await expect(page.getByRole('button', { name: 'Submit to this event' })).toBeVisible()
  expect(await reportEventIds()).toEqual([])
  await page.getByRole('button', { name: 'Submit to this event' }).click()
  await expect(page.getByText(/scan is kept/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit as ordinary report' })).toBeVisible()
  await page.getByRole('button', { name: 'Submit as ordinary report' }).click()
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible()
  expect(await reportEventIds()).toEqual(['event-1', null])
})

test('a non-event validation error keeps the event submission state intact', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 3.1442, longitude: 101.6438, accuracy: 10 })
  await page.addInitScript(() => { window.__msw = { reportRejection: { status: 422, code: 'species_not_reportable', detail: 'This species cannot be reported.' } } })

  await startPrivateAccess(page)
  const profileId = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('invatrace-identity', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const value = await new Promise<{ profileId: string }>((resolve, reject) => { const request = db.transaction('identity', 'readonly').objectStore('identity').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }); db.close(); return value.profileId
  })
  const now = new Date()
  await page.evaluate(({ profileId, startAt, endAt }) => localStorage.setItem('invatrace.active-event.v1', JSON.stringify({ eventId: 'event-1', profileId, startAt, endAt, checkedInAt: new Date().toISOString() })), { profileId, startAt: new Date(now.getTime() - 60 * 60_000).toISOString(), endAt: new Date(now.getTime() + 60 * 60_000).toISOString() })
  await reachReportPreview(page)
  await page.getByRole('button', { name: 'Submit to this event' }).click()

  await expect(page.getByText('This species cannot be reported.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit to this event' })).toBeVisible()
  await expect(page.getByText(/your scan is kept/i)).toHaveCount(0)
  await expect(page.getByText(/you can submit it as an ordinary report/i)).toHaveCount(0)
  expect(await page.evaluate(() => window.__msw?.reportEventIds ?? [])).toEqual(['event-1'])
})
