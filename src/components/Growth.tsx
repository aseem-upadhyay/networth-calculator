import { useMemo, useState } from 'react'
import {
  Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { buildSeries } from '../lib/calc'
import { convertBetween, formatMoney } from '../lib/money'
import { GROUP_LABEL, GROUP_ORDER, groupColor, surface } from '../lib/palette'
import { useDarkMode } from '../hooks/useDarkMode'
import type { Category, CategoryGroup, Snapshot } from '../lib/types'

type Mode = 'absolute' | 'share'

/**
 * Value over time, stacked by group.
 *
 * Series are groups rather than categories for the same reason the donut is:
 * past about seven colour classes adjacent bands stop being separable. The
 * per-category numbers live in the delta table below.
 *
 * The x-axis is **time-scaled, not evenly spaced by index** — a six-month gap
 * and an eighteen-month gap must not look identical, which is exactly what an
 * index axis would do at this cadence.
 */
export default function Growth({
  snapshots, categories, displayCurrency,
}: {
  snapshots: Snapshot[]
  categories: Category[]
  displayCurrency?: string
}) {
  const dark = useDarkMode()
  const [mode, setMode] = useState<Mode>('absolute')
  const [constant, setConstant] = useState(false)

  const base = displayCurrency ?? snapshots.at(-1)!.baseCurrency
  const bg = surface(dark)

  const { points, groups, exact } = useMemo(() => {
    const groupOf = new Map(categories.map((c) => [c.id, c.group]))
    const { points: raw, exact } = buildSeries(snapshots, {
      constantCurrency: constant, displayCurrency: base,
    })
    const seen = new Set<CategoryGroup>()

    const rows = raw.map((p, i) => {
      const snap = [...snapshots].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))[i]
      const rates = constant ? snapshots.at(-1)!.fxRates : snap.fxRates
      const rateBase = constant ? snapshots.at(-1)!.baseCurrency : snap.baseCurrency
      const out: Record<string, number | string> = { asOfDate: p.asOfDate, t: p.t }
      let total = 0

      for (const h of snap.holdings) {
        const g = groupOf.get(h.categoryId) ?? 'alternative'
        let v: number
        try {
          v = convertBetween(h.amount, h.currency, base, rates, rateBase)
        } catch {
          v = convertBetween(h.amount, h.currency, base, snap.fxRates, snap.baseCurrency)
        }
        // Liabilities subtract from net worth but cannot be a stacked band —
        // they are tracked into the net line instead.
        if (g === 'liability') { total -= v; continue }
        seen.add(g)
        out[g] = ((out[g] as number) ?? 0) + v
        total += v
      }
      out.net = total
      return out
    })

    const groups = GROUP_ORDER.filter((g) => g !== 'liability' && seen.has(g))
    for (const r of rows) for (const g of groups) if (r[g] === undefined) r[g] = 0

    if (mode === 'share') {
      for (const r of rows) {
        const sum = groups.reduce((a, g) => a + (r[g] as number), 0) || 1
        for (const g of groups) r[g] = ((r[g] as number) / sum) * 100
      }
    }
    return { points: rows, groups, exact }
  }, [snapshots, categories, constant, mode, base])

  if (snapshots.length < 2) {
    return (
      <div className="card">
        <h2>Growth</h2>
        <p className="dim small" style={{ margin: 0 }}>
          Needs a second snapshot. Backdating one — the editor pulls that day&apos;s
          actual ECB rates — makes this useful now rather than next year.
        </p>
      </div>
    )
  }

  const fmtAxis = (v: number) =>
    mode === 'share' ? `${Math.round(v)}%` : formatMoney(v, base, { compact: true })

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Growth by group</h2>
        <div className="row seg-group">
          <div className="seg">
            <button className={mode === 'absolute' ? 'on' : ''} onClick={() => setMode('absolute')}>
              Value
            </button>
            <button className={mode === 'share' ? 'on' : ''} onClick={() => setMode('share')}>
              Share
            </button>
          </div>
          <div className="seg">
            <button className={!constant ? 'on' : ''} onClick={() => setConstant(false)}>
              As reported
            </button>
            <button className={constant ? 'on' : ''} onClick={() => setConstant(true)}>
              Constant currency
            </button>
          </div>
        </div>
      </div>
      <p className="dim small" style={{ marginTop: 0 }}>
        {constant
          ? 'Every snapshot revalued at the latest rates, so currency movement is stripped out.'
          : 'Each snapshot at its own frozen rates — what actually happened, FX included.'}
        {!exact && ' Some rates were unavailable and fell back to the frozen ones.'}
      </p>

      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={points.map((p) => p.t as number)}
              tickFormatter={(t: number) => new Date(t).toISOString().slice(0, 7)}
              tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
              stroke="var(--border)"
            />
            <YAxis
              tickFormatter={fmtAxis}
              tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
              stroke="var(--border)"
              width={72}
            />
            <Tooltip
              contentStyle={{
                background: bg, border: '1px solid var(--border)',
                borderRadius: 8, fontSize: 13, color: 'var(--text)',
              }}
              labelFormatter={(t) => new Date(Number(t)).toISOString().slice(0, 10)}
              formatter={(v, n) => [
                mode === 'share' ? `${Number(v).toFixed(1)}%` : formatMoney(Number(v), base),
                n === 'net' ? 'Net worth' : GROUP_LABEL[n as CategoryGroup] ?? String(n),
              ]}
            />
            {groups.map((g) => (
              <Area
                key={g} dataKey={g} stackId="1" type="linear"
                fill={groupColor(g, dark)} stroke={bg} strokeWidth={2}
                fillOpacity={1} isAnimationActive={false}
              />
            ))}
            {mode === 'absolute' && (
              <Line
                dataKey="net" type="linear" dot={{ r: 4, strokeWidth: 2, stroke: bg }}
                stroke="var(--text)" strokeWidth={2} isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="legend" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
        {groups.map((g) => (
          <span key={g} className="legend-row" style={{ padding: 0 }}>
            <span className="swatch" style={{ background: groupColor(g, dark) }} />
            {GROUP_LABEL[g]}
          </span>
        ))}
        {mode === 'absolute' && (
          <span className="legend-row" style={{ padding: 0 }}>
            <span className="swatch" style={{ background: 'var(--text)' }} />
            Net worth
          </span>
        )}
      </div>
    </div>
  )
}
