import { computeTotals, kindLookup } from '../lib/calc'
import type { Category, FxRates, Portfolio, Profile, Snapshot } from '../lib/types'

/**
 * Fictional data for the demo. Nothing here belongs to anyone.
 *
 * Chosen to exercise the things that are hard to show with one flat snapshot:
 * four valuation dates at uneven spacing, holdings in three currencies, a
 * liability being paid down, categories that appear partway through, and a
 * position whose rupee value climbed while its actual return was negative.
 */
export const DEMO_PROFILE: Profile = {
  handle: 'demo',
  email: 'demo@example.com',
  displayCurrency: 'INR',
  categoriesCreated: 0,
  schemaVersion: 2,
}

export const DEMO_PORTFOLIO: Portfolio = {
  id: 'main', label: 'Main', region: 'IN', baseCurrency: 'INR',
  cadenceMonths: 12, order: 0,
}

export const DEMO_CATEGORIES: Category[] = [
  { id: 'mutual-funds', label: 'Mutual Funds', kind: 'asset', group: 'equity', regions: ['GLOBAL'], tier: 'global' },
  { id: 'direct-equity', label: 'Direct Equity', kind: 'asset', group: 'equity', regions: ['GLOBAL'], tier: 'global' },
  { id: 'esop-rsu', label: 'ESOP / RSU', kind: 'asset', group: 'equity', regions: ['GLOBAL'], tier: 'global' },
  { id: 'epf', label: 'EPF', kind: 'asset', group: 'debt', regions: ['IN'], tier: 'global' },
  { id: 'ppf', label: 'PPF', kind: 'asset', group: 'debt', regions: ['IN'], tier: 'global' },
  { id: 'fixed-deposits', label: 'Fixed & Recurring Deposits', kind: 'asset', group: 'debt', regions: ['GLOBAL'], tier: 'global' },
  { id: 'bonds', label: 'Bonds', kind: 'asset', group: 'debt', regions: ['GLOBAL'], tier: 'global' },
  { id: 'gold', label: 'Gold', kind: 'asset', group: 'commodity', regions: ['GLOBAL'], tier: 'global' },
  { id: 'real-estate', label: 'Real Estate', kind: 'asset', group: 'real-estate', regions: ['GLOBAL'], tier: 'global' },
  { id: 'crypto', label: 'Crypto', kind: 'asset', group: 'alternative', regions: ['GLOBAL'], tier: 'global' },
  { id: 'savings-account', label: 'Savings Account', kind: 'asset', group: 'cash', regions: ['GLOBAL'], tier: 'global' },
  { id: 'cash', label: 'Cash', kind: 'asset', group: 'cash', regions: ['GLOBAL'], tier: 'global' },
  { id: 'nps', label: 'NPS', kind: 'asset', group: 'debt', regions: ['IN'], tier: 'global' },
  { id: '401k', label: '401(k)', kind: 'asset', group: 'equity', regions: ['US'], tier: 'global' },
  { id: 'roth-ira', label: 'Roth IRA', kind: 'asset', group: 'equity', regions: ['US'], tier: 'global' },
  { id: 'espp', label: 'ESPP', kind: 'asset', group: 'equity', regions: ['US'], tier: 'global' },
  { id: 'hsa', label: 'HSA', kind: 'asset', group: 'debt', regions: ['US'], tier: 'global' },
  { id: 'treasury-bonds', label: 'Treasury / I-Bonds', kind: 'asset', group: 'debt', regions: ['US'], tier: 'global' },
  { id: 'home-loan', label: 'Home Loan', kind: 'liability', group: 'liability', regions: ['GLOBAL'], tier: 'global' },
  { id: 'car-loan', label: 'Car Loan', kind: 'liability', group: 'liability', regions: ['GLOBAL'], tier: 'global' },
  { id: 'credit-card', label: 'Credit Card Outstanding', kind: 'liability', group: 'liability', regions: ['GLOBAL'], tier: 'global' },
]

