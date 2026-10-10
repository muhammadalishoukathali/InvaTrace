// Confirms the production PWA actually installs a service worker and works
// offline. Has to run against the built preview server (npm run preview), not
// the Vite dev server, because service workers don't register the same way in
// dev mode. Uses playwright.pwa.config.ts (port 4173).
import { expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const PACK_FILES = [
  'approved-species.json',
  'catalogue-details.json',
  'plant-guidance.json',
  'plant-status.json',
  'reference-images.json',
] as const

async function updatedCataloguePack(version: string) {
  const manifest = JSON.parse(await readFile(
    new URL('../shared/catalogue/catalogue-manifest.json', import.meta.url),
    'utf8',
  ))
  manifest.catalogue_version = version
  manifest.content_version = version
  manifest.generated_at = new Date().toISOString()
  const files: Record<string, string> = {}
  for (const name of PACK_FILES) {
    const original = await readFile(new URL(`../shared/catalogue/${name}`, import.meta.url), 'utf8')
    const updated = original.replaceAll('"catalogue_version": "2.2.0"', `"catalogue_version": "${version}"`)
    files[name] = updated
    manifest.files[name].byte_length = Buffer.byteLength(updated)
    manifest.files[name].sha256 = createHash('sha256').update(updated).digest('hex')
  }
  return { manifest, files }
}

const CATALOGUE_PACK_KEY = 'invatrace.catalogue-pack.v1'

interface BundledManifest {
  catalogue_version: string
  generated_at: string
  last_reviewed: string
  files: Record<string, { sha256: string; byte_length: number }>
  assets: Array<{ species_id: string; url: string; sha256: string; byte_length: number }>
}
interface InstalledPack {
  version: string
  reviewedAt: string
  byteSize: number
  cacheName: string
  files: Record<string, { sha256: string; byteLength: number }>
  assets: Array<{ url: string; sha256: string; byteLength: number }>
}

async function bundledManifest() {
  return JSON.parse(await readFile(
    new URL('../shared/catalogue/catalogue-manifest.json', import.meta.url),
    'utf8',
  )) as BundledManifest
}

const packBytes = (manifest: BundledManifest) => (
  Object.values(manifest.files).reduce((total, file) => total + file.byte_length, 0)
  + manifest.assets.reduce((total, asset) => total + asset.byte_length, 0)
)
// Mirrors formatPackSize() in src/features/catalogue/offline-catalogue.ts.
const packSizeLabel = (bytes: number) => (
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
)
const mediumDate = (page: Page, isoDay: string) => page.evaluate(
  (value) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00Z`)),
  isoDay,
)
const installedPack = (page: Page) => page.evaluate(
  (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as InstalledPack | null,
  CATALOGUE_PACK_KEY,
)

/** A finished private-access identity, so the catalogue route renders without the mocked API. */
async function seedIdentity(page: Page) {
  await page.goto('/')
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
  })
}

async function serviceWorkerControlsPage(page: Page) {
  await page.evaluate(async () => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

// Also checks the service worker isn't caching profile/bootstrap responses -
// those carry session-specific data, so caching them could leak one visitor's
// session details into a later visit on the same device.
test('production shell installs, works offline, and does not cache private access requests', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: /Spot invasive plants/ })).toBeVisible()

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
  await expect(page.getByRole('heading', { level: 1, name: /Spot invasive plants/ })).toBeVisible()
})

// AC 5.3.2 end to end (all 32 plants offline from the installed pack), plus the
// two exact rules that need a second download to show: a failed checksum keeps
// the last valid pack (AC 5.3.1) and removal leaves identity, reports and
// adoptions alone (AC 5.3.4).
test('AC 5.3.2 Offline catalogue availability (also AC 5.3.1 failed checksum, AC 5.3.4 removal) - offline catalogue uses a verified cache and keeps it when a replacement fails', async ({ page }) => {
  await page.goto('/')
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
  await expect(page.getByText('Installed v2.2.0')).toBeVisible()

  // AC 5.3.4: a newer server manifest is downloaded and atomically installed
  // without requiring a frontend refresh. Every JSON file still has to match
  // the new manifest before the installed-pack pointer changes.
  const update = await updatedCataloguePack('2.2.1')
  await page.route('**/api/v1/offline-pack/latest', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(update.manifest),
  }))
  await page.route('**/api/v1/offline-pack/2.2.1/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    const body = update.files[name]
    return body
      ? route.fulfill({ status: 200, contentType: 'application/json', body })
      : route.fulfill({ status: 404 })
  })
  await page.reload()
  await expect(page.getByText('A newer catalogue version (2.2.1) is available.')).toBeVisible()
  await page.getByRole('button', { name: 'Update offline catalogue' }).click()
  await expect(page.getByText('Installed v2.2.1')).toBeVisible()

  const original = await page.evaluate(() => {
    const installed = JSON.parse(localStorage.getItem('invatrace.catalogue-pack.v1') ?? 'null')
    return { installed, cacheNames: [] as string[] }
  })
  original.cacheNames = await page.evaluate(() => caches.keys())
  expect(original.installed.cacheName).toContain('invatrace-catalogue-2.2.1-')
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
  await expect(page.locator('.catalogue-list img')).toHaveCount(32)
  const catalogueLinks = await page.locator('.catalogue-list a').evaluateAll((links) => (
    links.map((link) => (link as HTMLAnchorElement).getAttribute('href')).filter(Boolean)
  ))
  expect(catalogueLinks).toHaveLength(32)
  for (const href of catalogueLinks) {
    await page.goto(href!)
    await expect(page.getByRole('heading', { name: 'Identifying characteristics' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Typical habitat' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Documented impacts' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Safe response guidance' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sources and credits' })).toBeVisible()
    await expect(page.locator('.catalogue-detail__media img')).toBeVisible()
    await expect(page.locator('.catalogue-sources a').first()).toHaveAttribute('href', /^https:/)
  }
  await page.goto('/catalogue')
  await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
  const search = page.getByPlaceholder('Search scientific or common name')
  await search.fill('  GIANT SALVINIA  ')
  await expect(page.getByRole('list', { name: '1 catalogue plants' })).toBeVisible()
  await page.getByRole('link', { name: /Salvinia molesta/ }).click()
  await expect(page.getByRole('heading', { name: 'Salvinia molesta' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Safe response guidance' })).toBeVisible()
  await expect(page.getByText(/Do not move or break plants/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sources and credits' })).toBeVisible()
  await expect(page.locator('.catalogue-sources a').first()).toHaveAttribute('href', /^https:/)
  await expect(page.getByRole('img', { name: 'Reference view of Salvinia molesta' })).toBeVisible()
  await expect(page.getByText(/^Image:/)).toContainText('CC')
  await expect(page.locator('a[href*="commons.wikimedia.org"]')).toHaveCount(1)

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

test('AC 5.3.1 Offline pack installation', async ({ page }) => {
  const manifest = await bundledManifest()
  // The manifest the pack is verified against: version, generation time, the
  // file list, and a byte size and checksum for every file and image.
  expect(manifest.catalogue_version).toMatch(/^\d+\.\d+\.\d+$/)
  expect(Number.isNaN(Date.parse(manifest.generated_at))).toBe(false)
  expect(Object.keys(manifest.files).sort()).toEqual([...PACK_FILES].sort())
  expect(manifest.assets).toHaveLength(32)
  for (const entry of [...Object.values(manifest.files), ...manifest.assets]) {
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(entry.byte_length).toBeGreaterThan(0)
  }

  await seedIdentity(page)
  await page.goto('/catalogue')
  // Given: online, and nothing stored yet.
  expect(await installedPack(page)).toBeNull()
  const pack = page.locator('.catalogue-pack')
  const download = pack.getByRole('button', { name: 'Download offline catalogue' })
  await expect(download).toBeVisible()
  // The download size and version are shown before anything is fetched.
  await expect(pack.locator('strong')).toHaveText(`Offline catalogue · v${manifest.catalogue_version}`)
  await expect(pack).toContainText(`${packSizeLabel(packBytes(manifest))} · reviewed ${await mediumDate(page, manifest.last_reviewed)}`)
  await expect(pack.getByText(/^Installed v/)).toHaveCount(0)

  const imageRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/reference-images/') && url.searchParams.get('v') === manifest.catalogue_version) {
      imageRequests.push(url.pathname.replace(/\.bin$/, ''))
    }
  })
  await download.click()
  // Confirmation that it is now available offline.
  await expect(pack.getByText(`Installed v${manifest.catalogue_version}`)).toBeVisible({ timeout: 60_000 })
  await expect(download).toHaveCount(0)

  // Downloaded once: every image of the pack was fetched, and none twice.
  expect([...imageRequests].sort()).toEqual(manifest.assets.map((asset) => asset.url).sort())

  // Verified: what is stored matches the manifest's checksums, byte for byte.
  const installed = (await installedPack(page))!
  expect(installed.version).toBe(manifest.catalogue_version)
  expect(installed.byteSize).toBe(packBytes(manifest))
  expect(Object.keys(installed.files).sort()).toEqual([...PACK_FILES].sort())
  for (const name of PACK_FILES) {
    expect(installed.files[name]).toEqual({ sha256: manifest.files[name].sha256, byteLength: manifest.files[name].byte_length })
  }
  const stored = await page.evaluate(async ({ cacheName, version, files, assets }) => {
    const cache = await caches.open(cacheName)
    const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('')
    const entry = async (key: string) => {
      const response = await cache.match(key)
      if (!response) return null
      const bytes = await response.arrayBuffer()
      return { sha256: await digest(bytes), byteLength: bytes.byteLength }
    }
    return {
      keys: (await cache.keys()).length,
      files: await Promise.all(files.map((name) => entry(`/offline-catalogue/${version}/${name}`))),
      assets: await Promise.all(assets.map((url) => entry(url))),
    }
  }, {
    cacheName: installed.cacheName,
    version: manifest.catalogue_version,
    files: [...PACK_FILES],
    assets: manifest.assets.map((asset) => asset.url),
  })
  expect(stored.keys).toBe(PACK_FILES.length + manifest.assets.length)
  expect(stored.files).toEqual(PACK_FILES.map((name) => ({ sha256: manifest.files[name].sha256, byteLength: manifest.files[name].byte_length })))
  expect(stored.assets).toEqual(manifest.assets.map((asset) => ({ sha256: asset.sha256, byteLength: asset.byte_length })))

  // The pack survives a reload as the installed one.
  await page.reload()
  await expect(pack.getByText(`Installed v${manifest.catalogue_version}`)).toBeVisible()
})

test('AC 5.3.3 Offline state communication', async ({ page, context }) => {
  const manifest = await bundledManifest()
  await seedIdentity(page)
  await page.goto('/catalogue')
  await page.getByRole('button', { name: 'Download offline catalogue' }).click()
  await expect(page.getByText(`Installed v${manifest.catalogue_version}`)).toBeVisible({ timeout: 60_000 })
  // Online: no offline banner.
  await expect(page.locator('.catalogue-offline-notice')).toHaveCount(0)

  await serviceWorkerControlsPage(page)
  // setOffline() cuts the network but leaves navigator.onLine reporting true in
  // this Chromium, and that flag is what the app reads. A device with no
  // network reports false, so both halves are applied for the reopened app.
  await context.setOffline(true)
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false })
  })
  await page.reload()
  expect(await page.evaluate(() => navigator.onLine)).toBe(false)

  // "Offline catalogue" with the installed version and the last-reviewed date.
  const notice = page.locator('.catalogue-offline-notice')
  await expect(notice.locator('strong')).toHaveText('Offline catalogue')
  await expect(notice).toContainText(
    `Installed v${manifest.catalogue_version} · last reviewed ${await mediumDate(page, manifest.last_reviewed)}.`,
  )
  // Cached catalogue content stays available behind the message.
  await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
  await page.getByRole('link', { name: /Mikania micrantha/ }).click()
  const detailNotice = page.locator('.catalogue-detail .catalogue-offline-notice')
  await expect(detailNotice).toContainText(`Offline catalogue · v${manifest.catalogue_version}`)
  await expect(detailNotice).toContainText(`Last reviewed ${manifest.last_reviewed}.`)
  await expect(page.getByRole('heading', { name: 'Identifying characteristics' })).toBeVisible()

  // A feature that needs current server data shows an offline message instead
  // of a spinner, and leads back to the cached catalogue.
  await page.goto('/places')
  await expect(page.locator('.places-state')).toContainText(
    'Mapped places and current association data need a connection. The offline plant catalogue remains available.',
  )
  await expect(page.getByText('Loading mapped places…')).toHaveCount(0)
  await page.goto('/adopted-areas')
  await expect(page.locator('.areas-state')).toContainText('Adopted-area activity needs a connection.')
  await page.getByRole('link', { name: 'Open offline catalogue' }).click()
  await expect(page).toHaveURL(/\/catalogue$/)
  await expect(page.getByRole('list', { name: '32 catalogue plants' })).toBeVisible()
  await expect(page.locator('.catalogue-offline-notice strong')).toHaveText('Offline catalogue')
})

test('AC 5.3.4 Offline storage management', async ({ page }) => {
  const manifest = await bundledManifest()
  await seedIdentity(page)
  // Things removal must leave alone: a saved report and an adopted area.
  await page.evaluate(async () => {
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
  const pack = page.locator('.catalogue-pack')
  await pack.getByRole('button', { name: 'Download offline catalogue' }).click()
  await expect(pack.getByText(`Installed v${manifest.catalogue_version}`)).toBeVisible({ timeout: 60_000 })

  // The stored version and size, and both management actions.
  const first = (await installedPack(page))!
  expect(first.version).toBe(manifest.catalogue_version)
  await expect(pack).toContainText(`Installed v${first.version}`)
  await expect(pack).toContainText(packSizeLabel(first.byteSize))
  const remove = pack.getByRole('button', { name: 'Remove offline catalogue' })
  const again = pack.getByRole('button', { name: 'Download again' })
  await expect(remove).toBeEnabled()
  await expect(again).toBeEnabled()

  // Download again: a fresh verified copy replaces the old one.
  await again.click()
  await expect.poll(async () => (await installedPack(page))?.cacheName, { timeout: 60_000 }).not.toBe(first.cacheName)
  await expect(pack.getByText(`Installed v${manifest.catalogue_version}`)).toBeVisible()
  const second = (await installedPack(page))!
  expect(await page.evaluate(() => caches.keys().then((names) => names.filter((name) => name.startsWith('invatrace-catalogue-')))))
    .toEqual([second.cacheName])

  // Remove: the catalogue assets go...
  await remove.click()
  await expect(pack.getByRole('button', { name: 'Download offline catalogue' })).toBeVisible()
  await expect(pack.getByText(/^Installed v/)).toHaveCount(0)
  const after = await page.evaluate(async (key) => {
    const read = <T>(databaseName: string, storeName: string, id: IDBValidKey) => (
      new Promise<T | undefined>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1)
        request.onsuccess = () => {
          const get = request.result.transaction(storeName, 'readonly').objectStore(storeName).get(id)
          get.onsuccess = () => resolve(get.result as T | undefined)
          get.onerror = () => reject(get.error)
        }
        request.onerror = () => reject(request.error)
      })
    )
    return {
      pack: localStorage.getItem(key),
      catalogueCaches: (await caches.keys()).filter((name) => name.startsWith('invatrace-catalogue-')),
      identity: await read<{ profileId: string }>('invatrace-identity', 'identity', 'current'),
      report: await read('invatrace', 'report-queue', 'keep-report'),
      adoptions: localStorage.getItem('invatrace-mock-adoptions-v1'),
    }
  }, CATALOGUE_PACK_KEY)
  expect(after.pack).toBeNull()
  expect(after.catalogueCaches).toEqual([])
  // ...and the anonymous identity, saved reports and adopted areas stay.
  expect(after.identity?.profileId).toBe('00000000-0000-4000-8000-000000000001')
  expect(after.report).toEqual({ id: 'keep-report' })
  expect(after.adoptions).toBe(JSON.stringify([{ id: 'keep-adoption' }]))
})
