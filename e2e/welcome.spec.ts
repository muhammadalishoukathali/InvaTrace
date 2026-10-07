// Epic 10: the public welcome page at "/" and its hand-off to the existing
// private-access flow. Runs against the mock service worker (npm run dev).
import { test, expect } from '@playwright/test'

test('a first-time visitor can read the welcome page without an identity', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1, name: /Spot invasive plants/ })).toBeVisible()
  await expect(page.getByText('For Malaysia’s parks and trails')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start privately' }).first()).toBeVisible()
  await expect(page.getByText('Supporting SDG 15 · Life on Land')).toBeInViewport()
  for (const impact of ['Native vegetation', 'Native habitats', 'Shared natural spaces']) {
    await expect(page.getByRole('heading', { name: impact })).toBeVisible()
  }
  for (const step of ['Discover what to look for', 'Identify a plant', 'Follow safe guidance', 'Report a sighting', 'Monitor places over time']) {
    await expect(page.getByRole('heading', { level: 3, name: step, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('link', { name: /MyIAS/ })).toHaveAttribute('href', 'https://www.mybis.gov.my/ias/')
})

test('How it works moves to the five steps', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'How it works' }).first().click()
  await expect(page.getByRole('heading', { name: 'How InvaTrace helps' })).toBeInViewport()
  await expect(page).toHaveURL(/#how-it-works$/)
})

test('Start privately hands over to private access, then "/" opens the map', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Start privately' }).last().click()
  await expect(page).toHaveURL(/\/private-access$/)
  await page.getByRole('button', { name: 'Start privately' }).click()
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible()

  // Recovery not confirmed yet: "/" resumes that step instead of the welcome page.
  await page.goto('/')
  await expect(page).toHaveURL(/\/private-access\/recovery$/)

  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)

  // Existing identity: "/" goes to the map, /welcome still shows the page.
  await page.goto('/')
  await expect(page).toHaveURL(/\/map$/)
  await page.goto('/welcome')
  await expect(page.getByRole('heading', { level: 1, name: /Spot invasive plants/ })).toBeVisible()
})

test('protected routes still require private access', async ({ page }) => {
  for (const path of ['/map', '/scan', '/report']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/private-access$/)
  }
})