/**
 * Real ECB tables for the fixture dates, fetched from Frankfurter.
 *
 * Hand-written two-currency tables made the demo crash the moment a viewer's
 * locale resolved to a third. Real snapshots carry the full ~30-currency table
 * the API returns, so the fixtures do too — which is also what lets the demo be
 * re-based into any of them.
 *
 * BGN is present in the 2022-2024 tables and absent by 2026, because Bulgaria
 * joined the euro. The retired-currency case turns up here on its own.
 */
const RATES: Record<string, FxRates> = {
  '2022-03-31': { AUD: 0.01763, BGN: 0.02325, BRL: 0.06301, CAD: 0.01652, CHF: 0.0122, CNY: 0.08368, CZK: 0.28973, DKK: 0.08841, EUR: 0.01189, GBP: 0.01006, HKD: 0.10331, HRK: 0.09003, HUF: 4.3952, IDR: 189.55, ILS: 0.04189, ISK: 1.6879, JPY: 1.6067, KRW: 16.0153, MXN: 0.26257, MYR: 0.05548, NOK: 0.11543, NZD: 0.01903, PHP: 0.68363, PLN: 0.05531, RON: 0.05879, SEK: 0.12287, SGD: 0.01786, THB: 0.43874, TRY: 0.19354, USD: 0.0132, ZAR: 0.19223 },
  '2023-03-31': { AUD: 0.0182, BGN: 0.02188, BRL: 0.0617, CAD: 0.01648, CHF: 0.01115, CNY: 0.08363, CZK: 0.26277, DKK: 0.08332, EUR: 0.01119, GBP: 0.00983, HKD: 0.09549, HUF: 4.245, IDR: 182.33, ILS: 0.04394, ISK: 1.6588, JPY: 1.62, KRW: 15.8866, MXN: 0.21968, MYR: 0.05368, NOK: 0.12745, NZD: 0.01945, PHP: 0.66051, PLN: 0.05224, RON: 0.05536, SEK: 0.12618, SGD: 0.01618, THB: 0.41511, TRY: 0.23337, USD: 0.01216, ZAR: 0.21619 },
  '2024-09-30': { AUD: 0.01723, BGN: 0.02085, BRL: 0.0645, CAD: 0.01613, CHF: 0.01006, CNY: 0.08369, CZK: 0.26846, DKK: 0.07948, EUR: 0.01066, GBP: 0.00891, HKD: 0.09267, HUF: 4.2307, IDR: 180.96, ILS: 0.04423, ISK: 1.6064, JPY: 1.7037, KRW: 15.6605, MXN: 0.23435, MYR: 0.04921, NOK: 0.12541, NZD: 0.01878, PHP: 0.6688, PLN: 0.04561, RON: 0.05304, SEK: 0.12046, SGD: 0.01529, THB: 0.3849, TRY: 0.40794, USD: 0.01193, ZAR: 0.20494 },
  '2026-03-31': { AUD: 0.01547, BRL: 0.05568, CAD: 0.01485, CHF: 0.00852, CNY: 0.07355, CZK: 0.22723, DKK: 0.06927, EUR: 0.00927, GBP: 0.00805, HKD: 0.08355, HUF: 3.5677, IDR: 180.81, ILS: 0.03372, ISK: 1.3311, JPY: 1.6999, KRW: 16.2516, MXN: 0.19197, MYR: 0.04315, NOK: 0.10393, NZD: 0.0186, PHP: 0.64683, PLN: 0.03976, RON: 0.04727, SEK: 0.10144, SGD: 0.01373, THB: 0.34916, TRY: 0.47407, USD: 0.01066, ZAR: 0.18193 },
}

