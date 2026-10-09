import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const SIGHTING_ID = 's-10'
const now = '2026-10-02T08:00:00.000Z'

test.skip(process.env.PLAYWRIGHT_EPIC9 !== '1', 'Epic 4 follow-up is gated until the iteration-3 integration environment is enabled.')

async function installFollowUpFixture(page: Page, rejection?: { status: number; code: string; detail: string }) {
  // The dev MSW service worker answers the follow-up POST before page.route can
  // see it, so a server rejection is injected through MSW's one-shot test hook.
  if (rejection) await page.addInitScript((value) => { window.__msw = { ...window.__msw, followUpRejection: value } }, rejection)
  let followUpState: 'needed' | 'resolved' | 'regrowth' = 'needed'
  let status: 'removal_reported' | 'resolved_after_follow_up' | 'screened' = 'removal_reported'
  let lastFollowupAt: string | null = null
  const sighting = () => ({
    id: SIGHTING_ID,
    speciesId: 'mikania-micrantha',
    speciesName: 'Mikania micrantha',
    latinName: 'Mikania micrantha',
    status,
    risk: 'high',
    location: { lat: 3.1483, lng: 101.6404 },
    precisionReduced: false,
    reportCount: 2,
    lastReportedAt: now,
    removalReportedAt: now,
    followUpState,
    lastFollowupAt,
    place: { displayName: 'Test location', areaName: null, trailName: null, source: 'seed' },
    thumbnailUrl: null,
    confidence: 0.8,
    nearestFeatureType: null,
    nearestFeatureName: null,
    nearestFeatureDistanceM: null,
    screeningMethod: 'deterministic_rules',
  })

  await page.route('**/api/v1/sightings**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith(`/sightings/${SIGHTING_ID}/follow-up`)) {
      if (rejection) {
        await route.fulfill({
          status: rejection.status,
          contentType: 'application/json',
          body: JSON.stringify({ code: rejection.code, detail: rejection.detail }),
        })
        return
      }
      const body = request.postDataJSON() as { outcome: string }
      followUpState = body.outcome === 'no_regrowth' ? 'resolved' : body.outcome === 'regrowth_present' ? 'regrowth' : 'needed'
      status = followUpState === 'resolved' ? 'resolved_after_follow_up' : followUpState === 'regrowth' ? 'screened' : 'removal_reported'
      lastFollowupAt = new Date().toISOString()
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ sightingId: SIGHTING_ID, outcome: body.outcome, followUpState, lastFollowupAt }),
      })
      return
    }
    if (request.method() === 'GET' && url.pathname === '/api/v1/sightings') {
      const filter = url.searchParams.get('follow_up') ?? 'any'
      const visible = filter === 'needed'
        ? followUpState === 'needed'
        : filter === 'resolved'
          ? followUpState === 'resolved'
          : filter === 'regrowth'
            ? followUpState === 'regrowth'
            : followUpState !== 'resolved'
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: visible ? [sighting()] : [] }) })
      return
    }
    await route.continue()
  })
}

async function reachConfirmation(page: Page, context: BrowserContext) {
  await context.grantPermissions(['geolocation'])
  // This is the existing s-10 removal-reported mock fixture's public point.
  await context.setGeolocation({ latitude: 3.1483, longitude: 101.6404, accuracy: 8 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)

  await page.goto(`/sightings/${SIGHTING_ID}/follow-up`)
  await page.getByRole('button', { name: /current location/i }).click()
  await expect(page.getByText('±8 m')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'What did you find?' })).toBeVisible()
}

async function selectAndSubmit(page: Page, outcomeName: RegExp) {
  await page.getByRole('radio', { name: outcomeName }).check()
  await page.getByRole('button', { name: 'Review follow-up' }).click()
  const request = page.waitForRequest('**/api/v1/sightings/*/follow-up')
  await page.getByRole('button', { name: 'Record follow-up' }).click()
  return (await request).postDataJSON() as { outcome: string; accuracyM: number }
}

