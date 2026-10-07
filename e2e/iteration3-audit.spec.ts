import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.PLAYWRIGHT_EPIC9 !== '1', 'Requires the local iteration-3 API.')
// Event stubs use context.route() and the dev MSW event mocks are switched off,
// so these also run under the default mocked config (where page.route() cannot
// see requests answered by the MSW service worker).
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('invatrace.mock.community', 'off')) })

async function access(page: Page) {
  await page.goto('/private-access')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
}
const item = {
  event_id: 'audit-event', title: 'A'.repeat(120), purpose: 'Record community observations.',
  event_type: 'survey', status: 'published', place_id: 'place-1', place_name: 'Mapped place',
  host_display_name: 'Community host', target_species_ids: [], meeting_latitude: 3.1,
  meeting_longitude: 101.6, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z',
  permission_context: 'unknown', is_joined: false,
}

for (const width of [390, 1440]) {
  test(`event details and safety dialog fit ${width}px and isolate keyboard focus`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.context().route('**/api/v1/events/audit-event', route => route.fulfill({ json: item }))
    await access(page)
    await page.goto('/events/audit-event')
    await expect(page.getByRole('heading', { name: item.title })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const opener = page.getByRole('button', { name: 'Report this event' })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Report this event' })
    await expect(dialog).toBeVisible()
    const firstReason = dialog.getByRole('radio').first()
    await expect(firstReason).toBeFocused()
    expect(await page.locator('#root').evaluate(node => node.inert)).toBe(true)
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(opener).toBeFocused()
    expect(await page.locator('#root').evaluate(node => node.inert)).toBe(false)
  })
}

test('join confirmation can be declined without creating participation', async ({ page }) => {
  let joined = false
  await page.context().route('**/api/v1/events/audit-event', route => route.fulfill({ json: item }))
  await page.context().route('**/api/v1/events/audit-event/participants', route => {
    joined = true
    return route.fulfill({ status: 201, json: { participation_id: 'participant' } })
  })
  await access(page)
  await page.goto('/events/audit-event')
  await page.getByRole('button', { name: 'Join this event', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: /Join/ })
  await expect(confirm).toContainText('is not permission to remove any plant')
  await confirm.getByRole('button', { name: 'Not now' }).click()
  await expect(confirm).toHaveCount(0)
  expect(joined).toBe(false)
  await expect(page.getByRole('button', { name: 'Join this event', exact: true })).toBeVisible()
})

test('discovery labels the host and explains an invalid date range', async ({ page }) => {
  const queries: string[] = []
  await page.context().route('**/api/v1/events?**', route => {
    queries.push(route.request().url())
    return route.fulfill({ json: { items: [item] } })
  })
  await page.context().route('**/api/v1/events', route => route.fulfill({ json: { items: [item] } }))
  await access(page)
  await page.goto('/events')
  await expect(page.getByText('Hosted by Community host')).toBeVisible()
  await page.getByRole('button', { name: 'Custom dates' }).click()
  await page.getByLabel('From', { exact: true }).fill('2030-01-02T08:00')
  await page.getByLabel('Until', { exact: true }).fill('2030-01-01T08:00')
  await expect(page.getByRole('alert')).toContainText('Until must be later than From')
  expect(queries.some(url => {
    const params = new URL(url).searchParams
    return params.has('from') && params.has('to') && Date.parse(params.get('to')!) <= Date.parse(params.get('from')!)
  })).toBe(false)
})

