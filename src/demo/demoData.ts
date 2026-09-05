import { computeTotals, kindLookup } from '../lib/calc'
import type { Category, Profile, Snapshot } from '../lib/types'

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
  baseCurrency: 'INR',
  cadenceMonths: 12,
  categoriesCreated: 0,
  schemaVersion: 1,
}

export const DEMO_CATEGORIES: Category[] = [
  { id: 'mutual-funds', label: 'Mutual Funds', kind: 'asset', group: 'equity', tier: 'global' },
  { id: 'direct-equity', label: 'Direct Equity', kind: 'asset', group: 'equity', tier: 'global' },
  { id: 'esop-rsu', label: 'ESOP / RSU', kind: 'asset', group: 'equity', tier: 'global' },
  { id: 'epf', label: 'EPF', kind: 'asset', group: 'debt', tier: 'global' },
  { id: 'ppf', label: 'PPF', kind: 'asset', group: 'debt', tier: 'global' },
  { id: 'fixed-deposits', label: 'Fixed & Recurring Deposits', kind: 'asset', group: 'debt', tier: 'global' },
  { id: 'bonds', label: 'Bonds', kind: 'asset', group: 'debt', tier: 'global' },
  { id: 'gold', label: 'Gold', kind: 'asset', group: 'commodity', tier: 'global' },
  { id: 'real-estate', label: 'Real Estate', kind: 'asset', group: 'real-estate', tier: 'global' },
  { id: 'crypto', label: 'Crypto', kind: 'asset', group: 'alternative', tier: 'global' },
  { id: 'savings-account', label: 'Savings Account', kind: 'asset', group: 'cash', tier: 'global' },
  { id: 'cash', label: 'Cash', kind: 'asset', group: 'cash', tier: 'global' },
  { id: 'nps', label: 'NPS', kind: 'asset', group: 'debt', tier: 'global' },
  { id: 'home-loan', label: 'Home Loan', kind: 'liability', group: 'liability', tier: 'global' },
  { id: 'car-loan', label: 'Car Loan', kind: 'liability', group: 'liability', tier: 'global' },
  { id: 'credit-card', label: 'Credit Card Outstanding', kind: 'liability', group: 'liability', tier: 'global' },
]

const snap = (
  asOfDate: string,
  rates: Record<string, number>,
  note: string | undefined,
  holdings: [string, number, string?, number?][],
): Snapshot => ({
  asOfDate,
  recordedAt: Date.parse(`${asOfDate}T09:00:00Z`),
  updatedAt: Date.parse(`${asOfDate}T09:00:00Z`),
  baseCurrency: 'INR',
  fxRates: rates,
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
  snap('2022-03-31', { USD: 0.01318, EUR: 0.01185 }, 'first time tracking this properly', [
    ['mutual-funds', 1_250_000], ['epf', 720_000], ['ppf', 410_000],
    ['savings-account', 380_000], ['gold', 290_000], ['real-estate', 5_800_000],
    ['home-loan', 4_600_000], ['car-loan', 380_000],
  ]),
  snap('2023-03-31', { USD: 0.01216, EUR: 0.01120 }, undefined, [
    ['mutual-funds', 1_920_000, 'INR', 420_000], ['epf', 1_010_000, 'INR', 230_000],
    ['ppf', 570_000, 'INR', 150_000], ['savings-account', 445_000],
    ['gold', 355_000], ['real-estate', 6_400_000],
    ['esop-rsu', 18_000, 'USD', 18_000],
    ['home-loan', 4_280_000], ['car-loan', 210_000],
  ]),
  snap('2024-09-30', { USD: 0.01193, EUR: 0.01071 }, 'switched jobs', [
    ['mutual-funds', 3_140_000, 'INR', 660_000], ['direct-equity', 540_000, 'INR', 450_000],
    ['epf', 1_480_000, 'INR', 290_000], ['ppf', 760_000, 'INR', 150_000],
    ['nps', 320_000, 'INR', 300_000], ['savings-account', 610_000],
    ['gold', 520_000], ['real-estate', 7_050_000],
    ['esop-rsu', 39_000, 'USD', 15_000], ['crypto', 145_000, 'INR', 120_000],
    ['home-loan', 3_820_000],
  ]),
  snap('2026-03-31', { USD: 0.01134, EUR: 0.01048 }, 'bought a second property', [
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
