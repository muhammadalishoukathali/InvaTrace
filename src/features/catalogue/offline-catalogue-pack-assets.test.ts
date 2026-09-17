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

  it('tries the opaque copy first, then the image, then a nonce that defeats a cached transform', () => {
    const source = read('src/features/catalogue/offline-catalogue.ts')
    const routes = source.slice(source.indexOf('const routes = ['), source.indexOf('let last:'))
    // Order matters: the .bin is the only route a CDN leaves alone, the plain
    // image keeps dev servers working, and the nonce is what rescues a browser
    // still running an older bundle against an already-transformed edge copy.
    expect(routes.indexOf('.bin${version}')).toBeGreaterThan(-1)
    expect(routes.indexOf('.bin${version}')).toBeLessThan(routes.indexOf('&n=${crypto.randomUUID()}'))
    expect(routes).toContain('cache: \'no-store\'')
  })

  it('keeps trying later routes when one answers with the wrong bytes', () => {
    const source = read('src/features/catalogue/offline-catalogue.ts')
    // A stale service worker or an SPA rewrite handing back index.html answers
    // with a healthy 200, so stopping at the first response would strand the
    // download on bytes that can never match.
    expect(source).toContain('if (bytes.byteLength === asset.byte_length && await sha256Bytes(bytes) === asset.sha256)')
  })

  it('stores pack images as image/jpeg regardless of how they were served', () => {
    const source = read('src/features/catalogue/offline-catalogue.ts')
    // The .bin copy arrives as application/octet-stream, and these bytes are
    // handed to <img> as a blob URL when the catalogue renders offline.
    expect(source).toContain("headers: { 'Content-Type': 'image/jpeg' }")
  })
})
