import { expect, test, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs/promises'

interface LayoutFinding { screen: string; overflow: string[]; smallTargets: string[] }

async function navigate(page: Page, destination: string) {
  await page.evaluate(async destination => {
    const modulePath = '/src/app/router.tsx'
    const { router } = await import(modulePath)
    await router.navigate(destination)
  }, destination)
  await expect(page.locator('.route-loading')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
}

async function inspect(page: Page, info: TestInfo, screen: string, findings: LayoutFinding[]) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => undefined)))
  })
  const metrics = await page.evaluate(() => {
    const overflow: string[] = [], smallTargets: string[] = []
    const visible = (el: Element) => {
      const style = getComputedStyle(el), box = el.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0 && box.width > 0 && box.height > 0
        && !el.closest('.sr-only, [aria-hidden="true"], [inert]')
    }
    for (const el of document.querySelectorAll('main, section, article, form, fieldset, input, select, textarea, button, a, [role="dialog"]')) {
      if (!visible(el)) continue
      const box = el.getBoundingClientRect()
      const label = `${el.tagName.toLowerCase()}.${typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : ''}: ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 75)}`
      if (!el.closest('.maplibregl-canvas-container, .maplibregl-marker, .maplibregl-ctrl-attrib')) {
        if (box.right > innerWidth + 1 || box.left < -1) overflow.push(label)
        // Check inner scrolling containers too: document width alone misses clipped grids.
        if (!el.matches('main:has(.maplibregl-map)') && el.clientWidth && el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== 'auto'
          && getComputedStyle(el).textOverflow !== 'ellipsis' && !el.matches('input, textarea, select')) overflow.push(`inner ${label}`)
      }
      if (el.matches('button, select, input:not([type="checkbox"]):not([type="radio"]):not([type="file"])') && !el.closest('.maplibregl-marker, .maplibregl-ctrl-attrib')
        && (box.width < 43 || box.height < 43)) smallTargets.push(label)
    }
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog && visible(dialog)) {
      const box = dialog.getBoundingClientRect()
      if (box.top < -1 || box.bottom > innerHeight + 1) overflow.push('Dialog extends beyond the viewport height')
    }
    return { overflow: [...new Set(overflow)], smallTargets: [...new Set(smallTargets)] }
  })
  findings.push({ screen, ...metrics })
  await fs.writeFile(info.outputPath('layout-findings.json'), JSON.stringify(findings, null, 2))
  await page.screenshot({ path: info.outputPath(`${screen}.png`), mask: [page.locator('.recovery-card__value, .recovery-code-grid code')] })
}

