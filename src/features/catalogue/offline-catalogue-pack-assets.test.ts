// The offline pack's integrity check only survives if the bytes reach the
// browser untouched. Render fronts the static site with Cloudflare, whose
// Polish re-encodes images *after* they are cached - `no-transform` does not
// stop it - so the pack downloads an opaque .bin copy that Polish ignores.
// That arrangement spans three files, and breaking any one of them puts the
// catalogue download back to failing for every user on that host, with
// nothing in the app to explain why. Hence these checks.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../..')
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf-8')

describe('offline catalogue pack assets', () => {
  it('publishes the opaque pack copies as part of every build', () => {
    const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(packageJson.scripts.postbuild).toBe('node scripts/publish-pack-assets.mjs')
  })

  it('copies exactly the manifest assets, not whatever sits in the images folder', () => {
    const script = read('scripts/publish-pack-assets.mjs')
    expect(script).toContain('shared/catalogue/catalogue-manifest.json')
    expect(script).toContain('for (const asset of manifest.assets)')
    expect(script).toContain('`${source}.bin`')
  })

  it('downloads the .bin copy and falls back to the image when it is absent', () => {
    const source = read('src/features/catalogue/offline-catalogue.ts')
    expect(source).toContain('`${asset.url}.bin${version}`')
    // The fallback keeps dev servers and any host without the postbuild step
    // working, so losing it would only show up in production.
    expect(source).toContain('if (!response.ok) {')
  })

  it('stores pack images as image/jpeg regardless of how they were served', () => {
    const source = read('src/features/catalogue/offline-catalogue.ts')
    // The .bin copy arrives as application/octet-stream, and these bytes are
    // handed to <img> as a blob URL when the catalogue renders offline.
    expect(source).toContain("headers: { 'Content-Type': 'image/jpeg' }")
  })
})
