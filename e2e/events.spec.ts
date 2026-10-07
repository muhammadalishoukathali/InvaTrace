import { expect, test } from '@playwright/test'

async function startPrivateAccess(page: import('@playwright/test').Page) {
  await page.goto('/private-access')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
}

// These exercise the actual event API paths but stay opt-in until Epic 9’s
// server/migration stack is available in every development environment.
test.describe('Epic 9 events', () => {
  test.skip(process.env.PLAYWRIGHT_EPIC9 !== '1', 'Set PLAYWRIGHT_EPIC9=1 when the Epic 9 API is available')
  // These specs stub the API with page.route(); switch off the dev MSW event mocks.
  test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('invatrace.mock.community', 'off')) })

  test('shows the empty discovery state without inventing sample events', async ({ page }) => {
    await page.context().route('**/api/v1/events**', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [] }) })
    })
    await startPrivateAccess(page)
    await page.goto('/events')
    await expect(page.getByRole('heading', { name: 'Upcoming community events' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No upcoming survey events found here' })).toBeVisible()
  })

  test('filters and opens an event served by the real events path', async ({ page }) => {
    const item = { event_id: 'event-1', title: 'Morning survey', purpose: 'Record observations', event_type: 'survey', status: 'published', place_id: 'place-1', place_name: 'Bukit Kiara', target_species_ids: [], meeting_latitude: 3.1, meeting_longitude: 101.6, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z', permission_context: 'unknown', joined_count: 0 }
    await page.context().route('**/api/v1/events**', async (route) => {
      const path = new URL(route.request().url()).pathname
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(path === '/api/v1/events' ? { items: [item] } : item) })
    })
    await startPrivateAccess(page)
    await page.goto('/events')
    await page.getByRole('link', { name: /Morning survey/ }).click()
    await expect(page.getByRole('heading', { name: 'Morning survey' })).toBeVisible()
    await expect(page.getByText(/is not permission to remove any plant/).first()).toBeVisible()
  })

  test('host publish, join, withdraw, check-in and summary use the event API paths', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: 3.1, longitude: 101.6, accuracy: 10 })
    const requests: string[] = []
    const event = { event_id: 'event-1', title: 'Morning survey', purpose: 'Record observations', event_type: 'survey', status: 'published', place_id: '10000000-0000-4000-8000-000000000001', target_species_ids: [], meeting_latitude: 3.1, meeting_longitude: 101.6, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z', permission_context: 'unknown', joined_count: 1, is_joined: false, participation_id: 'participation-1' }
    await page.context().route('**/api/v1/events**', async (route) => {
      const request = route.request(); const path = new URL(request.url()).pathname; requests.push(`${request.method()} ${path}`)
      if (request.method() === 'POST' && path === '/api/v1/events') return route.fulfill({ contentType: 'application/json', status: 201, body: JSON.stringify({ event_id: 'event-1', status: 'draft' }) })
      if (request.method() === 'PATCH') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(event) })
      if (request.method() === 'POST' && path.endsWith('/participants')) { event.is_joined = true; return route.fulfill({ contentType: 'application/json', status: 201, body: JSON.stringify({ participation_id: 'participation-1' }) }) }
      if (request.method() === 'DELETE' && path.includes('/participants/')) return route.fulfill({ status: 204 })
      if (request.method() === 'POST' && path.endsWith('/check-in')) return route.fulfill({ contentType: 'application/json', status: 201, body: JSON.stringify({ checked_in_at: new Date().toISOString() }) })
      if (path.endsWith('/summary')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ reports_submitted_count: 2, distinct_species_count: 1, place_id: event.place_id, place_name: 'Bukit Kiara', start_at: event.start_at, end_at: event.end_at, next_event: null }) })
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(event) })
    })
    await page.context().route('**/api/v1/places', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ placeId: event.place_id, displayName: 'Bukit Kiara' }] }) }))
    await page.context().route(`**/api/v1/places/${event.place_id}`, (route) => route.fulfill({ json: { placeId: event.place_id, displayName: 'Bukit Kiara', placeType: 'park', geometry: { type: 'Polygon', coordinates: [[[101.63, 3.14], [101.65, 3.14], [101.65, 3.16], [101.63, 3.16], [101.63, 3.14]]] } } }))
    await startPrivateAccess(page)
    await page.goto('/events/host')
    await page.getByLabel('Event title').fill('Morning survey'); await page.getByLabel('Purpose', { exact: true }).fill('Record observations'); await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Mapped place').fill('Bukit'); await page.getByRole('button', { name: /Bukit Kiara/ }).click(); await expect(page.getByText(/^Meeting point \d/)).toBeVisible(); await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Starts', { exact: true }).fill('2030-01-01T08:00'); await page.getByLabel('Ends', { exact: true }).fill('2030-01-01T10:00'); await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Publish event' }).click()
    await expect.poll(() => requests.some((request) => request === 'POST /api/v1/events')).toBe(true)
    await expect.poll(() => requests.some((request) => request === 'PATCH /api/v1/events/event-1')).toBe(true)
    await page.goto('/events/event-1')
    await page.getByRole('button', { name: 'Join this event', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Join this event' }).click()
    await expect(page.getByRole('link', { name: 'Check in at the event' })).toBeVisible()
    await page.getByRole('link', { name: 'Check in at the event' }).click()
    await expect(page.getByRole('button', { name: 'Confirm check-in' })).toBeEnabled()
    await page.getByRole('button', { name: 'Confirm check-in' }).click()
    await expect.poll(() => requests.includes('POST /api/v1/events/event-1/check-in')).toBe(true)
    await page.goto('/events/event-1')
    await page.getByRole('button', { name: 'Withdraw', exact: true }).click()
    await expect.poll(() => requests.some((request) => request === 'DELETE /api/v1/events/event-1/participants/participation-1')).toBe(true)
    await page.goto('/events/event-1/summary')
    await expect(page.getByRole('heading', { name: 'What this event recorded' })).toBeVisible()
  })
  test('tasks require this identity’s check-in and restore its context after recovery', async ({ page }) => {
    let checkedIn = false
    const now = Date.now()
    const item = { event_id: 'event-recovery', title: 'Recovered event', purpose: 'Record observations', event_type: 'survey', status: 'published', place_id: 'place-1', target_species_ids: [], meeting_latitude: 3.1, meeting_longitude: 101.6, start_at: new Date(now - 600_000).toISOString(), end_at: new Date(now + 3_600_000).toISOString(), permission_context: 'unknown' }
    await page.context().route('**/api/v1/events/event-recovery', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...item, last_checkin_at: checkedIn ? new Date(now).toISOString() : null }) }))
    await startPrivateAccess(page)
    await page.evaluate(item => localStorage.setItem('invatrace.active-event.v1', JSON.stringify({ eventId: item.event_id, startAt: item.start_at, endAt: item.end_at, checkedInAt: new Date().toISOString(), profileId: 'different-identity' })), item)
    await page.goto('/events/event-recovery/tasks')
    await expect(page.getByRole('heading', { name: 'Check in first' })).toBeVisible()
    checkedIn = true
    await page.reload()
    await expect(page.getByRole('link', { name: 'Start a scan' })).toBeVisible()
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('invatrace.active-event.v1') ?? '{}'))
    expect(restored.eventId).toBe('event-recovery')
    expect(restored.profileId).not.toBe('different-identity')
    expect(restored.profileId).toBeTruthy()
  })
})
