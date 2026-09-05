import { useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { convertBetween, formatMoney } from '../lib/money'
import { GROUP_LABEL, GROUP_ORDER, groupColor, surface } from '../lib/palette'
import { useDarkMode } from '../hooks/useDarkMode'
import Money from './Money'
import type { Category, CategoryGroup, Snapshot } from '../lib/types'

interface Slice {
  key: string
  label: string
  group: CategoryGroup
  value: number
  share: number
}

/**
 * Composition of the latest snapshot.
 *
 * The donut shows **groups**, not categories: a part-to-whole ring stops being
 * readable past about six segments, and there are twenty-odd categories. The
 * six asset groups fit exactly. Category-level detail is a sorted bar chart —
 * the right form for comparing many values — plus the table, which also
 * supplies the contrast relief the light palette requires.
 *
 * Liabilities never enter the donut. A negative arc in a part-to-whole chart is
 * meaningless, so they get their own block.
 */
export default function Breakup({
  snapshot, categories, displayCurrency,
}: {
  snapshot: Snapshot
  categories: Category[]
  /** Report in this currency; the snapshot's own frozen rates do the conversion. */
  displayCurrency?: string
}) {
  const dark = useDarkMode()
  const [byCategory, setByCategory] = useState(false)
  const base = displayCurrency ?? snapshot.baseCurrency
  const bg = surface(dark)

  const { groups, cats, liabilities, assetTotal, liabilityTotal } = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const catRows: Slice[] = []
    const liabRows: Slice[] = []
    const groupTotals = new Map<CategoryGroup, number>()

    for (const h of snapshot.holdings) {
      const meta = byId.get(h.categoryId)
      const value = convertBetween(
        h.amount, h.currency, base, snapshot.fxRates, snapshot.baseCurrency,
      )
      const group = meta?.group ?? 'alternative'
      const row: Slice = {
        key: h.categoryId, label: meta?.label ?? h.categoryId, group, value, share: 0,
      }
      if (meta?.kind === 'liability') { liabRows.push(row); continue }
      catRows.push(row)
      groupTotals.set(group, (groupTotals.get(group) ?? 0) + value)
    }

    const assets = catRows.reduce((a, r) => a + r.value, 0)
    const liabs = liabRows.reduce((a, r) => a + r.value, 0)
    const share = (v: number) => (assets > 0 ? v / assets : 0)

    return {
      // Fixed group order, so on-screen adjacency matches what the palette
      // validator checked — and so a group keeps its colour as values move.
      groups: GROUP_ORDER.filter((g) => groupTotals.has(g)).map((g) => ({
        key: g, label: GROUP_LABEL[g], group: g,
        value: groupTotals.get(g)!, share: share(groupTotals.get(g)!),
      })),
      cats: catRows.map((r) => ({ ...r, share: share(r.value) }))
        .sort((a, b) => b.value - a.value),
      liabilities: liabRows.sort((a, b) => b.value - a.value),
      assetTotal: assets,
      liabilityTotal: liabs,
    }
  }, [snapshot, categories, base])

  const slices = byCategory ? cats : groups
  const maxValue = Math.max(...slices.map((s) => s.value), 1)

  if (!slices.length) return null

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Breakup</h2>
        <div className="seg">
          <button className={!byCategory ? 'on' : ''} onClick={() => setByCategory(false)}>
            By group
          </button>
          <button className={byCategory ? 'on' : ''} onClick={() => setByCategory(true)}>
            By category
          </button>
        </div>
      </div>
      <p className="dim small" style={{ marginTop: 0 }}>
        Assets as of {snapshot.asOfDate} · <Money amount={assetTotal} currency={base} />
      </p>

      {!byCategory ? (
        <div className="chart-split">
          <div style={{ height: 240, minWidth: 0 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={groups} dataKey="value" nameKey="label"
                  innerRadius="62%" outerRadius="92%"
                  // 2px of surface between touching marks, per the mark spec.
                  paddingAngle={1} stroke={bg} strokeWidth={2}
                  isAnimationActive={false}
                >
                  {groups.map((g) => (
                    <Cell key={g.key} fill={groupColor(g.group, dark)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: bg, border: '1px solid var(--border)',
                    borderRadius: 8, fontSize: 13, color: 'var(--text)',
                  }}
                  formatter={(v) => formatMoney(Number(v), base)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <Legend rows={groups} base={base} dark={dark} />
        </div>
      ) : (
        <div className="bars">
          {cats.map((c) => (
            <div key={c.key} className="bar-row">
              <span className="bar-label">{c.label}</span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{
                    width: `${Math.max((c.value / maxValue) * 100, 1.5)}%`,
                    background: groupColor(c.group, dark),
                  }}
                />
              </span>
              <span className="num bar-value">{formatMoney(c.value, base)}</span>
              <span className="num dim bar-share">{(c.share * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}

      {liabilities.length > 0 && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div className="spread">
            <h2 style={{ margin: 0 }}>Liabilities</h2>
            <span className="num">{formatMoney(liabilityTotal, base)}</span>
          </div>
          <div className="bars" style={{ marginTop: 8 }}>
            {liabilities.map((l) => (
              <div key={l.key} className="bar-row">
                <span className="bar-label">{l.label}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{
                    width: `${Math.max((l.value / Math.max(liabilityTotal, 1)) * 100, 1.5)}%`,
                    background: groupColor('liability', dark),
                  }} />
                </span>
                <span className="num bar-value">{formatMoney(l.value, base)}</span>
                <span className="num dim bar-share" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Identity is never colour alone: swatch plus written label, always. */
function Legend({ rows, base, dark }: { rows: Slice[]; base: string; dark: boolean }) {
  return (
    <div className="legend">
      {rows.map((r) => (
        <div key={r.key} className="legend-row">
          <span className="swatch" style={{ background: groupColor(r.group, dark) }} />
          <span style={{ flex: 1 }}>{r.label}</span>
          <span className="num">{formatMoney(r.value, base)}</span>
          <span className="num dim" style={{ width: 52, textAlign: 'right' }}>
            {(r.share * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}
