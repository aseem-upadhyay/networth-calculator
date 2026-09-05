import { describe, expect, it } from 'vitest'
import {
  availableDisplayCurrencies, buildSeries, cagr, computeDeltas, computeTotals,
  daysBetween, kindLookup,
} from './calc'
import { convertToBase, MissingRateError } from './money'
import type { Category, Snapshot } from './types'

const cats: Category[] = [
  { id: 'mutual-funds', label: 'Mutual Funds', kind: 'asset', group: 'equity', regions: ['GLOBAL'], tier: 'global' },
  { id: 'rsu', label: 'RSU', kind: 'asset', group: 'equity', regions: ['GLOBAL'], tier: 'global' },
  { id: 'home-loan', label: 'Home Loan', kind: 'liability', group: 'liability', regions: ['GLOBAL'], tier: 'global' },
]
const kinds = kindLookup(cats)

const prev: Snapshot = {
  asOfDate: '2025-08-31', recordedAt: 1, updatedAt: 1,
  baseCurrency: 'INR', fxRates: { USD: 0.0114 }, fxAsOf: '2025-08-29', fxSource: 'frankfurter',
  holdings: [
    { categoryId: 'mutual-funds', amount: 1_000_000, currency: 'INR', contributed: 0 },
    { categoryId: 'rsu', amount: 40_000, currency: 'USD', contributed: 0 },
  ],
  totals: { assets: 0, liabilities: 0, net: 0 },
}

const curr: Snapshot = {
  asOfDate: '2026-08-31', recordedAt: 2, updatedAt: 2,
  baseCurrency: 'INR', fxRates: { USD: 0.01134 }, fxAsOf: '2026-08-31', fxSource: 'frankfurter',
  holdings: [
    { categoryId: 'mutual-funds', amount: 1_300_000, currency: 'INR', contributed: 200_000 },
    { categoryId: 'rsu', amount: 42_000, currency: 'USD', contributed: 12_000 },
  ],
  totals: { assets: 0, liabilities: 0, net: 0 },
}

describe('convertToBase', () => {
  it('divides, because rates are foreign-per-base', () => {
    // 1 INR = 0.01134 USD, so $100 is ~₹8,818 — not ~₹1.13.
    expect(convertToBase(100, 'USD', { USD: 0.01134 }, 'INR')).toBeCloseTo(8818.34, 1)
  })

  it('passes the base currency through untouched', () => {
    expect(convertToBase(500, 'INR', { USD: 0.01134 }, 'INR')).toBe(500)
  })

  it('throws for a currency with no rate', () => {
    expect(() => convertToBase(10, 'BGN', { USD: 0.01134 }, 'INR')).toThrow(MissingRateError)
  })
})

describe('computeTotals', () => {
  it('subtracts liabilities from assets', () => {
    const t = computeTotals(
      [
        { categoryId: 'mutual-funds', amount: 1_000_000, currency: 'INR', contributed: 0 },
        { categoryId: 'home-loan', amount: 400_000, currency: 'INR', contributed: 0 },
      ],
      kinds, { USD: 0.01134 }, 'INR',
    )
    expect(t).toEqual({ assets: 1_000_000, liabilities: 400_000, net: 600_000 })
  })

  it('counts an unknown category as an asset rather than dropping it', () => {
    const t = computeTotals(
      [{ categoryId: 'mystery', amount: 250, currency: 'INR', contributed: 0 }],
      kinds, {}, 'INR',
    )
    expect(t.assets).toBe(250)
  })
})

describe('computeDeltas', () => {
  const deltas = computeDeltas(prev, curr)
  const rsu = deltas.find((d) => d.categoryId === 'rsu')!
  const mf = deltas.find((d) => d.categoryId === 'mutual-funds')!

  it('splits change into three parts that sum exactly', () => {
    for (const d of deltas) {
      expect(d.contributed + d.fxEffect + d.investmentReturn).toBeCloseTo(d.change, 6)
    }
  })

  it('reports no FX effect for a holding in the base currency', () => {
    expect(mf.fxEffect).toBe(0)
    expect(mf.contributed).toBe(200_000)
    expect(mf.investmentReturn).toBeCloseTo(100_000, 6) // ₹300k change, ₹200k of it deposits
  })

  it('separates a weakening rupee from actual performance', () => {
    // $40k -> $42k while the rupee slid: value rose in INR, but $12k was deposited,
    // so the underlying return is sharply negative and must not read as growth.
    expect(rsu.change).toBeGreaterThan(0)
    expect(rsu.fxEffect).toBeGreaterThan(0)
    expect(rsu.investmentReturn).toBeLessThan(0)
    expect(rsu.returnRate).toBeCloseTo(-0.2174, 3)
  })

  it('refuses a return rate for a category with no opening value', () => {
    const fresh: Snapshot = {
      ...curr,
      holdings: [{ categoryId: 'gold', amount: 50_000, currency: 'INR', contributed: 50_000 }],
    }
    const [d] = computeDeltas(prev, fresh)
    expect(d.categoryId).toBe('gold')
    expect(d.returnRate).toBeNull() // not Infinity
  })

  it('treats a category that disappeared as a full exit', () => {
    const exited: Snapshot = { ...curr, holdings: [curr.holdings[0]] }
    const d = computeDeltas(prev, exited).find((x) => x.categoryId === 'rsu')!
    expect(d.end).toBe(0)
    expect(d.change).toBeCloseTo(-d.start, 6)
  })
})

