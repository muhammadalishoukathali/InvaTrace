// Downloads and manages the offline catalogue pack - the thing that makes the
// catalogue usable with no connection.
//
// A pack is a versioned set of JSON files plus reference images, listed in a
// manifest with a SHA-256 per file. Downloading verifies every hash before the
// pack counts as installed, so a half-finished download on a flaky connection
// can't leave the catalogue showing a mix of two versions.
//
// The files go into the Cache API rather than IndexedDB because they are plain
// HTTP responses and the service worker can serve them back directly. Only the
// small bookkeeping record (version, size, install date) goes in localStorage,
// under STORAGE_KEY.
import approvedRaw from '@shared/catalogue/approved-species.json?raw'
import catalogueDetailsRaw from '@shared/catalogue/catalogue-details.json?raw'
import guidanceRaw from '@shared/catalogue/plant-guidance.json?raw'
import statusRaw from '@shared/catalogue/plant-status.json?raw'
import referenceImagesRaw from '@shared/catalogue/reference-images.json?raw'
import {
  catalogueManifest,
  type ApprovedCatalogueAsset,
  type CatalogueAsset,
  type CatalogueManifest,
  type ApprovedSpeciesDataset,
  type CatalogueDetailsDataset,
  isApprovedCatalogueAsset,
} from '@shared/catalogue'
import { apiUrl } from '@/services/api-client'

const STORAGE_KEY = 'invatrace.catalogue-pack.v1'
const CACHE_PREFIX = 'invatrace-catalogue-'

export interface InstalledCataloguePack {
  version: string
  installedAt: string
  reviewedAt: string
  byteSize: number
  cacheName?: string
  files?: Record<string, { sha256: string; byteLength: number }>
  assets?: Array<CatalogueAsset & { byteLength: number }>
}

export interface OfflineCatalogueData {
  approved: ApprovedSpeciesDataset
  details: CatalogueDetailsDataset
  guidance: { plants: Array<Record<string, unknown>> }
  assetUrls: Record<string, string>
  approvedImages: Record<string, ApprovedCatalogueAsset>
  release: () => void
}

const rawFiles: Record<string, string> = {
  'approved-species.json': approvedRaw,
  'catalogue-details.json': catalogueDetailsRaw,
  'plant-guidance.json': guidanceRaw,
  'plant-status.json': statusRaw,
  'reference-images.json': referenceImagesRaw,
}

export function cataloguePackSize(manifest: CatalogueManifest = catalogueManifest): number {
  const files = Object.values(manifest.files)
    .reduce((total, file) => total + file.byte_length, 0)
  return files + manifest.assets.reduce((total, asset) => total + asset.byte_length, 0)
}

export function installedCataloguePack(): InstalledCataloguePack | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as InstalledCataloguePack | null
    return parsed?.version ? parsed : null
  } catch {
    return null
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Bytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const PACK_FILE_NAMES = Object.keys(rawFiles) as Array<keyof CatalogueManifest['files']>
const SHA256 = /^[0-9a-f]{64}$/

export function isCatalogueManifest(value: unknown): value is CatalogueManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<CatalogueManifest>
  if (
    manifest.schema_version !== 'invatrace.catalogue.manifest.v2'
    || typeof manifest.catalogue_version !== 'string'
    || typeof manifest.last_reviewed !== 'string'
    || !manifest.files
    || !Array.isArray(manifest.assets)
    || manifest.assets.length !== 32
  ) return false
  if (!PACK_FILE_NAMES.every((name) => {
    const file = manifest.files?.[name]
    return Boolean(
      file
      && Number.isInteger(file.byte_length)
      && file.byte_length > 0
      && SHA256.test(file.sha256),
    )
  })) return false
  return manifest.assets.every((asset) => (
    asset.review_status === 'approved'
    && asset.url.startsWith('/reference-images/')
    && !asset.url.includes('..')
    && Number.isInteger(asset.byte_length)
    && asset.byte_length > 0
    && SHA256.test(asset.sha256)
  ))
}