const snap = (
  asOfDate: string,
  note: string | undefined,
  holdings: [string, number, string?, number?][],
): Snapshot => ({
  asOfDate,
  recordedAt: Date.parse(`${asOfDate}T09:00:00Z`),
  updatedAt: Date.parse(`${asOfDate}T09:00:00Z`),
  baseCurrency: 'INR',
  fxRates: RATES[asOfDate],
  fxAsOf: asOfDate,
  fxSource: 'frankfurter',
  note,
  holdings: holdings.map(([categoryId, amount, currency = 'INR', contributed = 0]) => ({
    categoryId, amount, currency, contributed,
  })),
  // Computed, not hand-written. Firestore snapshots carry denormalized totals
  // written at save time, so a fixture with zeros here renders a ₹0 headline
  // beside charts that recompute from holdings and disagree.
  totals: { assets: 0, liabilities: 0, net: 0 },
})

/** Fill in each fixture's denormalized totals the same way a real save would. */
function withTotals(snapshots: Snapshot[], categories: Category[]): Snapshot[] {
  const kinds = kindLookup(categories)
  return snapshots.map((s) => ({
    ...s,
    totals: computeTotals(s.holdings, kinds, s.fxRates, s.baseCurrency),
  }))
}

const RAW_SNAPSHOTS: Snapshot[] = [
  snap('2022-03-31', 'first time tracking this properly', [
    ['mutual-funds', 1_250_000], ['epf', 720_000], ['ppf', 410_000],
    ['savings-account', 380_000], ['gold', 290_000], ['real-estate', 5_800_000],
    ['home-loan', 4_600_000], ['car-loan', 380_000],
  ]),
  snap('2023-03-31', undefined, [
    ['mutual-funds', 1_920_000, 'INR', 420_000], ['epf', 1_010_000, 'INR', 230_000],
    ['ppf', 570_000, 'INR', 150_000], ['savings-account', 445_000],
    ['gold', 355_000], ['real-estate', 6_400_000],
    ['esop-rsu', 18_000, 'USD', 18_000],
    ['home-loan', 4_280_000], ['car-loan', 210_000],
  ]),
  snap('2024-09-30', 'switched jobs', [
    ['mutual-funds', 3_140_000, 'INR', 660_000], ['direct-equity', 540_000, 'INR', 450_000],
    ['epf', 1_480_000, 'INR', 290_000], ['ppf', 760_000, 'INR', 150_000],
    ['nps', 320_000, 'INR', 300_000], ['savings-account', 610_000],
    ['gold', 520_000], ['real-estate', 7_050_000],
    ['esop-rsu', 39_000, 'USD', 15_000], ['crypto', 145_000, 'INR', 120_000],
    ['home-loan', 3_820_000],
  ]),
  snap('2026-03-31', 'bought a second property', [
    ['mutual-funds', 4_780_000, 'INR', 820_000], ['direct-equity', 1_020_000, 'INR', 260_000],
    ['epf', 2_060_000, 'INR', 400_000], ['ppf', 980_000, 'INR', 150_000],
    ['nps', 690_000, 'INR', 260_000], ['bonds', 450_000, 'INR', 450_000],
    ['fixed-deposits', 600_000, 'INR', 600_000],
    ['savings-account', 720_000], ['cash', 60_000],
    ['gold', 810_000], ['real-estate', 11_900_000],
    // Up in rupee terms, but most of that is fresh vesting plus a weaker rupee —
    // the delta table separates the three, which is the whole point of the app.
    ['esop-rsu', 61_000, 'USD', 21_000],
    ['crypto', 205_000],
    ['home-loan', 6_950_000], ['credit-card', 84_000],
  ]),
]

export const DEMO_SNAPSHOTS: Snapshot[] = withTotals(RAW_SNAPSHOTS, DEMO_CATEGORIES)

/**
 * A second, USD-kept portfolio, on its own dates.
 *
 * Deliberately valued in different months from the India folio: that offset is
 * the whole reason portfolios have separate timelines, and the combined figure
 * showing "blended" provenance is a feature to demonstrate, not a wrinkle to
 * hide. Real ECB tables again, base USD.
 */
