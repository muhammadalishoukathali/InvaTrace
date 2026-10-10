import { expect, test } from '@playwright/test'

// The legend scrim covers the whole screen, so it must not behave like a
// button: the shared hover/pressed button effects would tint, shift and
// shrink the entire page while the pointer is over or pressing it.
test('the legend scrim stays still when pressed and dismisses the legend', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)

  await page.getByRole('button', { name: 'Show map legend' }).click()
  const legend = page.getByRole('dialog', { name: 'Map legend' })
  await expect(legend).toBeVisible()

  const scrim = page.locator('.map-legend-scrim')
  const viewport = page.viewportSize()!
  await page.mouse.move(20, 20)
  await page.mouse.down()
  await page.waitForTimeout(250)
  const pressed = await scrim.evaluate((element) => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return {
      backgroundImage: style.backgroundImage,
      filter: style.filter,
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    }
  })
  expect(pressed).toEqual({
    backgroundImage: 'none',
    filter: 'none',
    x: 0, y: 0, width: viewport.width, height: viewport.height,
  })

  await page.mouse.up()
  await expect(legend).toBeHidden()
})
