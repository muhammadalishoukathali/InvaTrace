import { expect, test, type Page } from '@playwright/test'
import { pickEventTime } from './fixtures/event-time'

test.skip(process.env.RUN_INVATRACE_IT3_E2E !== '1' && process.env.PLAYWRIGHT_EPIC9 !== '1', 'Iteration-3 browser coverage is gated.')
// These specs stub the API with page.route(); switch off the dev MSW event mocks.
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('invatrace.mock.community', 'off')) })

const place = { placeId: '10000000-0000-4000-8000-000000000001', displayName: 'Bukit Kiara' }
const future = { event_id: 'event-1', title: 'Original title', purpose: 'Original purpose', event_type: 'survey', status: 'draft', place_id: place.placeId, target_species_ids: [], meeting_latitude: 3.15, meeting_longitude: 101.64, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z', land_status: 'not_protected', is_host: true }

async function access(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Start privately' }).first().click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check(); await page.getByRole('button', { name: 'Continue', exact: true }).click()
  // Wait for setup to finish; navigating away mid-setup invalidates the recovery code.
  await expect(page).toHaveURL(/\/map$/)
}

const OBSERVE_ONLY_STATUS = { land_status: 'protected', protected_area_name: 'Bukit Kiara Forest Reserve', operator: 'Jabatan Perhutanan', allowed_event_types: ['survey', 'monitoring', 'other'], reason: 'This place overlaps Bukit Kiara Forest Reserve. Only survey, monitoring or other observe-and-report activities can be hosted here.', disclaimer: 'Mapped status is not removal permission.' }

async function hostFixture(page: Page, event = future, eligibility = { eligible: true, report_count: 3, required: 3 }) {
  await page.context().route('**/api/v1/places', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [place] }) }))
  await page.context().route(`**/api/v1/places/${place.placeId}`, route => route.fulfill({ json: { ...place, geometry: { type: 'Polygon', coordinates: [[[101.63, 3.14], [101.65, 3.14], [101.65, 3.16], [101.63, 3.16], [101.63, 3.14]]] } } }))
  await page.context().route(`**/api/v1/places/${place.placeId}/land-status`, route => route.fulfill({ json: OBSERVE_ONLY_STATUS }))
  await page.context().route('**/api/v1/events/host-eligibility', route => route.fulfill({ json: eligibility }))
  await page.context().route('**/api/v1/events/event-1', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(event) }))
}

test('hosting stays locked until three sightings are reported (AC 9.6.1)', async ({ page }) => {
  await hostFixture(page, future, { eligible: false, report_count: 1, required: 3 })
  await page.context().route('**/api/v1/events', route => route.fulfill({ json: { items: [] } }))
  await access(page); await page.goto('/events')
  await expect(page.getByRole('button', { name: 'Host an event' })).toBeDisabled()
  await expect(page.getByText('Report 3 sightings to unlock hosting (1/3 so far).')).toBeVisible()
  await page.goto('/events/host')
  await expect(page.getByRole('heading', { name: 'Hosting unlocks after 3 sightings' })).toBeVisible()
  await expect(page.getByLabel('Mapped place')).toHaveCount(0)
})

