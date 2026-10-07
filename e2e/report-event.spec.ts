import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

test.skip(process.env.RUN_INVATRACE_IT3_E2E !== '1' && process.env.PLAYWRIGHT_EPIC9 !== '1', 'Set RUN_INVATRACE_IT3_E2E=1 or PLAYWRIGHT_EPIC9=1 for iteration-3 browser coverage.')

async function startPrivateAccess(page: Page) {
  await page.goto('/private-access')
  await page.getByRole('button', { name: 'Start privately' }).click()
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
  let reportPosts = 0
  await page.route('**/api/v1/model-config', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ modelVersion: 'development-invatrace-student33-tinyvit5m-320-fp16', supportedVersions: ['development-invatrace-student33-tinyvit5m-320-fp16'], acceptanceThreshold: .5, thresholdVersion: 'test', configVersion: 'test' }) }))
  await page.route('**/api/v1/scans', async (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'scan-1', createdAt: new Date().toISOString() }) }))
  await page.route('**/api/v1/uploads/presign', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ uploadId: 'upload-1', uploadUrl: 'https://upload.test/photo', photoKey: 'photo-1', expiresAt: '2031-01-01T00:00:00Z' }) })
  })
  await page.route('https://upload.test/**', async (route) => route.fulfill({ status: 200 }))
  await page.route('**/api/v1/reports', async (route) => {
    reportPosts += 1
    const body = route.request().postDataJSON() as { eventId?: string }
    if (reportPosts === 1) {
      expect(body.eventId).toBe('event-1')
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'checkin_required', detail: 'Check-in required.' }) })
      return
    }
    expect(body.eventId).toBeUndefined()
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'report-1', status: 'screened', createdAt: new Date().toISOString(), speciesId: 'mikania-micrantha', eventId: null }) })
  })

  await startPrivateAccess(page)
  const profileId = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('invatrace-identity', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    const value = await new Promise<{ profileId: string }>((resolve, reject) => { const request = db.transaction('identity', 'readonly').objectStore('identity').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }); db.close(); return value.profileId
  })
  const now = new Date()
  await page.evaluate(({ profileId, startAt, endAt }) => localStorage.setItem('invatrace.active-event.v1', JSON.stringify({ eventId: 'event-1', profileId, startAt, endAt, checkedInAt: new Date().toISOString() })), { profileId, startAt: new Date(now.getTime() - 60 * 60_000).toISOString(), endAt: new Date(now.getTime() + 60 * 60_000).toISOString() })
  await reachReportPreview(page)
  await expect(page.getByRole('button', { name: 'Submit to this event' })).toBeVisible()
  expect(reportPosts).toBe(0)
  await page.getByRole('button', { name: 'Submit to this event' }).click()
  await expect(page.getByText(/scan is kept/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit as ordinary report' })).toBeVisible()
  await page.getByRole('button', { name: 'Submit as ordinary report' }).click()
  await expect(page.getByRole('heading', { name: 'Report published' })).toBeVisible()
  expect(reportPosts).toBe(2)
})

test('a non-event validation error keeps the event submission state intact', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 3.1442, longitude: 101.6438, accuracy: 10 })
  let reportPosts = 0
  await page.route('**/api/v1/model-config', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ modelVersion: 'development-invatrace-student33-tinyvit5m-320-fp16', supportedVersions: ['development-invatrace-student33-tinyvit5m-320-fp16'], acceptanceThreshold: .5, thresholdVersion: 'test', configVersion: 'test' }) }))
  await page.route('**/api/v1/scans', async (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'scan-1', createdAt: new Date().toISOString() }) }))
  await page.route('**/api/v1/uploads/presign', async (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ uploadId: 'upload-1', uploadUrl: 'https://upload.test/photo', photoKey: 'photo-1', expiresAt: '2031-01-01T00:00:00Z' }) }))
  await page.route('https://upload.test/**', async (route) => route.fulfill({ status: 200 }))
  await page.route('**/api/v1/reports', async (route) => {
    reportPosts += 1
    expect((route.request().postDataJSON() as { eventId?: string }).eventId).toBe('event-1')
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'species_not_reportable', detail: 'This species cannot be reported.' }) })
  })

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
  expect(reportPosts).toBe(1)
})
