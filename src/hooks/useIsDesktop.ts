import { useEffect, useState } from 'react'

// 900px is where I switch from the mobile bottom tabs to the desktop
// sidebar layout - picked it from just testing on my own laptop/phone,
// not from any formal breakpoint spec
const QUERY = '(min-width: 900px)'

export function useIsDesktop(): boolean {
  const [match, setMatch] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  return match
}
