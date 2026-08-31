import Breakup from '../components/Breakup'
import Growth from '../components/Growth'
import DeltaTable from '../components/DeltaTable'
import type { Category, Snapshot } from '../lib/types'

/**
 * Dev-only fixture harness: `?charts` in development.
 *
 * Charts have to be looked at, not just typechecked, and the real dashboard sits
 * behind Google sign-in. This renders every state that matters — multi-currency,
 * liabilities, a category that appears late, a retired currency — against fixed
 * data. Gated on import.meta.env.DEV, so it is stripped from production builds.
 */
const cats: Category[] = [
  { id: 'mutual-funds', label: 'Mutual Funds', kind: 'asset', group: 'equity', tier: 'global' },
  { id: 'direct-equity', label: 'Direct Equity', kind: 'asset', group: 'equity', tier: 'global' },
  { id: 'esop-rsu', label: 'ESOP / RSU', kind: 'asset', group: 'equity', tier: 'global' },
  { id: 'epf', label: 'EPF', kind: 'asset', group: 'debt', tier: 'global' },
  { id: 'fixed-deposits', label: 'Fixed Deposits', kind: 'asset', group: 'debt', tier: 'global' },
  { id: 'gold', label: 'Gold', kind: 'asset', group: 'commodity', tier: 'global' },
  { id: 'real-estate', label: 'Real Estate', kind: 'asset', group: 'real-estate', tier: 'global' },
  { id: 'crypto', label: 'Crypto', kind: 'asset', group: 'alternative', tier: 'global' },
  { id: 'savings-account', label: 'Savings Account', kind: 'asset', group: 'cash', tier: 'global' },
  { id: 'home-loan', label: 'Home Loan', kind: 'liability', group: 'liability', tier: 'global' },
]

const snap = (
  asOfDate: string,
  usd: number,
  holdings: [string, number, string?, number?][],
): Snapshot => ({
  asOfDate,
  recordedAt: 1, updatedAt: 1,
  baseCurrency: 'INR',
  fxRates: { USD: usd, EUR: usd * 0.8 },
  fxAsOf: asOfDate, fxSource: 'frankfurter',
  holdings: holdings.map(([categoryId, amount, currency = 'INR', contributed = 0]) => ({
    categoryId, amount, currency, contributed,
  })),
  totals: { assets: 0, liabilities: 0, net: 0 },
})

const snapshots: Snapshot[] = [
  snap('2023-03-31', 0.01220, [
    ['mutual-funds', 1_800_000], ['epf', 900_000], ['savings-account', 400_000],
    ['gold', 350_000], ['real-estate', 6_500_000], ['home-loan', 4_200_000],
  ]),
  snap('2024-03-31', 0.01199, [
    ['mutual-funds', 2_600_000, 'INR', 400_000], ['epf', 1_250_000, 'INR', 240_000],
    ['savings-account', 520_000], ['gold', 430_000], ['real-estate', 7_100_000],
    ['esop-rsu', 22_000, 'USD', 22_000], ['home-loan', 3_900_000],
  ]),
  snap('2025-03-31', 0.01168, [
    ['mutual-funds', 3_500_000, 'INR', 480_000], ['direct-equity', 700_000, 'INR', 600_000],
    ['epf', 1_650_000, 'INR', 260_000], ['fixed-deposits', 800_000, 'INR', 800_000],
    ['savings-account', 610_000], ['gold', 620_000], ['real-estate', 7_800_000],
    ['esop-rsu', 41_000, 'USD', 14_000], ['crypto', 180_000, 'INR', 150_000],
    ['home-loan', 3_550_000],
  ]),
  snap('2026-08-31', 0.01134, [
    ['mutual-funds', 4_900_000, 'INR', 700_000], ['direct-equity', 1_150_000, 'INR', 300_000],
    ['epf', 2_180_000, 'INR', 380_000], ['fixed-deposits', 900_000, 'INR', 50_000],
    ['savings-account', 740_000], ['gold', 910_000], ['real-estate', 8_600_000],
    ['esop-rsu', 58_000, 'USD', 19_000], ['crypto', 240_000],
    ['home-loan', 3_100_000],
  ]),
]

export default function ChartPreview() {
  const latest = snapshots.at(-1)!
  return (
    <div className="app">
      <h1>Chart fixtures</h1>
      <p className="dim small">
        Dev-only. Four snapshots, INR base, USD RSUs, one liability, two
        categories that appear late.
      </p>
      <div style={{ display: 'grid', gap: 16, marginTop: 20 }}>
        <Breakup snapshot={latest} categories={cats} />
        <Growth snapshots={snapshots} categories={cats} />
        <DeltaTable snapshots={snapshots} categories={cats} />
      </div>
    </div>
  )
}
