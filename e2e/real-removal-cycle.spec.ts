// Epic 4 AC 4.8.5 against the actual FastAPI + PostGIS stack (no mock service
// worker): removal -> follow-up with regrowth -> removal again -> a new
// follow-up is needed. Browser GPS is emulated by Playwright against a local
// stack only. Run via playwright.real.config.ts with the Compose demo stack up
// (set REAL_API_URL when the API is not on port 8000). The demo seed has one
// active linked sighting, so reset the stack (`docker compose down -v`) to rerun.
import { expect, test } from '@playwright/test'

const API = process.env.REAL_API_URL ?? 'http://localhost:8000'

type Detail = {
  id: string
  status: string
  followUpState?: string | null
  location: { lat: number; lng: number }
  removalReportId: string | null
  removalReportedAt?: string | null
  followUpHistory: Array<{ eventType: string; createdAt: string }>
}

test('a regrown sighting can be marked removed again on the real stack', async ({ page, context, request }) => {
  // A demo sighting that is active, screened and linked to a report.
  const list = await (await request.get(`${API}/api/v1/sightings`)).json() as { items: Array<{ id: string }> }
  let target: Detail | null = null
  for (const item of list.items) {
    const detail = await (await request.get(`${API}/api/v1/sightings/${item.id}`)).json() as Detail
    if (detail.status === 'screened' && !detail.followUpState && detail.removalReportId) { target = detail; break }
  }
  expect(target, 'the demo seed should contain an active sighting with a linked report').not.toBeNull()
  const sighting = target!

  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: sighting.location.lat, longitude: sighting.location.lng, accuracy: 8 })

  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)

  const markRemoved = async () => {
    await page.getByRole('button', { name: 'Mark as removed' }).click()
    await page.getByRole('button', { name: 'Confirm removal report' }).first().click()
    await expect(page.getByRole('heading', { name: 'Follow-up needed' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Start follow-up' })).toBeVisible()
  }

  await page.goto(`/map?sighting=${sighting.id}`)
  await markRemoved()

  await page.getByRole('link', { name: 'Start follow-up' }).click()
  await page.getByRole('button', { name: /current location/i }).click()
  await expect(page.getByText('±8 m')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('radio', { name: /Regrowth present/i }).check()
  await page.getByRole('button', { name: 'Review follow-up' }).click()
  await page.getByRole('button', { name: 'Record follow-up' }).click()
  await expect(page.getByRole('heading', { name: 'Follow-up recorded' })).toBeVisible()

  await page.getByRole('link', { name: 'Return to map' }).click()
  await expect(page.getByText('The marker is active on the map again.')).toBeVisible()
  const afterRegrowth = await (await request.get(`${API}/api/v1/sightings/${sighting.id}`)).json() as Detail
  expect(afterRegrowth).toMatchObject({ status: 'screened', followUpState: 'regrowth' })

  // The point of AC 4.8.5: the active marker can be removed again.
  await markRemoved()

  const final = await (await request.get(`${API}/api/v1/sightings/${sighting.id}`)).json() as Detail
  expect(final).toMatchObject({ status: 'removal_reported', followUpState: 'needed' })
  expect(final.followUpHistory.map((event) => event.eventType)).toEqual([
    'reported', 'removal_reported', 'followup_regrowth', 'removal_reported',
  ])
  expect(final.removalReportedAt).not.toBe(afterRegrowth.removalReportedAt)
})
