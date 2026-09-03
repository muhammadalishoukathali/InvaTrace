import { useEffect, useRef } from 'react'

/** Same idea as the focus handling in AppShell, just as a reusable hook - puts
 *  focus on a page heading after navigation, without adding it to the normal
 *  tab order (it's not meant to be tabbed to, just focused programmatically). */
export function usePageHeadingFocus() {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return ref
}
