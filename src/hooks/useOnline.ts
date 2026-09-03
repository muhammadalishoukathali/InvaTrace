import { useSyncExternalStore } from 'react'

// helper that subscribes a component to the browser's online/offline events
// so useSyncExternalStore can re-render whenever the connection state flips
function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}
