import { registerSW } from 'virtual:pwa-register'

const UPDATE_INTERVAL_MS = 60 * 60 * 1000

/**
 * Register the production service worker and actively check for a newer app
 * shell. The first installation does not reload the page. A later worker
 * takeover reloads once so the open tab and installed PWA use the same build.
 */
export function installPwaUpdates(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return

  let hasController = Boolean(navigator.serviceWorker.controller)
  let reloadStarted = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hasController) {
      hasController = true
      return
    }
    if (reloadStarted) return
    reloadStarted = true
    window.location.reload()
  })

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void updateSW(true)
    },
    onRegisteredSW(_workerUrl, registration) {
      if (!registration) return

      const checkForUpdate = () => {
        if (!navigator.onLine) return
        void registration.update().catch((error: unknown) => {
          console.warn('[PWA] Update check failed; the current offline version remains available.', error)
        })
      }

      checkForUpdate()
      window.setInterval(checkForUpdate, UPDATE_INTERVAL_MS)
      window.addEventListener('online', checkForUpdate)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate()
      })
    },
    onRegisterError(error) {
      console.error('[PWA] Service-worker registration failed.', error)
    },
  })
}
