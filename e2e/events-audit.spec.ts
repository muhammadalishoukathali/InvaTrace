import { expect, test, type Page } from '@playwright/test'
import { pickEventTime } from './fixtures/event-time'

test.skip(process.env.RUN_INVATRACE_IT3_E2E !== '1' && process.env.PLAYWRIGHT_EPIC9 !== '1', 'Iteration-3 browser coverage is gated.')
// These specs stub the API with page.route(); switch off the dev MSW event mocks.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('invatrace.mock.community', 'off')) })

const place = { placeId: '10000000-0000-4000-8000-000000000001', displayName: 'Bukit Kiara' }
const future = { event_id: 'event-1', title: 'Original title', purpose: 'Original purpose', event_type: 'survey', status: 'draft', place_id: place.placeId, target_species_ids: [], meeting_latitude: 3.14, meeting_longitude: 101.69, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z', permission_context: 'unknown', is_host: true }

async function access(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Start privately' }).first().click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check(); await page.getByRole('button', { name: 'Continue', exact: true }).click()
  // Wait for setup to finish; navigating away mid-setup invalidates the recovery code.
  await expect(page).toHaveURL(/\/map$/)
}

async function hostFixture(page: Page, event = future) {
  await page.context().route('**/api/v1/places', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [place] }) }))
  await page.context().route(`**/api/v1/places/${place.placeId}`, route => route.fulfill({ json: { ...place, geometry: { type: 'Polygon', coordinates: [[[101.63, 3.14], [101.65, 3.14], [101.65, 3.16], [101.63, 3.16], [101.63, 3.14]]] } } }))
  await page.context().route('**/api/v1/events/event-1', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(event) }))
}

test('host form prevents blank, invalid time, permission and http chat submissions', async ({ page }) => {
  let creates = 0
  await hostFixture(page)
  await page.context().route('**/api/v1/events', route => { creates += 1; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ event_id: 'created', status: 'draft' }) }) })
  await access(page); await page.goto('/events/host')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Enter an event title.')).toBeVisible(); await expect(page.getByText('Describe what the group will do.')).toBeVisible()
  await page.getByLabel('Event title').fill('Survey'); await page.getByRole('textbox', { name: /^Purpose/ }).fill('Record observations'); await page.getByRole('radio', { name: /Removal activity/ }).check(); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Choose a mapped place.')).toBeVisible()
  await page.getByLabel('Mapped place').fill('Bukit'); await page.getByRole('button', { name: /Bukit Kiara/ }).click()
  await expect(page.getByText(/^Meeting point \d/)).toBeVisible(); await page.getByRole('button', { name: 'Continue' }).click()
  // Past days and the previous month are never offered; no time yet blocks Continue.
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeDisabled()
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  if (yesterday.getMonth() === new Date().getMonth()) await expect(page.getByRole('group', { name: /^Days in / }).getByRole('button', { name: new RegExp(` ${yesterday.getDate()} `) })).toBeDisabled()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Choose a date, a start time and how long the event lasts.')).toBeVisible()
  await expect(page.getByText('A removal event needs confirmed permission from the land manager before it can be published.')).toBeVisible()
  await pickEventTime(page, { hour: 10 }); await page.getByRole('radio', { name: /Confirmed/ }).check(); await page.getByRole('button', { name: 'Continue' }).click()
  // AC 9.6.5: the pre-filled generic notes are not a stated permission basis.
  await expect(page.getByText('State who gave permission and any conditions in the safety notes.')).toBeVisible()
  await page.getByRole('textbox', { name: 'Safety notes' }).fill('Permission from the park office (email, 1 Dec). Gloves provided; stay on marked paths.')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Group chat link (optional)').fill('http://chat.example'); await page.getByRole('button', { name: 'Publish event' }).click()
  await expect(page.getByText('Enter a valid https:// link without a username or password.')).toBeVisible(); expect(creates).toBe(0)
})

test('non-host direct editor route is blocked and refetch does not overwrite dirty host input', async ({ page }) => {
  await hostFixture(page, { ...future, is_host: false })
  await access(page); await page.goto('/events/event-1/edit')
  await expect(page.getByText('Only the event host can edit this event.')).toBeVisible()

  await page.context().unroute('**/api/v1/events/event-1')
  let reads = 0
  await page.context().route('**/api/v1/events/event-1', route => {
    reads += 1
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...future, is_host: true, title: `Server title ${reads}` }) })
  })
  await page.goto('/events/event-1/edit'); await page.getByLabel('Event title').fill('Unsaved local title')
  const beforeRefetch = reads
  // Drive a genuine React Query refetch; a window-focus event is intentionally
  // ignored while the query is still fresh.
  await page.evaluate(async () => {
    const { queryClient } = await import('/src/services/query-client.ts')
    await queryClient.invalidateQueries({ queryKey: ['event', 'event-1'] })
  })
  await expect.poll(() => reads).toBeGreaterThan(beforeRefetch)
  await expect(page.getByLabel('Event title')).toHaveValue('Unsaved local title')
})

test('failed fresh GPS request clears the prior check-in fix and disables confirmation', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['geolocation'], { origin: new URL(baseURL!).origin })
  await context.setGeolocation({ latitude: 3.14, longitude: 101.69, accuracy: 8 })
  await page.context().route('**/api/v1/events/event-1', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...future, status: 'published', is_host: false }) }))
  await access(page); await page.goto('/events/event-1/check-in')
  // Opening the screen requests a fresh location (AC 9.3.1); no tap needed.
  await expect(page.getByText('±8 m')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm check-in' })).toBeEnabled()
  await context.clearPermissions()
  await page.getByRole('button', { name: 'Get a new location' }).click()
  await expect(page.getByText(/Location is unavailable/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm check-in' })).toBeDisabled()
  await expect(page.getByText('Measured accuracy')).toHaveCount(0)
})

test('direct check-in auto-join refreshes cached participation before returning to details', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 3.14, longitude: 101.69, accuracy: 8 })
  let checkedIn = false
  await page.context().route('**/api/v1/events/event-1', route => route.fulfill({ json: {
    ...future, status: 'published', is_host: false, is_joined: checkedIn,
    participation_id: checkedIn ? 'participation-1' : null,
    last_checkin_at: checkedIn ? new Date().toISOString() : null,
  } }))
  await page.context().route('**/api/v1/events/event-1/check-in', route => {
    checkedIn = true
    return route.fulfill({ status: 201, json: { checked_in_at: new Date().toISOString() } })
  })
  await access(page)
  await page.goto('/events/event-1/check-in')
  await expect(page.getByRole('button', { name: 'Confirm check-in' })).toBeEnabled()
  await page.getByRole('button', { name: 'Confirm check-in' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await page.goBack()
  await page.getByRole('link', { name: 'Back to event', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toBeVisible()
})
