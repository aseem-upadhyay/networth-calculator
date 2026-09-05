import { convertBetween, MissingRateError } from './money'
import type { Category, FxRates, Holding, Portfolio, Snapshot, Totals } from './types'

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

export type Kinds = Map<string, Category['kind']>

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
  /** Report in this currency instead. Defaults to the snapshot's own base. */
  displayCurrency: string = baseCurrency,
): Totals {
  let assets = 0
  let liabilities = 0
  for (const h of holdings) {
    const value = convertBetween(h.amount, h.currency, displayCurrency, rates, baseCurrency)
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
  rateBase: string,
  displayCurrency: string,
): { value: number; exact: boolean } {
  try {
    return {
      value: convertBetween(h.amount, h.currency, displayCurrency, rates, rateBase),
      exact: true,
    }
  } catch (e) {
    if (!(e instanceof MissingRateError)) throw e
    return {
      value: convertBetween(h.amount, h.currency, displayCurrency, fallback, rateBase),
      exact: false,
    }
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
export function computeDeltas(
  prev: Snapshot,
  curr: Snapshot,
  displayCurrency?: string,
): CategoryDelta[] {
  // Each snapshot converts through its OWN frozen table, so a history that
  // switched reporting currency partway still reports correctly — the table a
  // snapshot saved never contains its own base, which is why this cannot go
  // through convertToBase.
  const base = displayCurrency ?? curr.baseCurrency
  const startByCat = new Map<string, number>()
  for (const h of prev.holdings) {
    const v = convertBetween(h.amount, h.currency, base, prev.fxRates, prev.baseCurrency)
    startByCat.set(h.categoryId, (startByCat.get(h.categoryId) ?? 0) + v)
  }

  const seen = new Set<string>()
  const out: CategoryDelta[] = []

  for (const h of curr.holdings) {
    seen.add(h.categoryId)
    const start = startByCat.get(h.categoryId) ?? 0

    const end = convertBetween(h.amount, h.currency, base, curr.fxRates, curr.baseCurrency)
    const contributed = convertBetween(
      h.contributed, h.currency, base, curr.fxRates, curr.baseCurrency,
    )

    // Same holding valued at the *previous* snapshot's rates: strips FX movement.
    const atStart = convertOrFallback(h, prev.fxRates, curr.fxRates, prev.baseCurrency, base)
    const contribAtStart = convertOrFallback(
      { ...h, amount: h.contributed }, prev.fxRates, curr.fxRates, prev.baseCurrency, base,
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
  opts: { constantCurrency?: boolean; displayCurrency?: string } = {},
): { points: SeriesPoint[]; categoryIds: string[]; exact: boolean } {
  if (snapshots.length === 0) return { points: [], categoryIds: [], exact: true }

  const ordered = [...snapshots].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
  const latest = ordered[ordered.length - 1]
  const base = opts.displayCurrency ?? latest.baseCurrency
  const ids = new Set<string>()
  let exact = true

  const points = ordered.map((snap) => {
    // Constant currency revalues every snapshot at the newest rates, so the chart
    // shows what the holdings did rather than what the currency did.
    const rates = opts.constantCurrency ? latest.fxRates : snap.fxRates
    const rateBase = opts.constantCurrency ? latest.baseCurrency : snap.baseCurrency
    const fallback = snap.fxRates

    const point: SeriesPoint = { asOfDate: snap.asOfDate, t: parseDate(snap.asOfDate), net: 0 }
    let net = 0
    for (const h of snap.holdings) {
      const { value, exact: ok } = convertOrFallback(h, rates, fallback, rateBase, base)
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

/**
 * Currencies every snapshot can actually be expressed in.
 *
 * A display currency has to be reachable from *each* snapshot's own frozen
 * table, and those tables differ — BGN is in a 2024 table and gone from a 2026
 * one, because Bulgaria joined the euro. Offering a currency one snapshot
 * cannot reach throws MissingRateError mid-render and takes the page down, so
 * the intersection is computed and the picker is limited to it. The failure is
 * removed rather than caught.
 */
export function availableDisplayCurrencies(snapshots: Snapshot[]): string[] {
  if (snapshots.length === 0) return []

  const reachable = (s: Snapshot) => new Set([s.baseCurrency, ...Object.keys(s.fxRates)])
  let common = reachable(snapshots[0])
  for (const s of snapshots.slice(1)) {
    const next = reachable(s)
    common = new Set([...common].filter((c) => next.has(c)))
  }
  return [...common].sort()
}

/* ------------------------------------------------- across portfolios --- */

export interface CombinedTotals extends Totals {
  /** portfolioId -> the asOfDate that actually contributed. */
  provenance: Record<string, string>
  /** The newest contributing date, i.e. how current the freshest input is. */
  asOfDate: string | null
  /** True when contributing snapshots do not share a date. */
  blended: boolean
}

/** The most recent snapshot at or before `date`, or the latest if no date given. */
export function snapshotAsOf(timeline: Snapshot[], date?: string): Snapshot | undefined {
  if (!date) return timeline.at(-1)
  let found: Snapshot | undefined
  for (const s of timeline) {
    if (s.asOfDate > date) break
    found = s
  }
  return found
}

/**
 * Sum every portfolio into one figure.
 *
 * Each portfolio contributes its most recent snapshot at or before `date`, and
 * those are rarely the same day — India valued in March alongside a US folio
 * valued in September. That blending is not an artefact of the design; it is the
 * actual state of the user's knowledge. `provenance` records which date each
 * folio contributed so the UI can say so out loud rather than presenting a
 * single confident number.
 *
 * A portfolio with no snapshot at or before the date contributes nothing — it
 * did not exist yet, which is different from being worth zero.
 */
export function combineTotals(
  portfolios: Portfolio[],
  timelines: Record<string, Snapshot[]>,
  kinds: Kinds,
  displayCurrency: string,
  date?: string,
): CombinedTotals {
  let assets = 0
  let liabilities = 0
  const provenance: Record<string, string> = {}

  for (const p of portfolios) {
    const snap = snapshotAsOf(timelines[p.id] ?? [], date)
    if (!snap) continue
    const t = computeTotals(snap.holdings, kinds, snap.fxRates, snap.baseCurrency, displayCurrency)
    assets += t.assets
    liabilities += t.liabilities
    provenance[p.id] = snap.asOfDate
  }

  const dates = Object.values(provenance)
  return {
    assets,
    liabilities,
    net: assets - liabilities,
    provenance,
    asOfDate: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
    blended: new Set(dates).size > 1,
  }
}

export interface CombinedPoint {
  asOfDate: string
  t: number
  net: number
  /** portfolioId -> that folio's contribution at this date. */
  [portfolioId: string]: string | number
}

/**
 * A combined timeline across portfolios.
 *
 * The x values are the union of every portfolio's own dates, and at each one a
 * folio contributes its most recent snapshot at or before it. The result is a
 * step function that jumps whenever *any* portfolio is updated — a truthful
 * picture of when knowledge changed, rather than a smooth line implying
 * continuous observation that never happened.
 *
 * Note this is for totals and allocation only. The contributions / FX / return
 * split stays per-portfolio: computing it across these steps would attribute one
 * folio's update to another folio's period.
 */
export function buildCombinedSeries(
  portfolios: Portfolio[],
  timelines: Record<string, Snapshot[]>,
  kinds: Kinds,
  displayCurrency: string,
): CombinedPoint[] {
  const dates = [
    ...new Set(portfolios.flatMap((p) => (timelines[p.id] ?? []).map((s) => s.asOfDate))),
  ].sort()

  return dates.map((d) => {
    const point: CombinedPoint = { asOfDate: d, t: parseDate(d), net: 0 }
    let net = 0
    for (const p of portfolios) {
      const snap = snapshotAsOf(timelines[p.id] ?? [], d)
      const value = snap
        ? computeTotals(snap.holdings, kinds, snap.fxRates, snap.baseCurrency, displayCurrency).net
        : 0
      point[p.id] = value
      net += value
    }
    point.net = net
    return point
  })
}

/**
 * Recompute a snapshot's totals and report whether the stored figures agree.
 *
 * Totals are denormalized at save time, so a stored value can drift from the
 * holdings it claims to summarise — a buggy write, a hand-edited document, a
 * fixture that never computed them. PLAN.md §3 asked for this check and its
 * absence is exactly what let a zero headline render beside a populated chart.
 */
export function verifyTotals(
  snapshot: Snapshot,
  kinds: Kinds,
  displayCurrency?: string,
): { totals: Totals; storedAgrees: boolean } {
  const totals = computeTotals(
    snapshot.holdings, kinds, snapshot.fxRates, snapshot.baseCurrency,
    displayCurrency ?? snapshot.baseCurrency,
  )
  const sameCurrency = (displayCurrency ?? snapshot.baseCurrency) === snapshot.baseCurrency
  const storedAgrees = sameCurrency
    ? Math.abs(snapshot.totals.net - totals.net) < 1
    : true // not comparable across currencies; the stored value is in the folio's own base
  return { totals, storedAgrees }
}
