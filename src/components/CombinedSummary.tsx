import { useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { combineTotals, kindLookup, snapshotAsOf } from '../lib/calc'
import { convertBetween, formatMoney } from '../lib/money'
import { GROUP_LABEL, GROUP_ORDER, groupColor, surface } from '../lib/palette'
import { useDarkMode } from '../hooks/useDarkMode'
import Money from './Money'
import type { Category, CategoryGroup, Portfolio, Snapshot } from '../lib/types'

type Mode = 'merged' | 'byPortfolio'

/**
 * Allocation across every portfolio.
 *
 * Two questions, one card. **Merged** answers "what am I invested in" — equity
 * is equity whether it sits in Mumbai or Toronto. **By portfolio** answers
 * "where is it held", which is a currency- and jurisdiction-exposure question.
 * Merged leads because it is asked more often.
 *
 * Rendered only when a second portfolio exists. With one folio this would
 * restate the portfolio card directly above it, and someone who never creates a
 * second should never meet the concept at all.
 */
export default function CombinedSummary({
  portfolios, timelines, categories, displayCurrency,
}: {
  portfolios: Portfolio[]
  timelines: Record<string, Snapshot[]>
  categories: Category[]
  displayCurrency: string
}) {
  const dark = useDarkMode()
  const [mode, setMode] = useState<Mode>('merged')
  const bg = surface(dark)
  const kinds = useMemo(() => kindLookup(categories), [categories])

  const { merged, byPortfolio, assetTotal } = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const groupTotals = new Map<CategoryGroup, number>()
    const folioTotals: { key: string; label: string; value: number }[] = []
    let assets = 0

    for (const p of portfolios) {
      const snap = snapshotAsOf(timelines[p.id] ?? [])
      if (!snap) continue
      let folioAssets = 0

      for (const h of snap.holdings) {
        const meta = byId.get(h.categoryId)
        if (meta?.kind === 'liability') continue
        const v = convertBetween(
          h.amount, h.currency, displayCurrency, snap.fxRates, snap.baseCurrency,
        )
        const g = meta?.group ?? 'alternative'
        groupTotals.set(g, (groupTotals.get(g) ?? 0) + v)
        folioAssets += v
      }

      folioTotals.push({ key: p.id, label: p.label, value: folioAssets })
      assets += folioAssets
    }

    return {
      merged: GROUP_ORDER.filter((g) => groupTotals.has(g)).map((g) => ({
        key: g, label: GROUP_LABEL[g], group: g, value: groupTotals.get(g)!,
      })),
      byPortfolio: folioTotals.sort((a, b) => b.value - a.value),
      assetTotal: assets,
    }
  }, [portfolios, timelines, categories, displayCurrency])

  const totals = combineTotals(portfolios, timelines, kinds, displayCurrency)
  const slices = mode === 'merged' ? merged : byPortfolio

  // Portfolios are not a palette dimension — colour is keyed to group, and a
  // folio has no group. Ordered slots keep it stable per folio instead.
  const sliceColor = (i: number, s: { group?: CategoryGroup }) =>
    mode === 'merged' && s.group
      ? groupColor(s.group, dark)
      : groupColor(GROUP_ORDER[i % GROUP_ORDER.length], dark)

  if (!slices.length) return null

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Across all portfolios</h2>
        <div className="seg">
          <button className={mode === 'merged' ? 'on' : ''} onClick={() => setMode('merged')}>
            What I hold
          </button>
          <button className={mode === 'byPortfolio' ? 'on' : ''} onClick={() => setMode('byPortfolio')}>
            Where it is
          </button>
        </div>
      </div>
      <p className="dim small" style={{ marginTop: 0 }}>
        Assets <Money amount={assetTotal} currency={displayCurrency} /> ·
        liabilities <Money amount={totals.liabilities} currency={displayCurrency} />
      </p>

      <div className="chart-split">
        <div style={{ height: 220, minWidth: 0 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={slices} dataKey="value" nameKey="label"
                innerRadius="62%" outerRadius="92%"
                paddingAngle={1} stroke={bg} strokeWidth={2}
                isAnimationActive={false}
              >
                {slices.map((s, i) => (
                  <Cell key={s.key} fill={sliceColor(i, s as { group?: CategoryGroup })} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: bg, border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 13, color: 'var(--text)',
                }}
                formatter={(v) => formatMoney(Number(v), displayCurrency)}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="legend">
          {slices.map((s, i) => (
            <div key={s.key} className="legend-row">
              <span className="swatch" style={{ background: sliceColor(i, s as { group?: CategoryGroup }) }} />
              <span style={{ flex: 1 }}>{s.label}</span>
              <Money amount={s.value} currency={displayCurrency} />
              <span className="num dim" style={{ width: 52, textAlign: 'right' }}>
                {assetTotal > 0 ? ((s.value / assetTotal) * 100).toFixed(1) : '0.0'}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
