import type { FxRates } from './types'

/**
 * Currency conversion and formatting.
 *
 * The one trap here is the direction of Frankfurter's rates. With `base=INR`
 * the API returns `{"USD": 0.01134}`, meaning **1 INR = 0.01134 USD**. So
 * converting a USD holding into INR divides by that number; multiplying gives
 * an answer ~7700x too small, which looks plausible enough in a chart to go
 * unnoticed. See PLAN.md §7.
 */

export class MissingRateError extends Error {
  readonly currency: string

  constructor(currency: string) {
    super(`No FX rate available for ${currency}`)
    this.name = 'MissingRateError'
    this.currency = currency
  }
}

/**
 * Convert `amount` from `currency` into `baseCurrency`.
 *
 * @throws {MissingRateError} when `rates` has no entry for `currency`. Frozen
 * snapshot rates always cover their own holdings, so this only fires in
 * constant-currency mode, where a currency may have been retired since (BGN
 * after Bulgaria joined the euro). Callers there fall back to the frozen rate.
 */
export function convertToBase(
  amount: number,
  currency: string,
  rates: FxRates,
  baseCurrency: string,
): number {
  if (currency === baseCurrency) return amount
  const rate = rates[currency]
  if (!rate) throw new MissingRateError(currency)
  return amount / rate
}

/**
 * Convert between any two currencies using one snapshot's frozen rate table.
 *
 * `rateBase` is the currency the table is denominated against — a Frankfurter
 * response with `base=INR` gives `{USD: 0.01134, CAD: 0.01571}`, meaning
 * 1 INR = that much foreign. Crucially, **a table never contains its own base**,
 * so going INR -> CAD cannot be done by treating CAD as the base and looking up
 * `rates['INR']`; it is a multiply by `rates['CAD']` instead.
 *
 * This is what lets the whole app be re-rendered in any currency retroactively.
 * Every snapshot froze a full ~30-currency table at save time, so a portfolio
 * recorded in INR can be shown in CAD exactly — using the rates that applied on
 * each valuation date, not today's.
 */
export function convertBetween(
  amount: number,
  from: string,
  to: string,
  rates: FxRates,
  rateBase: string,
): number {
  if (from === to) return amount

  // Step 1: into the table's base.
  let inBase: number
  if (from === rateBase) inBase = amount
  else {
    const r = rates[from]
    if (!r) throw new MissingRateError(from)
    inBase = amount / r
  }

  // Step 2: out of the table's base into the target.
  if (to === rateBase) return inBase
  const t = rates[to]
  if (!t) throw new MissingRateError(to)
  return inBase * t
}

/** Convert out of the base currency into `currency`. The inverse of the above. */
export function convertFromBase(
  amount: number,
  currency: string,
  rates: FxRates,
  baseCurrency: string,
): number {
  if (currency === baseCurrency) return amount
  const rate = rates[currency]
  if (!rate) throw new MissingRateError(currency)
  return amount * rate
}

/**
 * Format as currency for display.
 *
 * Decimal places come from `Intl`, which already knows JPY and KRW take none —
 * never hand-roll this with `toFixed(2)`.
 */
export function formatMoney(
  amount: number,
  currency: string,
  opts: { compact?: boolean; decimals?: boolean } = {},
): string {
  const { compact = false, decimals = false } = opts
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: decimals ? undefined : 0,
    }).format(amount)
  } catch {
    // Unknown or retired currency code — Intl throws rather than degrading.
    return `${currency} ${Math.round(amount).toLocaleString()}`
  }
}

/** Percentage with a sign, for delta tables. Returns '—' when there is no base to compare against. */
export function formatPercent(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return '—'
  const pct = fraction * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}
