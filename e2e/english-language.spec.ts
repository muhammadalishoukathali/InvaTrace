import { expect, test, type Page } from '@playwright/test'

test.use({ locale: 'zh-CN', timezoneId: 'Asia/Kuala_Lumpur' })

async function start(page: Page) {
  await page.goto('/private-access')
  await page.getByRole('button', { name: 'Start privately' }).click()
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

test('dates and fields remain English with a Chinese browser locale', async ({ page }, info) => {
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
  await expect(page.getByLabel('From', { exact: true })).toHaveAttribute('placeholder', 'YYYY-MM-DD HH:mm')
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Choose from date and time' }).click()
  const dialog = page.getByRole('dialog', { name: 'From date and time' })
  await expect(dialog.getByLabel('Month')).toBeFocused()
  await dialog.getByLabel('Year').fill('2030')
  await dialog.getByLabel('Month').selectOption('0')
  await dialog.getByRole('combobox', { name: 'Day', exact: true }).selectOption('31')
  await dialog.getByLabel('Month').selectOption('1')
  await expect(dialog.getByRole('combobox', { name: 'Day', exact: true })).toHaveValue('28')
  await dialog.getByLabel('Year').fill('2028')
  await dialog.getByRole('combobox', { name: 'Day', exact: true }).selectOption('29')
  await dialog.getByLabel('Hour').selectOption('8')
  await dialog.getByLabel('Minute').selectOption('0')
  await expect(dialog).not.toContainText(/[\p{Script=Han}]/u)
  const bounds = await dialog.boundingBox()
  const viewport = page.viewportSize()!
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: info.outputPath('english-date-picker.png') })
  await dialog.getByRole('button', { name: 'Use date and time' }).click()
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('2028-02-29 08:00')
  await expect(page.getByRole('button', { name: 'Choose from date and time' })).toBeFocused()
  await page.getByLabel('From', { exact: true }).fill('2030-02-30 08:00')
  await expect(page.getByRole('alert')).toContainText('Enter valid filter dates')
  await page.getByLabel('From', { exact: true }).fill('2030-01-02 08:00')
  await page.getByLabel('Until', { exact: true }).fill('2030-01-01 08:00')
  await expect(page.getByRole('alert')).toContainText('Until must be later than From')
  await page.getByRole('button', { name: 'Choose until date and time' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Choose until date and time' })).toBeFocused()
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
