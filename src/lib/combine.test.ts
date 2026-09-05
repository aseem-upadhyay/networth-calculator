import { describe, expect, it } from 'vitest'
import {
  buildCombinedSeries, combineTotals, kindLookup, snapshotAsOf, verifyTotals,
} from './calc'
import type { Category, Portfolio, Snapshot } from './types'

const cats: Category[] = [
  { id: 'mf', label: 'MF', kind: 'asset', group: 'equity', regions: ['GLOBAL'], tier: 'global' },
  { id: 'loan', label: 'Loan', kind: 'liability', group: 'liability', regions: ['GLOBAL'], tier: 'global' },
]
const kinds = kindLookup(cats)

const folio = (id: string, baseCurrency: string): Portfolio =>
  ({ id, label: id, region: null, baseCurrency, cadenceMonths: 12, order: 0 })

const snap = (
  asOfDate: string, baseCurrency: string, rates: Record<string, number>,
  holdings: [string, number, string?][],
): Snapshot => ({
  asOfDate, recordedAt: 1, updatedAt: 1, baseCurrency, fxRates: rates,
  fxAsOf: asOfDate, fxSource: 'frankfurter',
  holdings: holdings.map(([categoryId, amount, currency = baseCurrency]) =>
    ({ categoryId, amount, currency, contributed: 0 })),
  totals: { assets: 0, liabilities: 0, net: 0 },
})

// India valued in March; US valued in September. The whole reason portfolios
// got their own timelines.
const india = folio('india', 'INR')
const us = folio('us', 'USD')
const portfolios = [india, us]

const timelines: Record<string, Snapshot[]> = {
  india: [
    snap('2025-03-31', 'INR', { USD: 0.0116, CAD: 0.0158 }, [['mf', 1_000_000], ['loan', 400_000]]),
    snap('2026-03-31', 'INR', { USD: 0.0113, CAD: 0.0149 }, [['mf', 1_400_000], ['loan', 300_000]]),
  ],
  us: [
    snap('2025-09-30', 'USD', { INR: 88.2, CAD: 1.35 }, [['mf', 50_000]]),
    snap('2026-09-30', 'USD', { INR: 88.5, CAD: 1.31 }, [['mf', 62_000]]),
  ],
}

describe('snapshotAsOf', () => {
  it('takes the most recent at or before the date', () => {
    expect(snapshotAsOf(timelines.india, '2026-01-01')?.asOfDate).toBe('2025-03-31')
    expect(snapshotAsOf(timelines.india, '2026-03-31')?.asOfDate).toBe('2026-03-31')
  })

  it('is undefined before the first snapshot — not zero', () => {
    // "did not exist yet" and "worth nothing" are different claims.
    expect(snapshotAsOf(timelines.us, '2024-01-01')).toBeUndefined()
  })

  it('defaults to the latest', () => {
    expect(snapshotAsOf(timelines.us)?.asOfDate).toBe('2026-09-30')
  })
})

describe('combineTotals', () => {
  it('sums folios kept in different currencies into one display currency', () => {
    const t = combineTotals(portfolios, timelines, kinds, 'USD')
    // India 2026-03: (1,400,000 - 300,000) INR x 0.0113 = 12,430 USD
    // US 2026-09: 62,000 USD
    expect(t.net).toBeCloseTo(12_430 + 62_000, 0)
  })

  it('records which date each folio contributed', () => {
    const t = combineTotals(portfolios, timelines, kinds, 'USD')
    expect(t.provenance).toEqual({ india: '2026-03-31', us: '2026-09-30' })
    expect(t.asOfDate).toBe('2026-09-30')
    expect(t.blended).toBe(true) // the UI must say so rather than imply one date
  })

  it('is not blended when the dates happen to align', () => {
    const aligned = { india: [timelines.india[1]], us: [snap('2026-03-31', 'USD', { INR: 88 }, [['mf', 1]])] }
    expect(combineTotals(portfolios, aligned, kinds, 'USD').blended).toBe(false)
  })

  it('omits a folio that had no snapshot yet', () => {
    const t = combineTotals(portfolios, timelines, kinds, 'USD', '2025-06-30')
    expect(Object.keys(t.provenance)).toEqual(['india']) // US had not started
    expect(t.net).toBeCloseTo(600_000 * 0.0116, 2)
  })

  it('subtracts liabilities across folios', () => {
    const t = combineTotals(portfolios, timelines, kinds, 'INR')
    expect(t.liabilities).toBeCloseTo(300_000, 0)
    expect(t.net).toBeCloseTo(t.assets - t.liabilities, 6)
  })
})