test('every route and workflow state fits the screen', async ({ page, context }, info) => {
  const findings: LayoutFinding[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 3.1483, longitude: 101.6404, accuracy: 8 })
  await page.goto('/private-access')
  await expect(page.getByRole('button', { name: 'Start privately' })).toBeVisible()
  await inspect(page, info, '01-private-access', findings)
  await page.getByRole('link', { name: 'Restore existing access' }).click()
  await inspect(page, info, '02-restore', findings)
  await page.getByRole('link', { name: 'Private access', exact: true }).click()
  await page.getByRole('button', { name: 'Start privately' }).click()
  await expect(page.getByRole('heading', { name: 'Save your recovery kit' })).toBeVisible()
  // Recovery codes are secrets; mask the test kit in saved visual evidence.
  await inspect(page, info, '03-recovery-layout', findings)
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
  await page.evaluate(async () => {
    const modulePath = '/e2e/fixtures/responsive-api.ts'
    const { install } = await import(modulePath)
    install()
  })

  await expect(page.locator('.map-pin').first()).toBeVisible()
  await inspect(page, info, '04-map', findings)
  await page.getByRole('button', { name: 'Show map legend' }).click()
  await inspect(page, info, '05-map-legend', findings)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Open reports list/ }).click()
  await inspect(page, info, '06-map-reports', findings)
  await page.getByRole('button', { name: 'Close community reports list' }).click()
  await page.locator('.map-pin').first().click({ force: true })
  await expect(page.getByRole('button', { name: /Close sighting/ })).toBeVisible()
  await inspect(page, info, '07-sighting-details', findings)
  await page.keyboard.press('Escape')

  for (const [screen, route, selector] of [
    ['08-profile', '/profile', '.access-management'],
    ['09-records', '/reports', '.my-reports__results'],
    ['10-report-details', '/reports/layout-report', '.report-tracking__meta'],
    ['11-catalogue', '/catalogue', '.catalogue-list'],
    ['12-plant-details', '/catalogue/mikania-micrantha', '.catalogue-detail__body'],
    ['13-places', '/places', '.places-list'],
    ['14-place-details', '/places/10000000-0000-4000-8000-000000000001', '.place-associations'],
    ['15-monitoring-empty', '/adopted-areas', '.areas-state'],
    ['16-events', '/events', '.events-list'],
    ['17-hosted-events', '/events/mine', '.events-list'],
    ['18-event-details', '/events/layout-event', '.event-action-card'],
    ['19-event-check-in', '/events/layout-event/check-in', '.event-steps'],
    ['20-event-tasks', '/events/layout-event/tasks', '.event-task'],
    ['21-event-summary', '/events/layout-event/summary', '.event-stats'],
    ['22-event-edit', '/events/layout-event/edit', '.event-field'],
    ['23-scan', '/scan', '.scan-capture'],
  ]) {
    await navigate(page, route)
    await expect(page.locator(selector).first()).toBeVisible()
    await inspect(page, info, screen, findings)
  }

  await navigate(page, '/profile')
  await page.getByRole('button', { name: /Edit display name/ }).click()
  await inspect(page, info, '24-profile-dialog', findings)
  await page.keyboard.press('Escape')
  await navigate(page, '/events/layout-event')
  // The fixture initially represents the host; use a test-only viewer override for the safety dialog.
  await page.evaluate(async () => {
    const modulePath = '/src/services/query-client.ts'
    const { queryClient } = await import(modulePath)
    queryClient.setQueryData(['event', 'layout-event'], (item: Record<string, unknown>) => ({ ...item, isHost: false }))
  })
  await page.getByRole('button', { name: 'Report this event' }).click()
  await inspect(page, info, '25-event-dialog', findings)
  await page.keyboard.press('Escape')

  await navigate(page, '/places/10000000-0000-4000-8000-000000000001')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Adopt for monitoring' }).click()
  await expect(page.getByRole('button', { name: 'Adopted for monitoring' })).toBeVisible()
  await navigate(page, '/adopted-areas')
  await expect(page.locator('.areas-list')).toBeVisible()
  await inspect(page, info, '26-monitoring-areas', findings)
  await page.getByRole('link', { name: 'Open activity map' }).click()
  await expect(page.locator('.activity-facts')).toBeVisible()
  await inspect(page, info, '27-area-activity', findings)

  // Epic 7 guided mission: place entry, preview and the active mission map.
  const missionPlace = 'e56ae54c-ca04-5fbf-b2c2-01b6e7fbdf46'
  await page.evaluate(() => localStorage.removeItem('invatrace-mock-missions-v1'))
  await navigate(page, `/places/${missionPlace}`)
  await expect(page.getByRole('link', { name: 'Start guided mission' })).toBeVisible()
  await inspect(page, info, '27a-mission-entry', findings)
  await navigate(page, `/places/${missionPlace}/mission`)
  await expect(page.getByRole('button', { name: 'Start guided mission' })).toBeVisible()
  await inspect(page, info, '27b-mission-preview', findings)
  await page.getByRole('button', { name: 'Start guided mission' }).click()
  await expect(page.getByLabel('Map legend')).toBeVisible()
  await inspect(page, info, '27c-mission-active', findings)
  await page.getByLabel('Habitats on the map').getByRole('button').first().click()
  await inspect(page, info, '27d-mission-habitat', findings)

  await navigate(page, '/events/host')
  for (let step = 1; step <= 4; step++) {
    await expect(page.getByRole('heading', { name: new RegExp(`^Step ${step} of 4`) })).toBeVisible()
    await inspect(page, info, `28-host-step-${step}`, findings)
    if (step === 1) { await page.getByLabel('Event title').fill('Community survey'); await page.getByRole('textbox', { name: /^Purpose/ }).fill('Record field observations.') }
    if (step === 2) { await page.getByLabel('Mapped place').fill('Bukit'); await page.getByRole('button', { name: /Bukit Kiara/ }).click() }
    if (step === 3) { await page.getByLabel('Starts', { exact: true }).fill('2030-01-01T08:00'); await page.getByLabel('Ends', { exact: true }).fill('2030-01-01T10:00') }
    if (step < 4) await page.getByRole('button', { name: 'Continue', exact: true }).click()
  }

  await navigate(page, '/sightings/s-10/follow-up')
  await inspect(page, info, '29-follow-up-location', findings)
  await page.getByRole('button', { name: 'Use my current location' }).click()
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
  await page.getByRole('button', { name: 'Continue' }).click()
  await inspect(page, info, '30-follow-up-outcome', findings)
  await page.getByRole('radio', { name: /Unable to confirm/ }).check()
  await page.getByRole('button', { name: 'Review follow-up' }).click()
  await inspect(page, info, '31-follow-up-confirm', findings)
  await page.getByRole('button', { name: 'Record follow-up' }).click()
  await expect(page.getByRole('heading', { name: 'Follow-up recorded' })).toBeVisible()
  await inspect(page, info, '32-follow-up-done', findings)
  await navigate(page, '/sightings/s-10/follow-up/error')
  await inspect(page, info, '33-follow-up-error', findings)

  await page.evaluate(async () => {
    const scanPath = '/src/features/scan/scan-store.ts', fixturePath = '/e2e/fixtures/responsive-api.ts', apiPath = '/src/services/api-client.ts'
    const { useScan } = await import(scanPath), { report } = await import(fixturePath), { api } = await import(apiPath)
    const blob = await (await fetch('/reference-images/mikania_micrantha.jpg')).blob()
    const speciesDetail = await api('/api/v1/species/mikania-micrantha')
    useScan.setState({ step: 'result', result: { outcome: 'target', confidence: 0.92, speciesId: 'mikania-micrantha', speciesName: 'Mile-a-minute weed', scientificName: 'Mikania micrantha', reportable: true, modelVersion: report.submission.modelVersion, serverAccepted: true }, speciesDetail,
      imageBlob: blob, imageUrl: URL.createObjectURL(blob), captureId: 'layout-capture', captureSource: 'gallery', observedAt: new Date().toISOString(), scanPersistStatus: 'ok', location: { point: report.submission.location, accuracyM: 8, capturedAt: new Date().toISOString() } })
  })
  await navigate(page, '/scan/result')
  await inspect(page, info, '34-scan-result', findings)
  await page.getByRole('button', { name: 'Report sighting', exact: true }).click()
  await expect(page).toHaveURL(/\/report$/)
  for (const [step, screen] of ['location', 'extent', 'consent', 'preview'].entries()) {
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(step + 1))
    await inspect(page, info, `35-report-${screen}`, findings)
    if (step === 0) await page.getByRole('button', { name: 'Continue', exact: true }).click()
    if (step === 1) { await page.locator('.radio-card').filter({ hasText: 'Single plant' }).click(); await expect(page.getByRole('radio', { name: /Single plant/ })).toBeChecked(); await page.getByRole('button', { name: 'Continue', exact: true }).click() }
    if (step === 2) { await page.getByRole('checkbox').nth(0).check(); await page.getByRole('checkbox').nth(1).check(); await page.getByRole('button', { name: 'Review submission' }).click() }
  }
  await page.evaluate(async () => {
    const storePath = '/src/features/report/report-draft-store.ts', fixturePath = '/e2e/fixtures/responsive-api.ts'
    const { useReportDraft } = await import(storePath), { report } = await import(fixturePath)
    useReportDraft.getState().setOutcome({ kind: 'submitted', report })
  })
  await inspect(page, info, '36-report-published', findings)
  await page.evaluate(async () => {
    const storePath = '/src/features/report/report-draft-store.ts'
    const { useReportDraft } = await import(storePath)
    useReportDraft.getState().setOutcome({ kind: 'queued', queuedId: 'layout-queue', error: 'offline' })
  })
  await inspect(page, info, '37-report-queued', findings)

  // Inspect every catalogue record, including long scientific and common names.
  await navigate(page, '/catalogue')
  const speciesRoutes = await page.locator('.catalogue-list a').evaluateAll(links => links.map(link => link.getAttribute('href')!))
  for (const route of speciesRoutes) {
    await navigate(page, route)
    await expect(page.locator('.catalogue-detail__body')).toBeVisible()
    const width = await page.evaluate(() => document.querySelector('main')!.scrollWidth - document.querySelector('main')!.clientWidth)
    expect.soft(width, `${route} horizontal overflow`).toBeLessThanOrEqual(1)
  }

  await fs.writeFile(info.outputPath('layout-findings.json'), JSON.stringify(findings, null, 2))
  await info.attach('layout findings', { path: info.outputPath('layout-findings.json'), contentType: 'application/json' })
  expect(errors, 'uncaught application errors').toEqual([])
  expect.soft(findings.filter(item => item.overflow.length), 'overflow by screen').toEqual([])
  expect.soft(findings.filter(item => item.smallTargets.length), 'undersized controls by screen').toEqual([])
})

