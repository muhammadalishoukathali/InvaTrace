import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

// Pre-release checks that don't fit neatly under one feature: making sure the
// consent-gated report guidance can't be seen before the user actually picks
// a land-permission option, and that the core pages don't overflow
// horizontally on a small phone screen or a normal desktop.

async function startPrivateAccess(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /Start privately/i }).click()
  await expect(page.getByRole('heading', { name: /Save your recovery kit/i }))
    .toBeVisible({ timeout: 15_000 })
  await page.locator('input[type="checkbox"]').check()
  await page.getByRole('button', { name: /Continue to InvaTrace/i }).click()
  await expect(page).toHaveURL(/\/map$/, { timeout: 15_000 })
}

async function chooseSyntheticGalleryPhoto(page: Page) {
  await page.goto('/scan')
  await page.locator('input[aria-label="Choose photo from gallery"]')
    .setInputFiles(path.join(process.cwd(), 'public/reference-images/mikania_micrantha.jpg'))
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 8_000 })
  await page.getByRole('button', { name: /Analyse plant/i }).click()
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 15_000 })
}

// The permission guidance text carries legal/safety info, so it should only
// appear once the user has picked an option - not shown by default, and not
// showing the other option's text at the same time as this one's.
test('gallery scans require a safe location result and permission before active guidance', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['geolocation'], { origin: new URL(baseURL!).origin })
  await context.setGeolocation({ latitude: 3.1497, longitude: 101.6412, accuracy: 15 })
  await startPrivateAccess(page)
  await chooseSyntheticGalleryPhoto(page)

  await expect(page.getByRole('button', { name: /Report sighting/i })).toBeVisible()
  // AC 3.1.2 - the panel defaults to `protected_or_permission_unknown`,
  // so observation / photography / reporting guidance is visible
  // immediately. Active-guidance copy for the authorised-site path must
  // still stay hidden until the user explicitly picks explicit permission.
  await expect(page.getByText('Protected land or no permission')).toBeVisible()
  await expect(page.getByText('If the land manager has approved it')).toHaveCount(0)

  await page.getByRole('radio', { name: /protected land, or I am not sure/i }).check()
  await expect(page.getByText('Protected land or no permission')).toBeVisible()
  await expect(page.getByText('If the land manager has approved it')).toHaveCount(0)

  await page.getByRole('button', { name: /Check current location/i }).click()
  await expect(page.getByText('No mapped protected-area intersection found')).toBeVisible()
  await page.getByRole('radio', { name: /permission from the land manager/i }).check()
  await expect(page.getByText('Protected land or no permission')).toHaveCount(0)
})

// Runs the same page-by-page overflow check at a small phone width and a
// desktop width - horizontal scroll is the kind of regression that's easy to
// miss by eye but breaks usability on a real device.
for (const viewport of [
  { name: 'small mobile', width: 320, height: 780 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test(`critical pages fit the ${viewport.name} viewport`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await startPrivateAccess(page)

    for (const route of ['/map', '/reports', '/profile', '/scan']) {
      await page.goto(route)
      await expect.poll(async () => page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))).toEqual({
        clientWidth: viewport.width,
        scrollWidth: viewport.width,
      })
    }
  })
}
