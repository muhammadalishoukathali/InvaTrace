#!/usr/bin/env node
// Publish an opaque copy of every catalogue reference image next to the
// original, as <name>.jpg.bin.
//
// Why this exists: the offline catalogue pack verifies each image's SHA-256
// against the manifest, and Render fronts the static site with Cloudflare,
// which runs Polish. Polish re-encodes the JPEG *after* the object is cached
// - measured on the live host, a freshly cached copy came back untouched and
// the same URL ten seconds later served a re-encoded body - and it does that
// even with `Cache-Control: no-transform` set on the response. A hash check
// can never pass against a moving target, so the download failed for whoever
// happened to ask after the transform landed.
//
// Polish only touches responses it recognises as images, by content type. A
// .bin extension is served as application/octet-stream, so the pack copy
// travels untouched while /reference-images/*.jpg stays a normal image for
// the catalogue UI to render.
//
// Runs as the build's postbuild step, so the copies exist in dist/ on every
// host without doubling the images in git.
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const distDir = resolve(root, 'dist')

if (!existsSync(distDir)) {
  throw new Error(`No dist/ to publish into - run vite build first (looked in ${distDir}).`)
}

// Only the images the manifest actually lists get a copy. public/ holds more
// than the approved 32, and the pack never downloads those, so copying them
// would just pad every deploy.
const manifestPath = resolve(root, 'shared/catalogue/catalogue-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
  throw new Error(`${manifestPath} lists no assets to publish.`)
}

let bytes = 0
for (const asset of manifest.assets) {
  const source = resolve(distDir, asset.url.replace(/^\//, ''))
  if (!existsSync(source)) {
    throw new Error(`Manifest asset missing from the build output: ${asset.url}`)
  }
  const size = statSync(source).size
  if (size !== asset.byte_length) {
    throw new Error(
      `Manifest asset size mismatch for ${asset.url}:`
      + ` build has ${size} bytes, manifest lists ${asset.byte_length}.`,
    )
  }
  copyFileSync(source, `${source}.bin`)
  bytes += size
}

console.log(
  `publish-pack-assets: published ${manifest.assets.length} opaque pack copies`
  + ` (${(bytes / 1024 / 1024).toFixed(1)} MB) alongside the reference images`,
)