test('empty, failed, queued and offline states remain usable', async ({ page, context }, info) => {
  const findings: LayoutFinding[] = []
  await page.goto('/private-access')
  await page.getByRole('button', { name: 'Start privately' }).click()
  await page.getByRole('checkbox', { name: 'I have saved my recovery kit' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
  await page.evaluate(async () => {
    const fixturePath = '/e2e/fixtures/responsive-api.ts', queryPath = '/src/services/query-client.ts'
    const { install, fixture } = await import(fixturePath), { queryClient } = await import(queryPath)
    install(); fixture.empty = true
    queryClient.setDefaultOptions({ queries: { retry: false } })
  })
  for (const route of ['/reports', '/events', '/events/mine']) {
    await navigate(page, route)
    await expect(page.locator('.my-reports__empty, .events-empty').first()).toBeVisible()
    await inspect(page, info, `empty-${route.replaceAll('/', '-')}`, findings)
  }
  await navigate(page, '/catalogue')
  await page.getByPlaceholder('Search scientific or common name').fill('no matching plant name')
  await expect(page.locator('.catalogue-empty')).toBeVisible()
  await inspect(page, info, 'empty-catalogue-search', findings)

  for (const status of ['processing', 'merged', 'needs_rescan', 'rejected', 'validation_unavailable']) {
    await navigate(page, '/map')
    await page.evaluate(async status => {
      const fixturePath = '/e2e/fixtures/responsive-api.ts', queryPath = '/src/services/query-client.ts'
      const { fixture } = await import(fixturePath), { queryClient } = await import(queryPath)
      fixture.status = status; queryClient.removeQueries({ queryKey: ['report'] })
    }, status)
    await navigate(page, '/reports/layout-report')
    await expect(page.locator('.report-tracking__meta')).toBeVisible()
    await inspect(page, info, `report-${status}`, findings)
  }

  // Seed only this browser context's queue, with retries disabled so the
  // layout check cannot upload it or discard any saved evidence.
  await page.evaluate(async () => {
    const profilePath = '/src/features/private-access/private-access-store.ts', fixturePath = '/e2e/fixtures/responsive-api.ts'
    const { usePrivateAccess } = await import(profilePath), { report } = await import(fixturePath)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('invatrace', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('report-queue', { keyPath: 'id' })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction('report-queue', 'readwrite')
        transaction.objectStore('report-queue').put({ id: 'layout-queue', ownerProfileId: usePrivateAccess.getState().profile.id,
          createdAt: new Date().toISOString(), attempts: 2, retryable: false, imageBlob: new Blob(['test photo']),
          lastError: 'The event upload period has ended. The saved photo is retained.', lastErrorCode: 'upload_grace_exceeded',
          submission: { ...report.submission, eventId: 'layout-event', capturedAt: report.submission.observedAt } })
        transaction.oncomplete = () => { db.close(); resolve() }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  })
  await navigate(page, '/catalogue')
  await page.reload()
  await page.getByRole('button', { name: 'View queue', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Queued reports' })).toBeVisible()
  await inspect(page, info, 'queue-correction-dialog', findings)
  await page.keyboard.press('Escape')

  // Development has no service worker; load these route modules before
  // disconnecting. Production chunk caching is covered by pwa.spec.ts.
  for (const route of ['/reports', '/places', '/adopted-areas', '/catalogue']) await navigate(page, route)
  await context.setOffline(true)
  for (const route of ['/reports', '/places', '/adopted-areas', '/catalogue']) {
    await navigate(page, route)
    await expect(page.getByText("You're offline. New reports will be saved and sent when you reconnect.")).toBeVisible()
    await inspect(page, info, `offline-${route.slice(1)}`, findings)
  }
  await context.setOffline(false)
  await page.evaluate(async () => {
    const fixturePath = '/e2e/fixtures/responsive-api.ts', queryPath = '/src/services/query-client.ts'
    const { installErrors } = await import(fixturePath), { queryClient } = await import(queryPath)
    installErrors(); queryClient.setDefaultOptions({ queries: { retry: false } }); queryClient.clear()
  })
  for (const route of ['/reports', '/reports/layout-report', '/places', '/places/10000000-0000-4000-8000-000000000001', '/adopted-areas', '/adopted-areas/layout-area/activity', '/events', '/events/layout-event']) {
    await navigate(page, route)
    await expect(page.getByRole('alert').first()).toBeVisible()
    await inspect(page, info, `failed-${route.replaceAll('/', '-')}`, findings)
  }
  await info.attach('state layout findings', { path: info.outputPath('layout-findings.json'), contentType: 'application/json' })
  expect.soft(findings.filter(item => item.overflow.length), 'overflow in alternate states').toEqual([])
  expect.soft(findings.filter(item => item.smallTargets.length), 'undersized alternate-state controls').toEqual([])
})
