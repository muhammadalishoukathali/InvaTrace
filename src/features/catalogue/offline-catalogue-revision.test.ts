// A reference photo or data file can be replaced without the catalogue version
// moving (24932bc swapped the Mikania photo and kept 2.2.0). Packs installed
// before such a change verify against their own stored hashes, so they keep
// passing - and keep showing the old photo - unless something compares them to
// the manifest that is available now.
import { describe, expect, it } from 'vitest'
import { catalogueManifest, type CatalogueManifest } from '@shared/catalogue'
import {
  catalogueManifestRevised,
  cataloguePackRevision,
  packAssetUrl,
  type InstalledCataloguePack,
} from './offline-catalogue'

const MIKANIA = '/reference-images/mikania_micrantha.jpg'
const OLD_HASH = 'a'.repeat(64)

function installedFrom(manifest: CatalogueManifest): InstalledCataloguePack {
  return {
    version: manifest.catalogue_version,
    installedAt: '2026-10-01T00:00:00.000Z',
    reviewedAt: manifest.last_reviewed,
    byteSize: 1,
    cacheName: 'invatrace-catalogue-test',
    files: Object.fromEntries(Object.entries(manifest.files).map(([name, file]) => [
      name,
      { sha256: file.sha256, byteLength: file.byte_length },
    ])),
    assets: manifest.assets.map((asset) => ({ ...asset, byteLength: asset.byte_length })),
  }
}

function withAsset(manifest: CatalogueManifest, url: string, sha256: string): CatalogueManifest {
  return {
    ...manifest,
    assets: manifest.assets.map((asset) => (asset.url === url ? { ...asset, sha256 } : asset)),
  }
}

describe('cataloguePackRevision', () => {
  it('treats a pack installed from the current manifest as current', () => {
    expect(cataloguePackRevision(installedFrom(catalogueManifest))).toEqual({
      revised: false,
      staleAssetUrls: [],
    })
  })

  it('flags a same-version pack holding a replaced photo, naming that photo only', () => {
    const installed = installedFrom(withAsset(catalogueManifest, MIKANIA, OLD_HASH))
    expect(installed.version).toBe(catalogueManifest.catalogue_version)
    expect(cataloguePackRevision(installed)).toEqual({
      revised: true,
      staleAssetUrls: [MIKANIA],
    })
  })

  it('flags a same-version pack whose data file was replaced', () => {
    const installed = installedFrom(catalogueManifest)
    installed.files!['plant-guidance.json'] = {
      ...installed.files!['plant-guidance.json'],
      sha256: OLD_HASH,
    }
    expect(cataloguePackRevision(installed)).toEqual({ revised: true, staleAssetUrls: [] })
  })

  it('compares against the server manifest when one is given', () => {
    const installed = installedFrom(catalogueManifest)
    const server = withAsset(catalogueManifest, MIKANIA, 'b'.repeat(64))
    expect(cataloguePackRevision(installed, server).staleAssetUrls).toEqual([MIKANIA])
  })

  it('leaves a different version to the version check', () => {
    const installed = {
      ...installedFrom(withAsset(catalogueManifest, MIKANIA, OLD_HASH)),
      version: '2.1.0',
    }
    expect(cataloguePackRevision(installed)).toEqual({ revised: false, staleAssetUrls: [] })
  })

  it('cannot compare packs saved before per-file hashes were recorded', () => {
    const legacy = { ...installedFrom(catalogueManifest), files: undefined, assets: undefined }
    expect(cataloguePackRevision(legacy)).toEqual({ revised: false, staleAssetUrls: [] })
  })

  it('handles no installed pack', () => {
    expect(cataloguePackRevision(null)).toEqual({ revised: false, staleAssetUrls: [] })
  })
})

describe('catalogueManifestRevised', () => {
  it('tells whether the server has revised content this build does not have', () => {
    expect(catalogueManifestRevised(catalogueManifest, catalogueManifest)).toBe(false)
    expect(catalogueManifestRevised(
      catalogueManifest,
      withAsset(catalogueManifest, MIKANIA, 'b'.repeat(64)),
    )).toBe(true)
  })
})

describe('packAssetUrl', () => {
  const assetUrls = { [MIKANIA]: 'blob:old-mikania', '/reference-images/other.jpg': 'blob:other' }
  const stale = new Set([MIKANIA])

  it('skips the stale blob online so the versioned network URL is used', () => {
    expect(packAssetUrl(assetUrls, MIKANIA, stale, true)).toBeUndefined()
  })

  it('keeps the stale blob offline, where it is the only copy', () => {
    expect(packAssetUrl(assetUrls, MIKANIA, stale, false)).toBe('blob:old-mikania')
  })

  it('keeps blobs for images that have not changed', () => {
    expect(packAssetUrl(assetUrls, '/reference-images/other.jpg', stale, true)).toBe('blob:other')
  })
})
