import { expect, test, type Page } from '@playwright/test'
import { pickEventTime } from './fixtures/event-time'

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
  await page.keyboard.press('Escape')
  await expect(calendar).toBeHidden()
})

test('the tapped first and last days stay filled while the pointer rests on them', async ({ page }) => {
  await start(page)
  await navigate(page, '/events')
  await page.getByRole('button', { name: 'Custom dates' }).click()
  await page.getByRole('button', { name: 'Next month' }).click()
  const days = page.locator('.range-calendar__day button')
  await days.nth(4).click()
  await days.nth(9).click() // a touch screen keeps :hover on the last tapped day
  const green = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.color = 'var(--green)'
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  })
  for (const day of [days.nth(4), days.nth(9)]) {
    await expect.poll(() => day.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(green)
  }
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
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('alert').first()).toContainText('Choose a date, a start time and how long the event lasts')
  await pickEventTime(page, { hour: 8, duration: '2 h' })
  await expect(page.getByRole('status').filter({ hasText: '08:00–10:00' })).toContainText('2 h')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(/\/events\/layout-event$/)
  // 08:00–10:00 on the 15th in the browser's Asia/Kuala_Lumpur zone (UTC+8, no DST)
  // is sent as 00:00–02:00 UTC. The runner's own zone may differ, so match the shape.
  expect(submitted?.startAt).toMatch(/^\d{4}-\d{2}-15T00:00:00\.000Z$/)
  expect(submitted?.endAt).toBe(submitted?.startAt.replace('T00:', 'T02:'))
})
