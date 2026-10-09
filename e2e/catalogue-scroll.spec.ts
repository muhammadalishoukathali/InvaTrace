import { expect, test, type Page } from '@playwright/test'

// Screens scroll inside <main>, so the browser never resets it between routes.
// Opening a plant from part-way down the catalogue used to land part-way down
// the plant's page instead of at its photo and name.

async function startPrivateAccess(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
}

const mainScrollTop = (page: Page) => page.locator('main').evaluate((main) => main.scrollTop)

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`a plant opened from a scrolled catalogue starts at the top (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await startPrivateAccess(page)
    await page.goto('/catalogue')
    await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()

    const plant = page.locator('.catalogue-list a').last()
    const href = await plant.getAttribute('href')
    const name = await plant.locator('strong').innerText()
    await plant.scrollIntoViewIfNeeded()
    const listScroll = await mainScrollTop(page)
    expect(listScroll).toBeGreaterThan(300)

    await plant.click()
    await expect(page).toHaveURL(new RegExp(`${href}$`))
    await expect(page.getByRole('heading', { name, exact: true })).toBeInViewport()
    expect(await mainScrollTop(page)).toBe(0)

    // Back returns to the same spot in the list.
    await page.goBack()
    await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
    await expect.poll(() => mainScrollTop(page)).toBe(listScroll)
  })
}