const US_RATES: Record<string, FxRates> = {
  '2023-06-30': { AUD: 1.5091, BGN: 1.7999, BRL: 4.8581, CAD: 1.3266, CHF: 0.90079, CNY: 7.2688, CZK: 21.85, DKK: 6.8539, EUR: 0.9203, GBP: 0.78988, HKD: 7.837, HUF: 342.29, IDR: 15079, ILS: 3.7259, INR: 82.1, ISK: 136.85, JPY: 144.63, KRW: 1321.44, MXN: 17.0821, MYR: 4.6675, NOK: 10.7712, NZD: 1.6435, PHP: 55.294, PLN: 4.085, RON: 4.5679, SEK: 10.8646, SGD: 1.3558, THB: 35.415, TRY: 26.062, ZAR: 18.938 },
  '2024-12-31': { AUD: 1.6144, BGN: 1.8826, BRL: 6.1847, CAD: 1.4388, CHF: 0.90596, CNY: 7.2994, CZK: 24.242, DKK: 7.1786, EUR: 0.96256, GBP: 0.79813, HKD: 7.7665, HUF: 395.95, IDR: 16191, ILS: 3.6466, INR: 85.6, ISK: 138.51, JPY: 156.95, KRW: 1474.78, MXN: 20.743, MYR: 4.4715, NOK: 11.3534, NZD: 1.7838, PHP: 58.043, PLN: 4.1149, RON: 4.788, SEK: 11.0299, SGD: 1.3634, THB: 34.34, TRY: 35.361, ZAR: 18.8842 },
  '2026-06-30': { AUD: 1.452, BRL: 5.1784, CAD: 1.4236, CHF: 0.80955, CNY: 6.7855, CZK: 21.288, DKK: 6.5599, EUR: 0.87765, GBP: 0.75635, HKD: 7.8418, HUF: 312.71, IDR: 17903, ILS: 2.9799, INR: 94.66, ISK: 126.38, JPY: 162.44, KRW: 1550.89, MXN: 17.468, MYR: 4.085, NOK: 9.9267, NZD: 1.7672, PHP: 61.358, PLN: 3.77, RON: 4.6023, SEK: 9.7363, SGD: 1.2949, THB: 33.23, TRY: 46.66, ZAR: 16.3721 },
}

export const DEMO_PORTFOLIO_US: Portfolio = {
  id: 'us', label: 'United States', region: 'US', baseCurrency: 'USD',
  cadenceMonths: 12, order: 1,
}

const usSnap = (
  asOfDate: string,
  note: string | undefined,
  holdings: [string, number, string?, number?][],
): Snapshot => ({
  asOfDate,
  recordedAt: Date.parse(`${asOfDate}T09:00:00Z`),
  updatedAt: Date.parse(`${asOfDate}T09:00:00Z`),
  baseCurrency: 'USD',
  fxRates: US_RATES[asOfDate],
  fxAsOf: asOfDate,
  fxSource: 'frankfurter',
  note,
  holdings: holdings.map(([categoryId, amount, currency = 'USD', contributed = 0]) => ({
    categoryId, amount, currency, contributed,
  })),
  totals: { assets: 0, liabilities: 0, net: 0 },
})

export const DEMO_SNAPSHOTS_US: Snapshot[] = withTotals([
  usSnap('2023-06-30', 'started the US job', [
    ['401k', 42_000, 'USD', 22_000], ['savings-account', 18_000],
  ]),
  usSnap('2024-12-31', undefined, [
    ['401k', 71_000, 'USD', 23_000], ['roth-ira', 14_000, 'USD', 13_000],
    ['savings-account', 26_000], ['espp', 9_000, 'USD', 8_000],
    ['credit-card', 3_200],
  ]),
  usSnap('2026-06-30', 'moved some cash into treasuries', [
    ['401k', 118_000, 'USD', 34_000], ['roth-ira', 31_000, 'USD', 14_000],
    ['treasury-bonds', 25_000, 'USD', 24_000],
    ['savings-account', 21_000], ['espp', 16_000, 'USD', 4_000],
    ['hsa', 8_400, 'USD', 6_000],
    ['credit-card', 1_900],
  ]),
], DEMO_CATEGORIES)
