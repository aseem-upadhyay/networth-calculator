import { useCallback, useEffect, useState } from 'react'
import { cachedRates, fetchRates } from '../lib/fx'
import type { FxRates } from '../lib/types'

export type RateState =
  | { status: 'loading' }
  | { status: 'ready'; rates: FxRates; fxAsOf: string; source: 'frankfurter' }
  /** The API is unreachable. Never block a save on someone else's server. */
  | { status: 'manual'; rates: FxRates; fxAsOf: string; reason: string }

interface Loaded {
  /** Which (currency, date) pair this table belongs to. */
  key: string
  rates: FxRates
  fxAsOf: string
  source: 'frankfurter' | 'manual'
  reason?: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Fetch the rate table to freeze into a snapshot.
 *
 * Historical dates use the dated endpoint, so a backdated snapshot is genuinely
 * accurate rather than approximated with today's rates. ECB prices business days
 * only, so the date that comes back can legitimately be several days earlier
 * than the one requested — that is what `fxAsOf` records.
 *
 * "Loading" is derived during render by comparing the loaded table's key to the
 * current one, rather than set from inside the effect. Same result, one fewer
 * render pass, and no stale table shown against a newly chosen date.
 */
export function useRates(baseCurrency: string, asOfDate: string) {
  const key = `${baseCurrency}|${asOfDate}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const historical = asOfDate < todayIso() ? asOfDate : undefined

    fetchRates(baseCurrency, historical)
      .then((r) => {
        if (!cancelled) {
          setLoaded({ key, rates: r.rates, fxAsOf: r.date, source: 'frankfurter' })
        }
      })
      .catch((e: Error) => {
        if (cancelled) return
        // Degrade to manual entry, prefilled from the last good table.
        const fallback = cachedRates(baseCurrency)
        setLoaded({
          key,
          rates: fallback?.rates ?? {},
          fxAsOf: fallback?.date ?? asOfDate,
          source: 'manual',
          reason: e.message,
        })
      })

    return () => { cancelled = true }
  }, [key, baseCurrency, asOfDate, attempt])

  const rates: RateState =
    loaded?.key !== key
      ? { status: 'loading' }
      : loaded.source === 'manual'
        ? { status: 'manual', rates: loaded.rates, fxAsOf: loaded.fxAsOf, reason: loaded.reason ?? '' }
        : { status: 'ready', rates: loaded.rates, fxAsOf: loaded.fxAsOf, source: 'frankfurter' }

  /** Manual override for one currency when the API is unreachable. */
  const setRate = useCallback((code: string, value: number) => {
    setLoaded((l) => (l ? { ...l, rates: { ...l.rates, [code]: value } } : l))
  }, [])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return { rates, retry, setRate }
}
