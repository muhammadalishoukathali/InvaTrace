import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface Options {
  active?: boolean
  returnFocus?: () => HTMLElement | null
}

/** Handles the accessibility bits every dialog needs: traps tab focus inside
 *  it while open, closes on Escape, and puts focus back on whatever opened
 *  it once it's done. Wrote this once and reuse it everywhere I have a
 *  modal/dialog instead of redoing this logic each time. */
export function useDialogA11y(
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  { active = true, returnFocus }: Options = {},
) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const returnFocusRef = useRef(returnFocus)
  returnFocusRef.current = returnFocus

  useEffect(() => {
    if (!active) return
    const dialog = dialogRef.current
    if (!dialog) return

    const resolveReturnFocus = returnFocusRef.current
    const previous = resolveReturnFocus?.() ?? (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    )
    const appRoot = document.getElementById('root')
    const wasInert = appRoot?.inert ?? false
    if (appRoot && !appRoot.contains(dialog)) appRoot.inert = true

    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => !element.hidden && element.getClientRects().length > 0)

    const frame = requestAnimationFrame(() => {
      const initial = dialog.querySelector<HTMLElement>('[data-dialog-initial]')
      ;(initial ?? focusable()[0] ?? dialog).focus()
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown, true)
      if (appRoot && !appRoot.contains(dialog)) appRoot.inert = wasInert
      const returnTarget = resolveReturnFocus?.() ?? previous
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true })
    }
  }, [active, dialogRef])
}