export async function fetchLatestCatalogueManifest(): Promise<CatalogueManifest> {
  const response = await fetch(apiUrl('/api/v1/offline-pack/latest'), {
    cache: 'no-store',
    credentials: 'omit',
  })
  if (!response.ok) throw new Error('Catalogue manifest download failed.')
  const manifest: unknown = await response.json()
  if (!isCatalogueManifest(manifest)) throw new Error('Catalogue manifest validation failed.')
  return manifest
}

async function verifiedPackFiles(manifest: CatalogueManifest): Promise<Record<string, string>> {
  const bundled = manifest.catalogue_version === catalogueManifest.catalogue_version
    && PACK_FILE_NAMES.every((name) => (
      manifest.files[name].sha256 === catalogueManifest.files[name].sha256
      && manifest.files[name].byte_length === catalogueManifest.files[name].byte_length
    ))
  const verified: Record<string, string> = {}
  for (const name of PACK_FILE_NAMES) {
    const expected = manifest.files[name]
    let bytes: ArrayBuffer
    if (bundled) {
      bytes = new TextEncoder().encode(rawFiles[name]).buffer as ArrayBuffer
    } else {
      const response = await fetch(
        apiUrl(`/api/v1/offline-pack/${encodeURIComponent(manifest.catalogue_version)}/${name}`),
        { cache: 'no-store', credentials: 'omit' },
      )
      if (!response.ok) throw new Error(`Catalogue file download failed for ${name}.`)
      bytes = await response.arrayBuffer()
    }
    if (bytes.byteLength !== expected.byte_length) {
      throw new Error(`Catalogue file size check failed for ${name}.`)
    }
    if (await sha256Bytes(bytes) !== expected.sha256) {
      throw new Error(`Catalogue checksum check failed for ${name}.`)
    }
    const raw = new TextDecoder().decode(bytes)
    JSON.parse(raw)
    verified[name] = raw
  }
  return verified
}

// Fetch one reference image, trying the routes that survive a CDN in order and
// stopping at the first whose bytes match the manifest.
//
//  1. <name>.jpg.bin - a byte-identical copy published by
//     scripts/publish-pack-assets.mjs as application/octet-stream. Cloudflare
//     Polish only rewrites what it recognises as an image, so this is the one
//     route it leaves alone. It is also the only route that stays correct once
//     the object is cached at the edge: Polish re-encodes images *after* they
//     land there, `no-transform` and all.
//  2. The image itself, for dev servers and hosts with no postbuild step.
//  3. The image under a one-off nonce. An edge that already holds a
//     transformed copy serves it to every request for that URL; a URL it has
//     never seen forces a fetch from origin. This is what rescues a browser
//     running an older bundle, or a host where route 1 is missing.
//
// A route that answers but fails its hash is not fatal here - the caller
// re-checks and reports - so a stale service worker or an SPA rewrite handing
// back index.html just moves us to the next route instead of failing the whole
// download.
async function downloadAssetBytes(
  asset: CatalogueAsset & { byte_length: number },
  catalogueVersion: string,
): Promise<{ bytes: ArrayBuffer; response: Response }> {
  const separator = asset.url.includes('?') ? '&' : '?'
  const version = `${separator}v=${encodeURIComponent(catalogueVersion)}`
  const routes = [
    { url: `${asset.url}.bin${version}`, init: { cache: 'no-store' as RequestCache } },
    {
      url: `${asset.url}${version}`,
      init: { cache: 'no-store' as RequestCache, headers: { Accept: 'image/jpeg' } },
    },
    {
      url: `${asset.url}${version}&n=${crypto.randomUUID()}`,
      init: { cache: 'no-store' as RequestCache, headers: { Accept: 'image/jpeg' } },
    },
  ]
  let last: { bytes: ArrayBuffer; response: Response } | null = null
  for (const route of routes) {
    let response: Response
    try {
      response = await fetch(route.url, route.init)
    } catch {
      continue
    }
    if (!response.ok) continue
    const bytes = await response.arrayBuffer()
    last = { bytes, response }
    if (bytes.byteLength === asset.byte_length && await sha256Bytes(bytes) === asset.sha256) {
      return last
    }
  }
  if (!last) throw new Error(`Catalogue asset download failed for ${asset.url}.`)
  // Every route answered with the wrong bytes. Hand back the last attempt so
  // the caller's error can name what the network is actually serving.
  return last
}

