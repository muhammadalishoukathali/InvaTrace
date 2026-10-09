import { expect, test, type Page } from '@playwright/test'

test.use({ locale: 'zh-CN', timezoneId: 'Asia/Kuala_Lumpur' })

async function start(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
  await page.evaluate(async () => {
    const path = '/e2e/fixtures/responsive-api.ts'
    const { install } = await import(path)
    install()
  })
}

async function navigate(page: Page, destination: string) {
  await page.evaluate(async destination => {
    const path = '/src/app/router.tsx'
    const { router } = await import(path)
    await router.navigate(destination)
  }, destination)
  await expect(page.locator('.route-loading')).toHaveCount(0)
}

test('dates and fields remain English with a Chinese browser locale', async ({ page }) => {
  await start(page)
  expect(await page.evaluate(() => navigator.language)).toBe('zh-CN')
  for (const [route, selector] of [
    ['/catalogue', '.catalogue-list'],
    ['/reports', '.my-reports__results'],
    ['/reports/layout-report', '.report-tracking__meta'],
    ['/places/10000000-0000-4000-8000-000000000001', '.place-associations'],
    ['/events/layout-event', '.event-when'],
    ['/events/layout-event/summary', '.event-stats'],
    ['/events', '.event-card'],
  ]) {
    await navigate(page, route)
    await expect(page.locator(selector).first()).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/[\p{Script=Han}]/u)
  }
  await expect(page.locator('.event-card').first()).toContainText(/[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} · \d{2}:\d{2}–\d{2}:\d{2}/)
  await page.getByRole('button', { name: 'Custom dates' }).click()
  await expect(page.locator('.events-range input')).toHaveCount(0)
  const calendar = page.locator('.range-calendar')
  await expect(calendar.locator('.range-calendar__head strong')).toHaveText(/^[A-Z][a-z]+ \d{4}$/)
  await expect(calendar.locator('.range-calendar__weekday').first()).toHaveText('Mo')
  await expect(calendar).not.toContainText(/[\p{Script=Han}]/u)
})

test('English hosting fields validate input and preserve API dates', async ({ page, context }) => {
  // The POST is stubbed with context.route(); let it pass the dev MSW event mocks.
  await page.addInitScript(() => localStorage.setItem('invatrace.mock.community', 'off'))
  await start(page)
  let submitted: { startAt: string; endAt: string } | undefined
  await context.route('**/api/v1/events', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    submitted = route.request().postDataJSON()
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ event_id: 'layout-event', status: 'draft' }) })
  })
  await navigate(page, '/events/host')
  await page.getByLabel('Event title').fill('English date check')
  await page.getByRole('textbox', { name: /^Purpose/ }).fill('Verify the selected local times.')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Mapped place').fill('Bukit')
  await page.getByRole('button', { name: /Bukit Kiara/ }).click()
  await expect(page.getByText(/^Meeting point \d/)).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Starts', { exact: true }).fill('2030-02-30 08:00')
  await page.getByLabel('Ends', { exact: true }).fill('2030-03-01 10:00')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('alert').first()).toContainText('Enter a start time and an end time after it')
  await page.getByLabel('Starts', { exact: true }).fill('2030-03-01 08:00')
  await page.getByRole('button', { name: 'Choose ends date and time' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Use date and time' }).click()
  await expect(page.getByLabel('Ends', { exact: true })).toHaveValue('2030-03-01 10:00')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(/\/events\/layout-event$/)
  expect(submitted?.startAt).toBe('2030-03-01T00:00:00.000Z')
  expect(submitted?.endAt).toBe('2030-03-01T02:00:00.000Z')
})
