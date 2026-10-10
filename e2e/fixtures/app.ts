// Shared steps for the per-AC specs in e2e/ac and e2e/ac-real. Each helper is
// the same sequence the older journey specs repeat inline; new specs import
// from here so an AC test reads as the Given/When/Then and not the setup.
import { expect, type BrowserContext, type Page, type Route } from '@playwright/test'
import path from 'node:path'

export const KL_FIX = { latitude: 3.1497, longitude: 101.6412, accuracy: 15 }

export async function startPrivateAccess(page: Page) {
  await page.goto('/')
  const started = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/profiles/start')
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  const payload = await (await started).json() as {
    accessToken: string
    profile: { id: string; publicId?: string; role: string; trustLevel: string }
    recoveryCodes: string[]
  }
  await expect(page).toHaveURL(/\/private-access\/recovery$/)
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
  return payload
}

/** The origin must be the dev server's own; a hardcoded one grants nothing. */
export async function atLocation(context: BrowserContext, baseURL: string | undefined, fix = KL_FIX) {
  await context.grantPermissions(['geolocation'], { origin: new URL(baseURL!).origin })
  await context.setGeolocation(fix)
}

/** Pins which species the development model reports, so a spec about the
 *  result page does not depend on how an image hash lands on a class. Call
 *  before the first navigation. */
export async function pinModelSpecies(page: Page, speciesId: string) {
  await page.addInitScript((id) => {
    window.localStorage.setItem('invatrace.development-model-species', id)
  }, speciesId)
}

export function referenceImage(file: string) {
  return path.join(process.cwd(), 'public/reference-images', file)
}

/** From a signed-in page: choose a gallery photo and analyse it through to the result page. */
export async function scanPhoto(page: Page, file = 'mikania-micrantha.jpg') {
  await page.goto('/scan')
  await page.locator('input[aria-label="Choose photo from gallery"]').setInputFiles(referenceImage(file))
  await expect(page.getByText('Photo quality check passed')).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /Analyse plant/ }).click()
  await expect(page).toHaveURL(/\/scan\/result$/, { timeout: 5000 })
}

/** The mock service worker passes assistant questions through to the network,
 *  so they are stubbed at the context: page.route cannot see requests that a
 *  service worker has already handled. */
export async function stubAssistant(context: BrowserContext, handler: (route: Route) => Promise<void> | void) {
  await context.route('**/api/v1/plant-assistant/**', handler)
}
