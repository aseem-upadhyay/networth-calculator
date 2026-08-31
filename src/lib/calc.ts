import { convertToBase, MissingRateError } from './money'
import type { Category, FxRates, Holding, Snapshot, Totals } from './types'

/** Parse YYYY-MM-DD as UTC midnight. Local parsing drifts by a day west of Greenwich. */
export function parseDate(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return (parseDate(toIso) - parseDate(fromIso)) / 86_400_000
}

/** Compound annual growth rate over an actual day count, never a snapshot count. */
export function cagr(start: number, end: number, days: number): number | null {
  if (start <= 0 || end <= 0 || days <= 0) return null
  return Math.pow(end / start, 365 / days) - 1
}

type Kinds = Map<string, Category['kind']>

export function kindLookup(categories: Category[]): Kinds {
  return new Map(categories.map((c) => [c.id, c.kind]))
}

/**
 * Sum a snapshot's holdings into its base currency using its own frozen rates.
 *
 * A holding whose category is unknown (deleted from the picker, or a private
 * category belonging to a different user) counts as an asset rather than being
 * dropped — silently omitting money from a net-worth total is the worse failure.
 */
export function computeTotals(
  holdings: Holding[],
  kinds: Kinds,
  rates: FxRates,
  baseCurrency: string,
): Totals {
  let assets = 0
  let liabilities = 0
  for (const h of holdings) {
    const value = convertToBase(h.amount, h.currency, rates, baseCurrency)
    if (kinds.get(h.categoryId) === 'liability') liabilities += value
    else assets += value
  }
  return { assets, liabilities, net: assets - liabilities }
}

/**
 * Convert at `rates`, falling back to `fallback` when a currency has been
 * retired since the snapshot was written (PLAN.md §7). Reports which happened
 * so the UI can flag a series as only partially constant-currency.
 */
function convertOrFallback(
  h: Holding,
  rates: FxRates,
  fallback: FxRates,
  baseCurrency: string,
): { value: number; exact: boolean } {
  try {
    return { value: convertToBase(h.amount, h.currency, rates, baseCurrency), exact: true }
  } catch (e) {
    if (!(e instanceof MissingRateError)) throw e
    return { value: convertToBase(h.amount, h.currency, fallback, baseCurrency), exact: false }
  }
}

export interface CategoryDelta {
  categoryId: string
  /** Value at the previous snapshot, in base currency at that snapshot's rates. */
  start: number
  /** Value now, in base currency at the current snapshot's rates. */
  end: number
  change: number
  /** The three-way split of `change`. Sums to `change` exactly, by construction. */
  contributed: number
  fxEffect: number
  investmentReturn: number
  /** Modified-Dietz rate, constant-currency. Null when there is no opening value. */
  returnRate: number | null
  /** False when a retired currency forced a fallback rate. */
  exact: boolean
}

/**
 * Attribute the change in each category between two snapshots to contributions,
 * currency movement, and investment return.
 *
 *   change = contributed + fxEffect + investmentReturn
 *
 * `investmentReturn` is deliberately the **residual**, which makes that identity
 * hold exactly rather than approximately — the alternative is three independently
 * computed terms that don't quite add up, and a chart nobody trusts.
 *
 * `returnRate` is modified Dietz, computed in constant currency so a weakening
 * rupee doesn't read as investment skill:
 *
 *   (endAtStartRates − start − contributed) / (start + 0.5 × contributed)
 *
 * The 0.5 assumes contributions arrived mid-period. A snapshot only records the
 * period total, so their real timing is unknown; this is the standard
 * approximation and should be labelled as one in the UI.
 */
export function computeDeltas(prev: Snapshot, curr: Snapshot): CategoryDelta[] {
  const base = curr.baseCurrency
  const startByCat = new Map<string, number>()
  for (const h of prev.holdings) {
    const v = convertToBase(h.amount, h.currency, prev.fxRates, prev.baseCurrency)
    startByCat.set(h.categoryId, (startByCat.get(h.categoryId) ?? 0) + v)
  }

  const seen = new Set<string>()
  const out: CategoryDelta[] = []

  for (const h of curr.holdings) {
    seen.add(h.categoryId)
    const start = startByCat.get(h.categoryId) ?? 0

    const end = convertToBase(h.amount, h.currency, curr.fxRates, base)
    const contributed = convertToBase(h.contributed, h.currency, curr.fxRates, base)

    // Same holding valued at the *previous* snapshot's rates: strips FX movement.
    const atStart = convertOrFallback(h, prev.fxRates, curr.fxRates, base)
    const contribAtStart = convertOrFallback(
      { ...h, amount: h.contributed }, prev.fxRates, curr.fxRates, base,
    )

    const change = end - start
    const fxEffect = end - atStart.value
    const investmentReturn = change - contributed - fxEffect

    const denom = start + 0.5 * contribAtStart.value
    const returnRate =
      start > 0 && denom > 0
        ? (atStart.value - start - contribAtStart.value) / denom
        : null

    out.push({
      categoryId: h.categoryId, start, end, change,
      contributed, fxEffect, investmentReturn, returnRate,
      exact: atStart.exact && contribAtStart.exact,
    })
  }

  // Categories that vanished this period: fully exited, so the whole drop is "return".
  for (const [categoryId, start] of startByCat) {
    if (seen.has(categoryId)) continue
    out.push({
      categoryId, start, end: 0, change: -start,
      contributed: 0, fxEffect: 0, investmentReturn: -start,
      returnRate: null, exact: true,
    })
  }

  return out.sort((a, b) => b.end - a.end)
}

export interface SeriesPoint {
  asOfDate: string
  /** Epoch ms, so the x-axis can be time-scaled rather than evenly spaced. */
  t: number
  net: number
  /** categoryId -> value in base currency. Missing categories are zero-filled. */
  [categoryId: string]: string | number
}

/**
 * Build the stacked-area series.
 *
 * Categories absent from a snapshot are zero-filled so the stack is continuous.
 * That is a charting convenience only — `computeDeltas` still refuses to report a
 * return rate without a real opening value, so a new holding never shows infinite
 * growth (PLAN.md §8b).
 */
export function buildSeries(
  snapshots: Snapshot[],
  opts: { constantCurrency?: boolean } = {},
): { points: SeriesPoint[]; categoryIds: string[]; exact: boolean } {
  if (snapshots.length === 0) return { points: [], categoryIds: [], exact: true }

  const ordered = [...snapshots].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
  const latest = ordered[ordered.length - 1]
  const base = latest.baseCurrency
  const ids = new Set<string>()
  let exact = true

  const points = ordered.map((snap) => {
    // Constant currency revalues every snapshot at the newest rates, so the chart
    // shows what the holdings did rather than what the currency did.
    const rates = opts.constantCurrency ? latest.fxRates : snap.fxRates
    const fallback = snap.fxRates

    const point: SeriesPoint = { asOfDate: snap.asOfDate, t: parseDate(snap.asOfDate), net: 0 }
    let net = 0
    for (const h of snap.holdings) {
      const { value, exact: ok } = convertOrFallback(h, rates, fallback, base)
      if (!ok) exact = false
      ids.add(h.categoryId)
      point[h.categoryId] = ((point[h.categoryId] as number) ?? 0) + value
      net += value
    }
    point.net = net
    return point
  })

  const categoryIds = [...ids]
  for (const p of points) {
    for (const id of categoryIds) if (p[id] === undefined) p[id] = 0
  }

  return { points, categoryIds, exact }
}
