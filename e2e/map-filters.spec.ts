// Public map filters (AC 4.2.3, 4.6.3, 4.8.4), served by the dev MSW mocks.
import { expect, test, type Page } from '@playwright/test'

async function startPrivateAccess(page: Page) {
  await page.goto('/private-access')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
}

test('the reports list filters by follow-up state and plant, and the count follows', async ({ page }) => {
  await startPrivateAccess(page)
  await page.getByRole('button', { name: /Open reports list/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Community reports list' })
  const count = sheet.locator('.map-reports-sheet__count')
  await expect(count).toContainText('match the current filters')
  const total = await sheet.locator('.map-reports-sheet__item').count()

  // AC 4.6.3: only grey sightings awaiting follow-up remain.
  await sheet.getByRole('button', { name: 'Follow-up needed', exact: true }).click()
  await expect(sheet.getByRole('button', { name: 'Follow-up needed', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => sheet.locator('.map-reports-sheet__item').count()).toBeLessThan(total)
  const followUpItems = sheet.locator('.map-reports-sheet__item-meta')
  for (const text of await followUpItems.allInnerTexts()) expect(text).toMatch(/Follow-up needed|Removal reported/)
  await expect(page.getByRole('button', { name: /Open reports list/ })).toHaveAttribute('aria-label', /filter active/)

  // AC 4.8.4: resolved sightings are reachable from the map.
  await sheet.getByRole('button', { name: 'Follow-up needed', exact: true }).click()
  await sheet.getByRole('button', { name: 'Resolved sightings', exact: true }).click()
  for (const text of await sheet.locator('.map-reports-sheet__item-meta').allInnerTexts()) expect(text).toMatch(/Resolved/)

  // AC 4.2.3: one plant, then Clear filters restores the full list.
  await sheet.getByRole('button', { name: 'Clear filters' }).click()
  await sheet.getByLabel('Plant').selectOption({ label: 'Mile-a-minute weed' })
  for (const text of await sheet.locator('.map-reports-sheet__item-name').allInnerTexts()) expect(text).toMatch(/Mikania micrantha/)
  await sheet.getByRole('button', { name: 'Clear filters' }).click()
  await expect.poll(() => sheet.locator('.map-reports-sheet__item').count()).toBe(total)
})