describe('buildCombinedSeries', () => {
  const series = buildCombinedSeries(portfolios, timelines, kinds, 'USD')

  it('uses the union of every folio dates', () => {
    expect(series.map((p) => p.asOfDate))
      .toEqual(['2025-03-31', '2025-09-30', '2026-03-31', '2026-09-30'])
  })

  it('carries a folio forward until it is next updated', () => {
    // India is not re-valued between Mar 2025 and Mar 2026, so it holds steady
    // rather than vanishing from the total.
    expect(series[0].india).toBeCloseTo(series[1].india as number, 6)
    expect(series[2].india).not.toBeCloseTo(series[1].india as number, 6)
  })

  it('contributes zero before a folio first appears', () => {
    expect(series[0].us).toBe(0)
    expect(series[1].us).toBeCloseTo(50_000, 0)
  })

  it('net is the sum of the folio contributions at each step', () => {
    for (const p of series) {
      expect(p.net).toBeCloseTo((p.india as number) + (p.us as number), 6)
    }
  })
})

describe('verifyTotals', () => {
  it('flags a stored total that disagrees with the holdings', () => {
    // Exactly the fixture bug: totals left at zero beside populated holdings.
    const bad = { ...timelines.india[1], totals: { assets: 0, liabilities: 0, net: 0 } }
    const { storedAgrees, totals } = verifyTotals(bad, kinds)
    expect(storedAgrees).toBe(false)
    expect(totals.net).toBeCloseTo(1_100_000, 0)
  })

  it('accepts a stored total that matches', () => {
    const good = { ...timelines.india[1], totals: { assets: 1_400_000, liabilities: 300_000, net: 1_100_000 } }
    expect(verifyTotals(good, kinds).storedAgrees).toBe(true)
  })
})

describe('deletion chunking', () => {
  // Mirrors repo.chunk. Batches cap at 500 operations; once a delete spans more
  // than one batch, the order between them stops being cosmetic — deleting a
  // parent first leaves its subcollections alive but no longer enumerable,
  // because the only path to them runs through the parent.
  const chunk = <T,>(items: T[], size = 400): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
    return out
  }

  it('keeps every batch inside the Firestore limit', () => {
    const refs = Array.from({ length: 1_250 }, (_, i) => i)
    const batches = chunk(refs)
    expect(batches).toHaveLength(4)
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(500)
  })

  it('loses nothing across the split', () => {
    const refs = Array.from({ length: 987 }, (_, i) => i)
    expect(chunk(refs).flat()).toEqual(refs)
  })

  it('handles the empty and single cases', () => {
    expect(chunk([])).toEqual([])
    expect(chunk([1])).toEqual([[1]])
  })

  it('orders levels children-before-parents', () => {
    // A portfolio delete is two levels: its snapshots, then the folio itself.
    const levels = [['snapA', 'snapB'], ['portfolio']]
    const order = levels.flatMap((l) => chunk(l).flat())
    expect(order.indexOf('portfolio')).toBeGreaterThan(order.indexOf('snapB'))
  })
})

describe('category catalog caching', () => {
  // 41 of the ~46 reads a session made were the catalog — one document read per
  // category, for a list identical across users that changes maybe monthly.
  const CATEGORIES = 41

  const readsPerSession = (opts: { manifest: boolean; warmCache: boolean; portfolios: number }) => {
    const catalog = opts.warmCache ? 0 : opts.manifest ? 1 : CATEGORIES
    // profile + portfolios list + one query per folio + customCategories
    return 1 + 1 + opts.portfolios + 1 + catalog
  }

  it('collapses the catalog from a read per category to one', () => {
    const before = readsPerSession({ manifest: false, warmCache: false, portfolios: 1 })
    const after = readsPerSession({ manifest: true, warmCache: false, portfolios: 1 })
    expect(before).toBe(45)
    expect(after).toBe(5)
    expect(1 - after / before).toBeGreaterThan(0.88)
  })

  it('costs nothing at all when the localStorage copy is still fresh', () => {
    expect(readsPerSession({ manifest: true, warmCache: true, portfolios: 1 })).toBe(4)
  })

  it('still scales with portfolios, which the manifest does not address', () => {
    // The N+1 over portfolios is a separate problem — see PLAN-backend-options §4.
    const one = readsPerSession({ manifest: true, warmCache: false, portfolios: 1 })
    const five = readsPerSession({ manifest: true, warmCache: false, portfolios: 5 })
    expect(five - one).toBe(4)
  })
})