export async function downloadCataloguePack(
  manifest: CatalogueManifest = catalogueManifest,
): Promise<InstalledCataloguePack> {
  if (!('caches' in window) || !crypto.subtle) {
    throw new Error('Offline catalogue storage is not supported by this browser.')
  }
  if (!isCatalogueManifest(manifest)) throw new Error('Catalogue manifest validation failed.')
  const verifiedFiles = await verifiedPackFiles(manifest)
  // Build the complete pack under a fresh cache name. The installed pointer is
  // switched only after every file passes integrity validation, so a failed
  // update or same-version re-download cannot damage the last valid pack.
  const cacheName = `${CACHE_PREFIX}${manifest.catalogue_version}-${crypto.randomUUID()}`
  const cache = await caches.open(cacheName)
  try {
    await Promise.all(Object.entries(verifiedFiles).map(([name, raw]) => cache.put(
      new Request(`/offline-catalogue/${manifest.catalogue_version}/${name}`),
      new Response(raw, { headers: { 'Content-Type': 'application/json' } }),
    )))
    for (const asset of manifest.assets) {
      // Ask for the published bytes rather than whatever the CDN would rather
      // send. A cache/proxy layer that re-encodes images (Cloudflare Polish
      // converting JPEG to WebP, say) fails the hash below every single time,
      // so the narrow Accept header is the client half of the no-transform
      // cache headers the static hosts set on /reference-images/*.
      //
      // The version query is the other half. no-transform stops *new* edge
      // copies being re-encoded, but copies cached before it was set survive:
      // they are keyed by the old `Vary: accept`, and each revalidation
      // refreshes the transformed body instead of replacing it, so a stale
      // WebP can outlive its TTL indefinitely. Requesting a URL the edge has
      // never seen sidesteps every one of those entries, and re-busts by
      // itself whenever the catalogue version moves.
      const { bytes, response } = await downloadAssetBytes(asset, manifest.catalogue_version)
      if (bytes.byteLength !== asset.byte_length || await sha256Bytes(bytes) !== asset.sha256) {
        // Name what actually arrived. A plain "integrity check failed" sent us
        // hunting for a corrupted upload when the real answer was a CDN
        // handing back a re-encoded image of a different type and size.
        const contentType = response.headers.get('Content-Type') ?? 'unknown type'
        throw new Error(
          `Catalogue asset integrity check failed for ${asset.url}:`
          + ` the server returned ${bytes.byteLength} bytes of ${contentType},`
          + ` but the manifest lists ${asset.byte_length} bytes.`,
        )
      }
      // Always image/jpeg, never the response's own type: the pack copy
      // arrives as application/octet-stream, and these bytes are handed
      // straight to <img> as a blob URL when the catalogue renders offline.
      // They are verified JPEG bytes either way - the hash above says so.
      await cache.put(new Request(asset.url), new Response(bytes, {
        headers: { 'Content-Type': 'image/jpeg' },
      }))
    }
  } catch (error) {
    await caches.delete(cacheName)
    throw error
  }
  const installed: InstalledCataloguePack = {
    version: manifest.catalogue_version,
    installedAt: new Date().toISOString(),
    reviewedAt: manifest.last_reviewed,
    byteSize: cataloguePackSize(manifest),
    cacheName,
    files: Object.fromEntries(Object.entries(manifest.files).map(([name, file]) => [
      name,
      { sha256: file.sha256, byteLength: file.byte_length },
    ])),
    assets: manifest.assets.map((asset) => ({
      ...asset,
      url: asset.url,
      sha256: asset.sha256,
      byteLength: asset.byte_length,
    })),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(installed))
  } catch (error) {
    await caches.delete(cacheName)
    throw error
  }
  const keys = await caches.keys()
  await Promise.all(
    keys
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== cacheName)
      .map((name) => caches.delete(name)),
  )
  return installed
}

