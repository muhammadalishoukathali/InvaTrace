import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const updateModule = readFileSync(
  fileURLToPath(new URL('./pwa-update.ts', import.meta.url)),
  'utf8',
)
const main = readFileSync(fileURLToPath(new URL('./main.tsx', import.meta.url)), 'utf8')

describe('production PWA update lifecycle', () => {
  it('registers explicitly and reloads only when a replacement worker takes control', () => {
    expect(main).toContain('installPwaUpdates()')
    expect(updateModule).toContain("registerSW({")
    expect(updateModule).toContain("addEventListener('controllerchange'")
    expect(updateModule).toContain('hasController = Boolean(navigator.serviceWorker.controller)')
    expect(updateModule).toContain('window.location.reload()')
  })

  it('checks for updates on startup, resume, reconnect and a bounded interval', () => {
    expect(updateModule).toContain('checkForUpdate()')
    expect(updateModule).toContain('registration.update()')
    expect(updateModule).toContain("addEventListener('online'")
    expect(updateModule).toContain("addEventListener('visibilitychange'")
    expect(updateModule).toContain('UPDATE_INTERVAL_MS')
  })
})
