// Confirms the production PWA actually installs a service worker and works
// offline. Has to run against the built preview server (npm run preview), not
// the Vite dev server, because service workers don't register the same way in
// dev mode. Uses playwright.pwa.config.ts (port 4173).
import { expect, test } from '@playwright/test'

// Also checks the service worker isn't caching profile/bootstrap responses -
// those carry session-specific data, so caching them could leak one visitor's
// session details into a later visit on the same device.
test('production shell installs, works offline, and does not cache private access requests', async ({ page, context }) => {
  await page.goto('/private-access')
  await expect(page.getByRole('heading', { name: 'Field reporting without a personal account.' })).toBeVisible()

  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifest).toBeTruthy()
  const manifestResponse = await page.request.get(new URL(manifest!, page.url()).href)
  expect(manifestResponse.ok()).toBe(true)
  expect((await manifestResponse.json()).name).toBe('InvaTrace')

  await page.evaluate(async () => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  await page.evaluate(async () => {
    await fetch('/api/v1/profiles/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationToken: 'test-only' }),
    })
  })
  const cachedPrivateRequests = await page.evaluate(async () => {
    const keys = await caches.keys()
    const requests = await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()))
    return requests.flat().filter((request) => new URL(request.url).pathname.startsWith('/api/v1/profiles')).length
  })
  expect(cachedPrivateRequests).toBe(0)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Field reporting without a personal account.' })).toBeVisible()
})

test('offline catalogue uses a verified cache and keeps it when a replacement fails', async ({ page }) => {
  await page.goto('/private-access')
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('invatrace-identity', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('identity')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('identity', 'readwrite')
      transaction.objectStore('identity').put({
        schemaVersion: 2,
        installationToken: 'A'.repeat(43),
        createdAt: new Date().toISOString(),
        profileId: '00000000-0000-4000-8000-000000000001',
        recoverySetupComplete: true,
      }, 'current')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
    localStorage.setItem('invatrace-mock-adoptions-v1', JSON.stringify([{ id: 'keep-adoption' }]))
    const reportDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('invatrace', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('report-queue', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = reportDb.transaction('report-queue', 'readwrite')
      transaction.objectStore('report-queue').put({ id: 'keep-report' })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    reportDb.close()
  })
  await page.goto('/catalogue')
  await page.getByRole('button', { name: 'Download offline catalogue' }).click()
  await expect(page.getByText('Installed v2.0.0')).toBeVisible()
  const original = await page.evaluate(() => {
    const installed = JSON.parse(localStorage.getItem('invatrace.catalogue-pack.v1') ?? 'null')
    return { installed, cacheNames: [] as string[] }
  })
  original.cacheNames = await page.evaluate(() => caches.keys())
  expect(original.installed.cacheName).toContain('invatrace-catalogue-2.0.0-')
  expect(original.cacheNames).toContain(original.installed.cacheName)

  let corruptedAssetServed = false
  await page.route('**/reference-images/**', (route) => {
    if (!corruptedAssetServed) {
      corruptedAssetServed = true
      return route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        body: Buffer.alloc(original.installed.assets[0].byteLength),
      })
    }
    return route.abort('failed')
  })
  await page.getByRole('button', { name: 'Download again' }).click()
  await expect(page.getByRole('alert')).toContainText('previously installed version was kept')
  const afterFailure = await page.evaluate(async () => ({
    installed: JSON.parse(localStorage.getItem('invatrace.catalogue-pack.v1') ?? 'null'),
    cacheNames: await caches.keys(),
  }))
  expect(afterFailure.installed.cacheName).toBe(original.installed.cacheName)
  expect(afterFailure.cacheNames).toContain(original.installed.cacheName)

  await page.evaluate(async () => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await page.context().setOffline(true)
  await page.reload()
  await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
  await expect(page.locator('.catalogue-list img')).toHaveCount(0)
  const search = page.getByPlaceholder('Search scientific or common name')
  await search.fill('  GIANT SALVINIA  ')
  await expect(page.getByRole('list', { name: '1 catalogue plants' })).toBeVisible()
  await page.getByRole('link', { name: /Salvinia molesta/ }).click()
  await expect(page.getByRole('heading', { name: 'Salvinia molesta' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Safe response guidance' })).toBeVisible()
  await expect(page.getByText('No beginner-safe active action is provided')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sources and credits' })).toBeVisible()
  await expect(page.locator('.catalogue-sources a').first()).toHaveAttribute('href', /^https:/)
  await expect(page.getByText('Reference image unavailable pending reviewed attribution.')).toBeVisible()

  await page.context().setOffline(false)
  await page.goto('/catalogue')
  await page.getByRole('button', { name: 'Remove offline catalogue' }).click()
  await expect(page.getByRole('button', { name: 'Download offline catalogue' })).toBeVisible()
  const retained = await page.evaluate(async () => {
    const read = <T>(databaseName: string, storeName: string, key: IDBValidKey) => (
      new Promise<T | undefined>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction(storeName, 'readonly')
          const get = transaction.objectStore(storeName).get(key)
          get.onsuccess = () => resolve(get.result as T | undefined)
          get.onerror = () => reject(get.error)
        }
        request.onerror = () => reject(request.error)
      })
    )
    return {
      identity: await read('invatrace-identity', 'identity', 'current'),
      report: await read('invatrace', 'report-queue', 'keep-report'),
      adoptions: localStorage.getItem('invatrace-mock-adoptions-v1'),
      catalogue: localStorage.getItem('invatrace.catalogue-pack.v1'),
      catalogueCaches: (await caches.keys()).filter((name) => name.startsWith('invatrace-catalogue-')),
    }
  })
  expect(retained.identity).toBeTruthy()
  expect(retained.report).toEqual({ id: 'keep-report' })
  expect(retained.adoptions).toContain('keep-adoption')
  expect(retained.catalogue).toBeNull()
  expect(retained.catalogueCaches).toEqual([])
})