for (const scenario of [
  {
    name: 'no regrowth resolves and hides the marker from the default map',
    outcome: /No regrowth found/i,
    requestOutcome: 'no_regrowth',
    preview: /resolved and hidden/i,
    expectedPins: 0,
  },
  {
    name: 'regrowth returns an active coloured marker',
    outcome: /Regrowth present/i,
    requestOutcome: 'regrowth_present',
    preview: /return to the active map/i,
    expectedPins: 1,
  },
  {
    name: 'unable to confirm leaves the grey follow-up marker',
    outcome: /Unable to confirm/i,
    requestOutcome: 'unable_to_confirm',
    preview: /remain grey/i,
    expectedPins: 1,
  },
]) {
  test(scenario.name, async ({ page, context }) => {
    await installFollowUpFixture(page)
    await reachConfirmation(page, context)
    await page.getByRole('radio', { name: scenario.outcome }).check()
    await expect(page.getByText(scenario.preview)).toBeVisible()

    const submitted = await selectAndSubmit(page, scenario.outcome)
    expect(submitted).toMatchObject({ outcome: scenario.requestOutcome })
    expect(submitted.accuracyM).toBeLessThanOrEqual(250)
    await expect(page.getByRole('heading', { name: 'Follow-up recorded' })).toBeVisible()

    await page.getByRole('link', { name: 'Return to map' }).click()
    await expect(page).toHaveURL(/\/map$/)
    const marker = page.locator(`.map-pin[data-sighting-id="${SIGHTING_ID}"]`)
    await expect(marker).toHaveCount(scenario.expectedPins)
    if (scenario.requestOutcome === 'regrowth_present') {
      await expect(marker).toHaveAttribute('data-tier', 'spreading')
    }
    if (scenario.requestOutcome === 'unable_to_confirm') {
      await expect(marker).toHaveAttribute('data-tier', 'followup-needed')
    }
  })
}

test('a stale-location rejection clears the fix and preserves the selected outcome on Back', async ({ page, context }) => {
  await installFollowUpFixture(page, {
    status: 422,
    code: 'follow_up_location_stale',
    detail: 'Use a fresh browser location before recording a follow-up.',
  })
  await reachConfirmation(page, context)
  await page.getByRole('radio', { name: /Unable to confirm/i }).check()
  await page.getByRole('button', { name: 'Review follow-up' }).click()
  await page.getByRole('button', { name: 'Record follow-up' }).click()
  await expect(page.getByRole('heading', { name: 'Get a fresh location' })).toBeVisible()
  await page.getByRole('button', { name: 'Try location again' }).click()
  await expect(page.getByText('Not measured yet').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'What did you find?' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /Unable to confirm/i })).toBeChecked()
})

test('a concurrent state change explains why another location retry cannot help', async ({ page, context }) => {
  await installFollowUpFixture(page, {
    status: 409,
    code: 'follow_up_not_available',
    detail: 'A follow-up can only be recorded for a removal-reported sighting.',
  })
  await reachConfirmation(page, context)
  await page.getByRole('radio', { name: /No regrowth found/i }).check()
  await page.getByRole('button', { name: 'Review follow-up' }).click()
  await page.getByRole('button', { name: 'Record follow-up' }).click()
  await expect(page.getByRole('heading', { name: 'This follow-up has already been recorded' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Return to map' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try location again' })).toHaveCount(0)
})

test('after regrowth the sighting can be marked removed again and follow-up restarts', async ({ page, context }) => {
  // Real mock API end to end: s-01 is a screened sighting with a linked report.
  const id = 's-01'
  await context.grantPermissions(['geolocation'])
  await page.goto('/')
  await page.getByRole('button', { name: 'Start privately' }).first().click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
  const point = await page.evaluate(async (sightingId) => {
    const detail = await (await fetch(`/api/v1/sightings/${sightingId}`)).json() as { location: { lat: number; lng: number } }
    return detail.location
  }, id)
  await context.setGeolocation({ latitude: point.lat, longitude: point.lng, accuracy: 8 })

  // Navigate in-app only: a page reload would reset the in-memory mock state.
  const openSheet = async () => {
    await page.locator(`.map-pin[data-sighting-id="${id}"]`).click()
  }
  const markRemoved = async () => {
    await page.getByRole('button', { name: 'Mark as removed' }).click()
    await page.getByRole('button', { name: 'Confirm removal report' }).first().click()
    await expect(page.getByRole('heading', { name: 'Follow-up needed' })).toBeVisible()
  }

  await openSheet()
  await markRemoved()

  await page.getByRole('link', { name: 'Start follow-up' }).click()
  await page.getByRole('button', { name: /current location/i }).click()
  await expect(page.getByText('±8 m')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await selectAndSubmit(page, /Regrowth present/i)
  await expect(page.getByRole('heading', { name: 'Follow-up recorded' })).toBeVisible()
  await page.getByRole('link', { name: 'Return to map' }).click()

  // Returning from a follow-up restores the open sighting sheet.
  await expect(page.getByText('The marker is active on the map again.')).toBeVisible()
  await markRemoved()
  await expect(page.getByRole('link', { name: 'Start follow-up' })).toBeVisible()
})
