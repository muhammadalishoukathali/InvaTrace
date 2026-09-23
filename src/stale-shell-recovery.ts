/**
 * Recover from a stale PWA / browser cache that references dead asset hashes.
 *
 * When Render deploys a new build, previously hashed `/assets/*.js` files
 * disappear. A shell still cached in the browser (or by the installed PWA)
 * asks for those old hashes, Render's SPA fallback returns `index.html`, and
 * the browser rejects that as a JS module because it comes back with MIME
 * type `text/html`. The tab paints nothing.
 *
 * The listeners below spot that failure mode, unregister the service worker,
 * clear every Cache Storage bucket, and hard-reload once so the fresh shell
 * takes over. A `sessionStorage` flag stops the recovery from looping if the
 * reload also fails for a genuine outage.
 */
const RECOVERY_FLAG = 'invatrace:stale-shell-recovery'

const STALE_SHELL_HINTS = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
  'Expected a JavaScript',
  'MIME type',
  "'text/html'",
  'ChunkLoadError',
  'Loading chunk',
  'Loading CSS chunk',
]

function looksLikeStaleShell(message: string | undefined): boolean {
  if (!message) return false
  return STALE_SHELL_HINTS.some((hint) => message.includes(hint))
}

async function purgeCachesAndWorkers(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((registration) => registration.unregister()))
    }
  } catch (error) {
    console.warn('[stale-shell] unregister failed', error)
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch (error) {
    console.warn('[stale-shell] cache purge failed', error)
  }
}

function scheduleRecovery(reason: string): void {
  if (sessionStorage.getItem(RECOVERY_FLAG)) return
  sessionStorage.setItem(RECOVERY_FLAG, reason)
  console.warn(`[stale-shell] recovering: ${reason}`)
  void purgeCachesAndWorkers().finally(() => {
    window.location.reload()
  })
}

export function installStaleShellRecovery(): void {
  if (import.meta.env.DEV) return

  window.addEventListener('error', (event) => {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
      const src = (target as HTMLScriptElement).src || (target as HTMLLinkElement).href
      if (src && src.includes('/assets/')) {
        scheduleRecovery(`asset load failed: ${src}`)
      }
      return
    }
    if (looksLikeStaleShell(event.message)) {
      scheduleRecovery(`error: ${event.message}`)
    }
  }, true)

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = typeof reason === 'string'
      ? reason
      : reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : undefined
    if (looksLikeStaleShell(message)) {
      scheduleRecovery(`rejection: ${message}`)
    }
  })
}
