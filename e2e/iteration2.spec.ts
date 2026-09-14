import { expect, test, type Page } from '@playwright/test'

async function startPrivateAccess(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)
}

test('map place discovery opens an accessible preview and canonical place route', async ({ page }) => {
  await startPrivateAccess(page)
  await expect(page.getByRole('button', { name: 'Hide places' })).toBeVisible()
  const places = page.getByRole('region', { name: 'Mapped places in current view' })
  const bukitKiara = places.getByRole('button', {
    name: /Bukit Kiara.*View plants recorded nearby/,
  })
  await expect(bukitKiara).toBeAttached({ timeout: 10_000 })
  await bukitKiara.focus()
  await page.keyboard.press('Enter')

  const preview = page.getByRole('dialog', { name: /Bukit Kiara place preview/ })
  await expect(preview).toBeVisible()
  await expect(preview.getByRole('link', { name: 'View plants recorded nearby' }))
    .toHaveAttribute('href', /^\/places\/[0-9a-f-]+$/)

  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()
  await expect(bukitKiara).toBeFocused()

  await page.getByRole('button', { name: 'Hide places' }).click()
  await expect(page.getByRole('button', { name: 'Show places' })).toBeVisible()
  await expect(places.getByText('0 mapped places in the current view.')).toBeAttached()
  await page.getByRole('button', { name: 'Show places' }).click()
  await expect(bukitKiara).toBeAttached({ timeout: 10_000 })
})

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
  await expect(page.getByText('Historical records').first()).toBeVisible()
  await expect(page.getByText('Most recent year').first()).toBeVisible()
  await expect(page.getByText('Evidence').first()).toBeVisible()
  await expect(page.getByText('Upstream waterway record')).toHaveCount(0)
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

test('place detail uses the approved no-evidence wording', async ({ page }) => {
  await startPrivateAccess(page)
  await page.goto('/places')
  await page.getByRole('link', { name: /Kota Damansara Community Forest/ }).click()
  await expect(page.getByText('No qualifying historical records found')).toBeVisible()
  await expect(page.getByText('Historical observations do not guarantee current presence.'))
    .toBeVisible()
})
