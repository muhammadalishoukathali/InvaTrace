import { expect, test, type Page } from '@playwright/test'

async function startPrivateAccess(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)
}

test('catalogue, place evidence, adoption and activity use one approved record system', async ({ page }) => {
  await startPrivateAccess(page)

  await page.goto('/catalogue')
  await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
  const search = page.getByPlaceholder('Search scientific or common name')
  await search.fill('not a supported plant')
  await expect(page.getByText('No supported plants found')).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await search.fill('  MILE-A-MINUTE  ')
  await expect(page.getByRole('list', { name: '1 catalogue plants' })).toBeVisible()
  await page.getByRole('link', { name: /Mikania micrantha/ }).click()
  await expect(page).toHaveURL(/\/catalogue\/mikania-micrantha$/)
  await expect(page.getByRole('heading', { name: 'Sources and credits' })).toBeVisible()

  await page.goto('/places')
  await page.getByRole('link', { name: /Bukit Kiara/ }).click()
  await expect(page.getByRole('heading', { name: 'Bukit Kiara' })).toBeVisible()
  await expect(page.getByText('Historical observations do not guarantee current presence.').first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'View catalogue entry' }).first())
    .toHaveAttribute('href', /\/catalogue\//)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Adopt for monitoring' }).click()
  await expect(page.getByRole('button', { name: 'Adopted for monitoring' })).toBeVisible()

  await page.goto('/adopted-areas')
  await expect(page.getByRole('heading', { name: 'Your monitoring bookmarks' })).toBeVisible()
  await expect(page.getByText(/Most recent community report:/)).toBeVisible()
  await page.getByRole('link', { name: 'Open activity map' }).click()
  await expect(page.getByText(/Community monitoring activity/)).toBeVisible()
  await expect(page.getByText(/Raw report counts/)).toBeVisible()
  await page.getByLabel('Plant').selectOption('mikania-micrantha')
  await expect(page).toHaveURL(/species_id=mikania-micrantha/)
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page).not.toHaveURL(/species_id=/)
})