export async function loadInstalledCatalogueData(): Promise<OfflineCatalogueData | null> {
  const installed = installedCataloguePack()
  if (!installed || !('caches' in window) || !crypto.subtle) return null
  const cacheName = installed.cacheName ?? `${CACHE_PREFIX}${installed.version}`
  const cache = await caches.open(cacheName)
  const loaded: Record<string, string> = {}
  for (const name of Object.keys(rawFiles)) {
    const response = await cache.match(`/offline-catalogue/${installed.version}/${name}`)
    if (!response) return null
    const raw = await response.text()
    const bundled = catalogueManifest.files[name as keyof typeof catalogueManifest.files]
    const stored = installed.files?.[name]
    const expected = stored ?? (
      installed.version === catalogueManifest.catalogue_version
        ? { sha256: bundled.sha256, byteLength: bundled.byte_length }
        : null
    )
    if (!expected) return null
    if (new TextEncoder().encode(raw).byteLength !== expected.byteLength) return null
    if (await sha256(raw) !== expected.sha256) return null
    loaded[name] = raw
  }
  const expectedAssets = installed.assets ?? (
    installed.version === catalogueManifest.catalogue_version
      ? catalogueManifest.assets.map((asset) => ({
          ...asset,
          url: asset.url,
          sha256: asset.sha256,
          byteLength: asset.byte_length,
        }))
      : null
  )
  if (!expectedAssets) return null
  const assetUrls: Record<string, string> = {}
  const objectUrls: string[] = []
  for (const asset of expectedAssets) {
    const response = await cache.match(asset.url)
    if (!response) {
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      return null
    }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength !== asset.byteLength || await sha256Bytes(bytes) !== asset.sha256) {
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      return null
    }
    const objectUrl = URL.createObjectURL(new Blob([bytes], {
      type: response.headers.get('Content-Type') ?? 'image/jpeg',
    }))
    objectUrls.push(objectUrl)
    assetUrls[asset.url] = objectUrl
  }
  try {
    const approved = JSON.parse(loaded['approved-species.json']) as ApprovedSpeciesDataset
    const details = JSON.parse(loaded['catalogue-details.json']) as CatalogueDetailsDataset
    const guidance = JSON.parse(loaded['plant-guidance.json']) as OfflineCatalogueData['guidance']
    if (
      approved.catalogue_version !== installed.version
      || approved.record_count !== 32
      || approved.records.length !== 32
      || details.catalogue_version !== installed.version
      || details.record_count !== 32
      || details.records.length !== 32
      || !Array.isArray(guidance.plants)
    ) {
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      return null
    }
    return {
      approved,
      details,
      guidance,
      assetUrls,
      approvedImages: expectedAssets.reduce<Record<string, ApprovedCatalogueAsset>>(
        (images, asset) => {
          if (isApprovedCatalogueAsset(asset)) images[asset.url] = asset
          return images
        },
        {},
      ),
      release: () => objectUrls.forEach((url) => URL.revokeObjectURL(url)),
    }
  } catch {
    objectUrls.forEach((url) => URL.revokeObjectURL(url))
    return null
  }
}

export async function removeCataloguePack(): Promise<void> {
  const installed = installedCataloguePack()
  if (installed) {
    await caches.delete(installed.cacheName ?? `${CACHE_PREFIX}${installed.version}`)
  }
  localStorage.removeItem(STORAGE_KEY)
}

export function formatPackSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
