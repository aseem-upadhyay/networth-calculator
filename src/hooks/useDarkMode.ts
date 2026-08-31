import { useEffect, useState } from 'react'

/**
 * Charts need the resolved theme as a value, not just as CSS — SVG fills are
 * set in JS, so a media query alone cannot reach them.
 */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return dark
}