test('a real seeded follow-up records an unable attempt and retains the needed state', async ({ page, context, baseURL }) => {
  test.skip(!baseURL?.includes('5175'), 'Uses the isolated local PostGIS seed.')
  const sightingId = 'e41f4e63-4060-575a-b899-2eb30c753d28'
  await access(page)
  const readDetail = () => page.evaluate(async id => {
    const modulePath = '/src/services/api-client.ts'
    const { api } = await import(modulePath)
    return api(`/api/v1/sightings/${id}`)
  }, sightingId) as Promise<{ location: { lat: number; lng: number }; followUpState: string; lastFollowupAt: string | null; followUpHistory: Array<{ eventType: string; createdAt: string }> }>
  const before = await readDetail()
  expect(before.followUpState).toBe('needed')
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: before.location.lat, longitude: before.location.lng, accuracy: 8 })
  await page.goto(`/sightings/${sightingId}/follow-up`)
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('radio', { name: /Unable to confirm/i }).check()
  await page.getByRole('button', { name: 'Review follow-up' }).click()
  const response = page.waitForResponse(res => res.url().endsWith(`/${sightingId}/follow-up`) && res.request().method() === 'POST')
  await page.getByRole('button', { name: 'Record follow-up' }).click()
  expect((await response).status()).toBe(201)
  await expect(page.getByRole('heading', { name: 'Follow-up recorded' })).toBeVisible()
  const after = await readDetail()
  expect(after.followUpState).toBe('needed')
  expect(after.lastFollowupAt).toBeTruthy()
  expect(after.followUpHistory.length).toBe(before.followUpHistory.length + 1)
  expect(after.followUpHistory.at(-1)?.eventType).toBe('followup_unable')
  expect(after.followUpHistory.every(entry => Object.keys(entry).sort().join(',') === 'createdAt,eventType')).toBe(true)
})

test('a rejected offline event report keeps its photo and offers explicit ordinary recovery', async ({ page }) => {
  await access(page)
  const captureId = 'offline-event-audit'
  const queueId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  await page.evaluate(async ({ captureId, queueId }) => {
    const modulePath = '/src/features/private-access/private-access-store.ts'
    const { usePrivateAccess } = await import(modulePath)
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('invatrace', 1)
      open.onupgradeneeded = () => open.result.createObjectStore('report-queue', { keyPath: 'id' })
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const transaction = open.result.transaction('report-queue', 'readwrite')
        transaction.objectStore('report-queue').put({
          id: queueId, ownerProfileId: usePrivateAccess.getState().profile.id,
          createdAt: new Date().toISOString(), attempts: 2, retryable: false,
          lastError: 'The event’s 24-hour upload period has ended.', lastErrorCode: 'upload_grace_exceeded',
          imageBlob: new Blob(['saved photo'], { type: 'image/jpeg' }),
          submission: { captureId, photoKey: 'uploads/saved-photo.jpg', eventId: 'expired-event',
            capturedAt: '2030-01-01T09:00:00Z', observedAt: '2030-01-01T09:00:00Z',
            speciesId: 'mikania-micrantha', outcome: 'target', confidence: .9, modelVersion: 'audit',
            captureSource: 'camera', location: { lat: 3.14, lng: 101.69 }, locationAccuracyM: 8,
            extent: 'single', notes: '', consent: { accurate: true, noPII: true } },
        })
        transaction.oncomplete = () => { open.result.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  }, { captureId, queueId })
  let body: Record<string, unknown> | null = null
  await page.route('**/api/v1/scans', route => route.fulfill({ json: {} }))
  await page.route('**/api/v1/reports', route => {
    body = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: { id: 'recovered-ordinary' } })
  })
  await page.reload()
  await page.getByRole('button', { name: 'View queue', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Queued reports' })
  await expect(dialog).toContainText('24-hour upload period has ended')
  const ordinary = dialog.getByRole('button', { name: 'Submit as ordinary report' })
  await expect(ordinary).toBeVisible()
  expect(body).toBeNull()
  page.once('dialog', async confirmation => confirmation.accept())
  await ordinary.click()
  await expect(dialog).not.toBeVisible()
  expect(body).toMatchObject({ captureId, photoKey: 'uploads/saved-photo.jpg', location: { lat: 3.14, lng: 101.69 } })
  expect(body).not.toHaveProperty('eventId')
  expect(body).not.toHaveProperty('capturedAt')
})

test('host management offers restoration only for eligible hidden events', async ({ page }) => {
  await page.context().route('**/api/v1/events/mine', route => route.fulfill({ json: { items: [
    { ...item, event_id: 'automatic-cancel', title: 'Automatic cancellation', hidden: true, status: 'cancelled', can_restore: true },
    { ...item, event_id: 'manual-cancel', title: 'Intentional cancellation', hidden: true, status: 'cancelled', can_restore: false },
  ] } }))
  await access(page)
  await page.goto('/events/mine')
  await expect(page.getByRole('heading', { name: 'Your hosted events' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Restore visibility' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Cancel event' })).toHaveCount(0)
})
