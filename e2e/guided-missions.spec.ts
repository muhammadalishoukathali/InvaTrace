import { expect, test, type Page } from '@playwright/test'

// Epic 7 guided habitat missions against the dev MSW mocks and the shipped
// static habitat overlays. Taman Tasik Titiwangsa uses its real OSM-derived id
// so its overlay resolves; Bukit Kiara's mock id has no overlay.
const SUPPORTED = 'e56ae54c-ca04-5fbf-b2c2-01b6e7fbdf46'
const UNSUPPORTED = '10000000-0000-4000-8000-000000000001'

async function startPrivateAccess(page: Page) {
  // Start each test with no saved mock missions, but keep them across this
  // test's own navigations so Resume can be checked.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('missions-reset')) return
    localStorage.removeItem('invatrace-mock-missions-v1')
    sessionStorage.setItem('missions-reset', '1')
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
}

test('a supported place offers a guided mission with its watchlist count (AC 7.1.1)', async ({ page }) => {
  await startPrivateAccess(page)
  await page.goto(`/places/${SUPPORTED}`)
  await expect(page.getByText(/3 watchlist plants/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start guided mission' })).toBeVisible()
})

test('a place without an overlay says so and has no start action (AC 7.1.3)', async ({ page }) => {
  await startPrivateAccess(page)
  await page.goto(`/places/${UNSUPPORTED}`)
  await expect(page.getByText('Guided habitat highlights are unavailable for this place.', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Start guided mission' })).toHaveCount(0)
})

test('preview, filter, habitat details, progress, resume and careful summary (US 7.1-7.6)', async ({ page }) => {
  await startPrivateAccess(page)
  await page.goto(`/places/${SUPPORTED}/mission`)

  // AC 7.1.2 preview: place, plants with reference images, limitation text.
  await expect(page.getByRole('heading', { name: 'Taman Tasik Titiwangsa' })).toBeVisible()
  await expect(page.getByText('Highlights show compatible habitat to search, not confirmed plant locations.')).toBeVisible()
  await expect(page.getByRole('img', { name: /Reference view of Eichhornia crassipes/ })).toBeVisible()
  // AC 7.3.3 access and safety notice.
  await expect(page.getByText(/not walking routes, access has not been verified, and local signs, closures and restrictions take priority/)).toBeVisible()
  await page.getByRole('button', { name: 'Start guided mission' }).click()

  // AC 7.2.1/7.2.2: the legend lists only the visible compatible categories.
  const legend = page.getByLabel('Map legend')
  await expect(legend.getByText('Water edge')).toBeVisible()
  await expect(legend.getByText('Open grassland or shrubland')).toBeVisible()
  await expect(legend.getByText(/probability|score|rank/i)).toHaveCount(0)
  // AC 7.3.2: no probability, score, ranking or high-priority wording anywhere on the page.
  expect(await page.locator('main').innerText()).not.toMatch(/probabilit|\bscore|\brank|high[- ]priority|likely search/i)

  // AC 7.2.3: one plant narrows the habitats; Clear filter restores them.
  await page.getByRole('button', { name: 'Water hyacinth', exact: true }).click()
  await expect(legend.getByText('Open grassland or shrubland')).toHaveCount(0)
  await expect(legend.getByText('Permanent water')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filter' }).click()
  await expect(legend.getByText('Open grassland or shrubland')).toBeVisible()

  // AC 7.3.1: habitat details name the habitat, matching plants and the message.
  await page.getByLabel('Habitats on the map').getByRole('button', { name: /Water edge/ }).click()
  const details = page.getByRole('region', { name: 'Water edge' })
  await expect(details.getByText('Suggested area to search - plant presence is not confirmed.')).toBeVisible()
  await expect(details.getByRole('link', { name: /Water hyacinth/ })).toBeVisible()

  // AC 7.5.1/7.5.2: progress per plant and careful no-find wording.
  await page.getByRole('radiogroup', { name: 'Progress for Siam weed' }).getByRole('radio', { name: 'Looked for' }).click()
  await page.getByRole('button', { name: 'No target plant found' }).click()
  await expect(page.getByText('This does not confirm the plant is absent from the place.', { exact: false })).toBeVisible()

  // AC 7.6.2: leaving and returning offers Resume mission with progress kept.
  await page.goto(`/places/${SUPPORTED}`)
  await page.getByRole('link', { name: 'Resume mission' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Progress for Siam weed' }).getByRole('radio', { name: 'Looked for' })).toHaveAttribute('aria-checked', 'true')

  // AC 7.6.1/7.6.3: summary separates outcomes and never claims the place is clear.
  await page.getByRole('button', { name: 'Finish mission' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Finish mission' }).click()
  await expect(page.getByText('No target plants reported during this mission.', { exact: false })).toBeVisible()
  await expect(page.getByText(/place is clear|recovered|free of invasive/i)).toHaveCount(0)
})

test('catalogue opened from a mission returns to it, and the scanner offers camera, gallery and a way back (AC 7.4.1, 7.4.2)', async ({ page }) => {
  await startPrivateAccess(page)
  await page.goto(`/places/${SUPPORTED}/mission`)
  await page.getByRole('button', { name: 'Start guided mission' }).click()
  await page.getByRole('link', { name: 'Reference' }).first().click()
  await expect(page).toHaveURL(/\/catalogue\/[a-z-]+\?from=mission/)
  await page.getByRole('link', { name: 'Back to mission' }).click()
  await expect(page).toHaveURL(new RegExp(`/places/${SUPPORTED}/mission$`))

  await page.getByRole('button', { name: 'Scan a plant' }).first().click()
  await expect(page.getByRole('button', { name: 'Return to mission' })).toBeVisible()
  await expect(page.getByText('Open camera')).toBeVisible()
  await expect(page.getByRole('button', { name: /Choose from gallery/ })).toBeVisible()
  await page.getByRole('button', { name: 'Return to mission' }).click()
  await expect(page).toHaveURL(new RegExp(`/places/${SUPPORTED}/mission$`))
})
