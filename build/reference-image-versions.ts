import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'

// Reference images are served from stable paths (/reference-images/<name>.jpg),
// and some of them get replaced in place when a better photo is found. A
// browser that cached the old bytes keeps showing them until its cache entry
// expires - for a year, under the old immutable header. This plugin hashes
// every file in public/reference-images/ at build (and dev-server) start and
// exposes the result as `virtual:reference-image-versions`, so the app can
// request `<name>.jpg?v=<hash>`: a new photo gets a URL no cache has seen.

const MODULE_ID = 'virtual:reference-image-versions'
const RESOLVED_ID = `\0${MODULE_ID}`
const IMAGE_DIR = fileURLToPath(new URL('../public/reference-images/', import.meta.url))

export function hashReferenceImages(directory = IMAGE_DIR): Record<string, string> {
  const versions: Record<string, string> = {}
  for (const name of readdirSync(directory).sort()) {
    if (!/\.(jpe?g|png|webp)$/i.test(name)) continue
    versions[name] = createHash('sha256')
      .update(readFileSync(join(directory, name)))
      .digest('hex')
      .slice(0, 12)
  }
  return versions
}

export function referenceImageVersions(): Plugin {
  return {
    name: 'reference-image-versions',
    resolveId(id) {
      return id === MODULE_ID ? RESOLVED_ID : undefined
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined
      return `export default ${JSON.stringify(hashReferenceImages())}`
    },
    configureServer(server) {
      // A photo swapped while the dev server is running should show up on the
      // next reload, not after a restart.
      server.watcher.add(IMAGE_DIR)
      server.watcher.on('change', (file) => {
        if (!file.startsWith(IMAGE_DIR)) return
        const module = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (module) server.moduleGraph.invalidateModule(module)
      })
    },
  }
}
