import { useEffect, useState } from 'react'

const KEY = 'nwc:redacted'

/**
 * Blur every figure on screen. A per-viewer convenience, so localStorage is the
 * right home — it is not private data, and it should survive the tab.
 */
export function useRedacted(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    document.body.classList.toggle('redacted', on)
    try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* ignore */ }
  }, [on])

  return [on, () => setOn((v) => !v)]
}
