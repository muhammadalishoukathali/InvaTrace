import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.RUN_INVATRACE_IT3_E2E !== '1' && process.env.PLAYWRIGHT_EPIC9 !== '1', 'Iteration-3 browser coverage is gated.')

const place = { placeId: '10000000-0000-4000-8000-000000000001', displayName: 'Bukit Kiara' }
const future = { event_id: 'event-1', title: 'Original title', purpose: 'Original purpose', event_type: 'survey', status: 'draft', place_id: place.placeId, target_species_ids: [], meeting_latitude: 3.14, meeting_longitude: 101.69, start_at: '2030-01-01T08:00:00Z', end_at: '2030-01-01T10:00:00Z', permission_context: 'unknown', is_host: true }

async function access(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check(); await page.getByRole('button', { name: 'Continue', exact: true }).click()
}

async function hostFixture(page: Page, event = future) {
  await page.route('**/api/v1/places', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [place] }) }))
  await page.route('**/api/v1/events/event-1', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(event) }))
}

test('host form prevents blank, invalid coordinate, time, permission and http chat submissions', async ({ page }) => {
  let creates = 0
  await hostFixture(page)
  await page.route('**/api/v1/events', route => { creates += 1; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ event_id: 'created', status: 'draft' }) }) })
  await access(page); await page.goto('/events/host')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Enter an event title.')).toBeVisible(); await expect(page.getByText('Describe the event purpose.')).toBeVisible()
  await page.getByLabel('Title').fill('Survey'); await page.getByLabel('Purpose').fill('Record observations'); await page.getByLabel('Activity type').selectOption('removal'); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Mapped place').selectOption(place.placeId); await page.getByLabel('Meeting latitude').fill('99'); await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Enter a meeting latitude in Malaysia.')).toBeVisible()
  await page.getByLabel('Meeting latitude').fill('3.14'); await page.getByLabel('Meeting longitude').fill('101.69'); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Starts').fill('2030-01-01T10:00'); await page.getByLabel('Ends').fill('2030-01-01T08:00'); await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Enter a valid end time after the start time.')).toBeVisible(); await expect(page.getByText('Removal events require explicit permission.')).toBeVisible()
  await page.getByLabel('Ends').fill('2030-01-01T12:00'); await page.getByLabel('Permission context').selectOption('explicit_permission'); await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Event chat link (optional)').fill('http://chat.example'); await page.getByRole('button', { name: 'Publish event' }).click()
  await expect(page.getByText('Enter a valid HTTPS chat link without account credentials.')).toBeVisible(); expect(creates).toBe(0)
})

test('non-host direct editor route is blocked and refetch does not overwrite dirty host input', async ({ page }) => {
  await hostFixture(page, { ...future, is_host: false })
  await access(page); await page.goto('/events/event-1/edit')
  await expect(page.getByText('Only the event host can edit this event.')).toBeVisible()

  await page.unroute('**/api/v1/events/event-1')
  let reads = 0
  await page.route('**/api/v1/events/event-1', route => {
    reads += 1
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...future, is_host: true, title: `Server title ${reads}` }) })
  })
  await page.goto('/events/event-1/edit'); await page.getByLabel('Title').fill('Unsaved local title')
  const beforeRefetch = reads
  // Drive a genuine React Query refetch; a window-focus event is intentionally
  // ignored while the query is still fresh.
  await page.evaluate(async () => {
    const { queryClient } = await import('/src/services/query-client.ts')
    await queryClient.invalidateQueries({ queryKey: ['event', 'event-1'] })
  })
  await expect.poll(() => reads).toBeGreaterThan(beforeRefetch)
  await expect(page.getByLabel('Title')).toHaveValue('Unsaved local title')
})

test('failed fresh GPS request clears the prior check-in fix and disables confirmation', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['geolocation'], { origin: new URL(baseURL!).origin })
  await context.setGeolocation({ latitude: 3.14, longitude: 101.69, accuracy: 8 })
  await page.route('**/api/v1/events/event-1', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...future, status: 'published', is_host: false }) }))
  await access(page); await page.goto('/events/event-1/check-in')
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(page.getByText(/Location accuracy: 8 m/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm check-in' })).toBeEnabled()
  await context.clearPermissions()
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(page.getByText(/Location is unavailable/i)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm check-in' })).toBeDisabled()
  await expect(page.getByText(/Location accuracy:/i)).toHaveCount(0)
})

test('direct check-in auto-join refreshes cached participation before returning to details', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 3.14, longitude: 101.69, accuracy: 8 })
  let checkedIn = false
  await page.route('**/api/v1/events/event-1', route => route.fulfill({ json: {
    ...future, status: 'published', is_host: false, is_joined: checkedIn,
    participation_id: checkedIn ? 'participation-1' : null,
    last_checkin_at: checkedIn ? new Date().toISOString() : null,
  } }))
  await page.route('**/api/v1/events/event-1/check-in', route => {
    checkedIn = true
    return route.fulfill({ status: 201, json: { checked_in_at: new Date().toISOString() } })
  })
  await access(page)
  await page.goto('/events/event-1/check-in')
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await page.getByRole('button', { name: 'Confirm check-in' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await page.goBack()
  await page.getByRole('link', { name: 'Back to event', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Withdraw from event' })).toBeVisible()
})