describe('buildSeries', () => {
  it('zero-fills categories missing from a snapshot', () => {
    const early: Snapshot = { ...prev, holdings: [prev.holdings[0]] }
    const { points, categoryIds } = buildSeries([early, curr])
    expect(categoryIds.sort()).toEqual(['mutual-funds', 'rsu'])
    expect(points[0].rsu).toBe(0)
    expect(points[1].rsu).toBeGreaterThan(0)
  })

  it('exposes epoch ms so the axis can be time-scaled', () => {
    const { points } = buildSeries([prev, curr])
    expect(points[1].t - points[0].t).toBe(365 * 86_400_000)
  })

  it('constant currency removes the FX gain', () => {
    const asReported = buildSeries([prev, curr]).points
    const constant = buildSeries([prev, curr], { constantCurrency: true }).points
    // Revaluing the opening snapshot at today's weaker rupee raises its INR value.
    expect(constant[0].net).toBeGreaterThan(asReported[0].net)
    expect(constant[1].net).toBeCloseTo(asReported[1].net, 6)
  })

  it('flags inexact when a currency was retired between snapshots', () => {
    const withBgn: Snapshot = {
      ...prev,
      fxRates: { USD: 0.0114, BGN: 0.0217 },
      holdings: [{ categoryId: 'cash', amount: 500, currency: 'BGN', contributed: 0 }],
    }
    const { exact } = buildSeries([withBgn, curr], { constantCurrency: true })
    expect(exact).toBe(false) // curr.fxRates has no BGN; fell back rather than throwing
  })
})

describe('cagr', () => {
  it('annualises on real day counts, not snapshot counts', () => {
    expect(cagr(100, 121, 730)).toBeCloseTo(0.1, 6)   // two years => 10%/yr
    expect(cagr(100, 110, 365)).toBeCloseTo(0.1, 6)
  })

  it('returns null where the maths is undefined', () => {
    expect(cagr(0, 100, 365)).toBeNull()
    expect(cagr(100, 0, 365)).toBeNull()
    expect(cagr(100, 110, 0)).toBeNull()
  })
})

describe('daysBetween', () => {
  it('is timezone-stable', () => {
    expect(daysBetween('2025-08-31', '2026-08-31')).toBe(365)
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2) // leap year
  })
})

describe('changing reporting currency', () => {
  // The scenario: someone tracked in INR, then moved to Canada and switched to
  // CAD. Older snapshots keep their INR-denominated frozen tables, and a rate
  // table never contains its own base — so this used to throw and fall back to
  // wrong numbers rather than converting.
  const inrSnap: Snapshot = {
    ...prev,
    baseCurrency: 'INR',
    fxRates: { USD: 0.0114, CAD: 0.01571 },
    holdings: [{ categoryId: 'mutual-funds', amount: 1_000_000, currency: 'INR', contributed: 0 }],
  }
  const cadSnap: Snapshot = {
    ...curr,
    baseCurrency: 'CAD',
    fxRates: { USD: 0.726, INR: 63.66 },
    holdings: [{ categoryId: 'mutual-funds', amount: 20_000, currency: 'CAD', contributed: 2_000 }],
  }

  it('reports an INR-era snapshot in CAD', () => {
    const t = computeTotals(inrSnap.holdings, kinds, inrSnap.fxRates, 'INR', 'CAD')
    expect(t.net).toBeCloseTo(15_710, 2) // 1,000,000 x 0.01571
  })

  it('builds a continuous series across a currency switch', () => {
    const { points, exact } = buildSeries([inrSnap, cadSnap], { displayCurrency: 'CAD' })
    expect(exact).toBe(true)
    expect(points[0].net).toBeCloseTo(15_710, 2)
    expect(points[1].net).toBeCloseTo(20_000, 2)
  })

  it('computes deltas across the switch without falling back', () => {
    const [d] = computeDeltas(inrSnap, cadSnap, 'CAD')
    expect(d.exact).toBe(true)
    expect(d.start).toBeCloseTo(15_710, 2)
    expect(d.end).toBeCloseTo(20_000, 2)
    expect(d.contributed + d.fxEffect + d.investmentReturn).toBeCloseTo(d.change, 6)
  })

  it('shows the same portfolio in any currency', () => {
    const inCad = computeTotals(inrSnap.holdings, kinds, inrSnap.fxRates, 'INR', 'CAD')
    const inUsd = computeTotals(inrSnap.holdings, kinds, inrSnap.fxRates, 'INR', 'USD')
    const inInr = computeTotals(inrSnap.holdings, kinds, inrSnap.fxRates, 'INR')
    expect(inInr.net).toBe(1_000_000)
    expect(inCad.net).toBeCloseTo(15_710, 2)
    expect(inUsd.net).toBeCloseTo(11_400, 2)
  })
})

describe('availableDisplayCurrencies', () => {
  const mk = (rates: Record<string, number>, base = 'INR'): Snapshot =>
    ({ ...prev, baseCurrency: base, fxRates: rates })

  it('offers only what every snapshot can reach', () => {
    // BGN exists in the older table and not the newer one, so it must not be
    // offered — picking it would throw mid-render on the newer snapshot.
    const out = availableDisplayCurrencies([
      mk({ USD: 1, CAD: 2, BGN: 3 }),
      mk({ USD: 1, CAD: 2 }),
    ])
    expect(out).toEqual(['CAD', 'INR', 'USD'])
    expect(out).not.toContain('BGN')
  })

  it('always includes each snapshot base, which its own table omits', () => {
    // A rate table never contains its own base, but the snapshot is trivially
    // expressible in it.
    expect(availableDisplayCurrencies([mk({ USD: 1 })])).toContain('INR')
  })

  it('is empty with no snapshots', () => {
    expect(availableDisplayCurrencies([])).toEqual([])
  })
})