test('host form picks the place first, locks removal on protected land and blocks invalid input', async ({ page }) => {
  let creates = 0
  await hostFixture(page)
  await page.context().route('**/api/v1/events', route => { creates += 1; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ event_id: 'created', status: 'draft' }) }) })
  await access(page); await page.goto('/events/host')
  await expect(page.getByRole('heading', { name: /^Step 1 of 3/ })).toBeVisible()
  // The type picker waits for the place: what can run depends on its land status.
  await expect(page.getByRole('radio', { name: /Community survey/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Choose a mapped place.')).toBeVisible()
  await page.getByLabel('Mapped place').fill('Bukit'); await page.getByRole('button', { name: /Bukit Kiara/ }).click()
  // AC 9.6.6 / 9.6.7: mapped protected land offers observe-and-report types only.
  await expect(page.getByText('Protected area: Bukit Kiara Forest Reserve')).toBeVisible()
  await expect(page.getByText(/Managed by Jabatan Perhutanan/)).toBeVisible()
  // Removal is not offered at all here — not even as a greyed-out option.
  await expect(page.getByRole('radio', { name: /Removal activity/ })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: /Repeat monitoring/ })).toBeVisible()
  await expect(page.getByRole('radio', { name: /Community survey/ })).toBeChecked()
  await expect(page.getByText(/permission from the land manager/i)).toHaveCount(0)
  await expect(page.getByText(/^Meeting point \d/)).toBeVisible(); await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: /^Step 2 of 3/ })).toBeVisible()
  // Past days and the previous month are never offered; no time yet blocks Continue.
  await page.getByRole('button', { name: /^Date / }).click()
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeDisabled()
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  if (yesterday.getMonth() === new Date().getMonth()) await expect(page.getByRole('group', { name: /^Days in / }).getByRole('button', { name: new RegExp(` ${yesterday.getDate()} `) })).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Enter an event title.')).toBeVisible(); await expect(page.getByText('Describe what the group will do.')).toBeVisible()
  await expect(page.getByText('Choose a date, a start time and how long the event lasts.')).toBeVisible()
  await page.getByLabel('Event title').fill('Survey'); await page.getByRole('textbox', { name: /^Purpose/ }).fill('Record observations')
  await pickEventTime(page, { hour: 10 }); await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: /^Step 3 of 3/ })).toBeVisible()
  await expect(page.getByText(/Mapped protected area \(Bukit Kiara Forest Reserve\) — observe and report/)).toBeVisible()
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
  await page.goto('/events/event-1/edit'); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Event title').fill('Unsaved local title')
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
  await page.getByRole('link', { name: 'Back to event', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Withdraw', exact: true })).toBeVisible()
  // Checked in: the event now leads to today's task rather than another check-in.
  await expect(page.getByRole('link', { name: 'Open today’s task' })).toBeVisible()
  // Check-in was replaced in history, so browser Back never lands on it again.
  await page.goBack(); await expect(page).toHaveURL(/\/tasks$/)
  await page.goBack(); await expect(page).not.toHaveURL(/\/check-in$/)
})

test('wizard Back steps back, leaving unsaved asks first, and a published event cannot re-open the form', async ({ page }) => {
  await hostFixture(page)
  await page.context().route('**/api/v1/events?*', route => route.fulfill({ json: { items: [] } }))
  await page.context().route('**/api/v1/events', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 201, json: { event_id: 'event-1', status: 'draft' } })
    : route.fulfill({ json: { items: [] } }))
  await page.context().route('**/api/v1/events/event-1', route => route.fulfill({ json: { ...future, status: route.request().method() === 'PATCH' ? 'published' : future.status } }))
  await access(page); await page.goto('/events')
  await page.getByRole('link', { name: 'Host an event' }).click()
  await page.getByLabel('Mapped place').fill('Bukit'); await page.getByRole('button', { name: /Bukit Kiara/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: /^Step 2 of 3/ })).toBeVisible()

  // Browser Back returns to the previous step and keeps what was entered.
  await page.goBack()
  await expect(page.getByRole('heading', { name: /^Step 1 of 3/ })).toBeVisible()
  await expect(page).toHaveURL(/\/events\/host$/)
  await expect(page.getByText('Bukit Kiara', { exact: true })).toBeVisible()

  // Leaving with an unsaved draft asks first.
  await page.getByRole('link', { name: 'Back to events' }).click()
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible()
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await expect(page).toHaveURL(/\/events\/host$/)

  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Event title').fill('Survey'); await page.getByRole('textbox', { name: /^Purpose/ }).fill('Record observations')
  await pickEventTime(page, { hour: 10 }); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Publish event' }).click()
  await expect(page).toHaveURL(/\/events\/event-1$/)
  // The wizard was replaced in history: Back goes to where hosting started.
  await page.goBack()
  await expect(page).toHaveURL(/\/events$/)
})

test('an event opened from a filtered list returns to the same filters', async ({ page }) => {
  await hostFixture(page, { ...future, status: 'published', is_host: false })
  await page.context().route('**/api/v1/events?*', route => route.fulfill({ json: { items: [{ ...future, status: 'published' }] } }))
  await access(page); await page.goto('/events')
  await page.getByRole('button', { name: 'Next 7 days' }).click()
  await expect(page).toHaveURL(/range=week/)
  await page.getByRole('link', { name: /Original title/ }).click()
  await page.getByRole('link', { name: 'Back to events' }).click()
  await expect(page).toHaveURL(/range=week/)
  await expect(page.getByRole('button', { name: 'Next 7 days' })).toHaveAttribute('aria-pressed', 'true')
})
