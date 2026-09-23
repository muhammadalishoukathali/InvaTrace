// UT-07: when a scan lands on an invasive that has a reviewed native look-alike,
// the result shows the side-by-side comparison - the native's photo, name and
// the written distinguishing traits. Pins the development model to Limnocharis
// flava (which has the Monochoria twin) so the journey is deterministic.
import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

async function startPrivateAccess(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/private-access$/)
  await page.getByRole('button', { name: 'Start privately' }).click()
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue to InvaTrace' }).click()
  await expect(page).toHaveURL(/\/map$/)
}

test('a scan with a reviewed native look-alike shows the comparison card + image', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('invatrace.development-model-species', 'limnocharis_flava')
  })
  await startPrivateAccess(page)

  await page.getByRole('button', { name: /Scan a plant|New scan/ }).first().click()
  await expect(page).toHaveURL(/\/scan$/)
  await page.locator('input[aria-label="Choose photo from gallery"]').setInputFiles(
    path.join(process.cwd(), 'public/reference-images/limnocharis_flava.jpg'),
  )
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /Analyse plant/ }).click()
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 5000 })

  // The native look-alike comparison renders with the reviewed content.
  await expect(page.getByRole('heading', { name: 'Compare with the native look-alike' }))
    .toBeVisible()
  await expect(page.getByText('Monochoria vaginalis')).toBeVisible()
  await expect(page.getByText('Native. Do not remove.')).toBeVisible()
  // A real reviewed photo is shown (not the honest "no photo yet" fallback).
  await expect(page.locator('img[alt="Reference photo of Monochoria"]'))
    .toHaveAttribute('src', /monochoria_vaginalis\.jpg/)
  await expect(page.getByText('No reviewed reference photo of the native look-alike is available yet'))
    .toHaveCount(0)
  // At least one distinguishing trait is listed.
  await expect(page.getByText(/three-angled \(trigonous\) petioles/)).toBeVisible()

  if (process.env.TWIN_SHOT) {
    await page.getByRole('heading', { name: 'Compare with the native look-alike' })
      .scrollIntoViewIfNeeded()
    await page.screenshot({ path: process.env.TWIN_SHOT, fullPage: true })
  }
})
