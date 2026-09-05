import { useMemo } from 'react'
import { computeDeltas, daysBetween } from '../lib/calc'
import { formatMoney, formatPercent } from '../lib/money'
import { groupColor } from '../lib/palette'
import { useDarkMode } from '../hooks/useDarkMode'
import Money from './Money'
import type { Category, Snapshot } from '../lib/types'

const sign = (v: number) => (v > 0.5 ? 'pos' : v < -0.5 ? 'neg' : '')

/**
 * Where the change actually came from.
 *
 * A single "growth" number conflates three unrelated things, so this splits it:
 *
 *     change  =  contributed  +  FX effect  +  return
 *
 * Return is the residual, which makes that identity hold exactly rather than
 * approximately. `Return %` is modified Dietz computed in constant currency, so
 * a weakening rupee never reads as investment skill — and it is blank wherever
 * there was no opening value, because a new holding has no return, not an
 * infinite one.
 *
 * This table is also the contrast relief the light palette requires: every
 * number carried by a chart colour appears here as text.
 */
export default function DeltaTable({
  snapshots, categories, displayCurrency,
}: {
  snapshots: Snapshot[]
  categories: Category[]
  displayCurrency?: string
}) {
  const dark = useDarkMode()
  const [prev, curr] = [snapshots.at(-2), snapshots.at(-1)]

  const { assets, liabilities } = useMemo(() => {
    if (!prev || !curr) return { assets: [], liabilities: [] }
    const meta = new Map(categories.map((c) => [c.id, c]))
    const all = computeDeltas(prev, curr, displayCurrency).map((d) => ({
      ...d,
      label: meta.get(d.categoryId)?.label ?? d.categoryId,
      group: meta.get(d.categoryId)?.group ?? 'alternative',
      isLiability: meta.get(d.categoryId)?.kind === 'liability',
    }))
    return {
      assets: all.filter((r) => !r.isLiability),
      liabilities: all.filter((r) => r.isLiability),
    }
  }, [prev, curr, categories, displayCurrency])

  if (!prev || !curr) return null

  const base = displayCurrency ?? curr.baseCurrency
  const days = daysBetween(prev.asOfDate, curr.asOfDate)
  const anyFx = assets.some((r) => Math.abs(r.fxEffect) > 0.5)

  const sum = (rs: typeof assets, k: 'change' | 'contributed' | 'fxEffect' | 'investmentReturn') =>
    rs.reduce((a, r) => a + r[k], 0)

  // Liabilities subtract. Summing them alongside assets would report a smaller
  // gain for having repaid debt, which is backwards.
  const netChange = sum(assets, 'change') - sum(liabilities, 'change')
  const debtRepaid = -sum(liabilities, 'change')

  return (
    <div className="card">
      <h2>Change since {prev.asOfDate}</h2>
      <p className="dim small" style={{ marginTop: 0 }}>
        {Math.round(days)} days. Change splits into what you put in, what the
        currency did, and what the holdings actually earned.
      </p>

      <div className="chart-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Category</th>
              <th>Was</th>
              <th>Now</th>
              <th>Change</th>
              <th>Added</th>
              {anyFx && <th>FX</th>}
              <th>Return</th>
              <th>Return %</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((r) => (
              <tr key={r.categoryId}>
                <td>
                  <span className="dot" style={{ background: groupColor(r.group, dark) }} />
                  {r.label}
                  {!r.exact && <span className="dim" title="a currency was retired; used the frozen rate"> *</span>}
                </td>
                <td className="num">{r.start ? formatMoney(r.start, base) : '—'}</td>
                <td className="num">{formatMoney(r.end, base)}</td>
                <td className={`num ${sign(r.change)}`}>{formatMoney(r.change, base)}</td>
                <td className="num">{r.contributed ? formatMoney(r.contributed, base) : '—'}</td>
                {anyFx && (
                  <td className={`num ${sign(r.fxEffect)}`}>
                    {Math.abs(r.fxEffect) > 0.5 ? formatMoney(r.fxEffect, base) : '—'}
                  </td>
                )}
                <td className={`num ${sign(r.investmentReturn)}`}>
                  {formatMoney(r.investmentReturn, base)}
                </td>
                <td className={`num ${r.returnRate === null ? '' : sign(r.returnRate)}`}>
                  {formatPercent(r.returnRate)}
                </td>
              </tr>
            ))}
          </tbody>
          {liabilities.length > 0 && (
            <tbody>
              <tr>
                <td colSpan={anyFx ? 8 : 7} className="dim" style={{ paddingTop: 14, fontSize: 12 }}>
                  Liabilities — a falling balance raises net worth, so the signs
                  below read the other way. &ldquo;Return&rdquo; is not a meaningful
                  quantity on a loan.
                </td>
              </tr>
              {liabilities.map((r) => (
                <tr key={r.categoryId}>
                  <td>
                    <span className="dot" style={{ background: groupColor('liability', dark) }} />
                    {r.label}
                  </td>
                  <td className="num">{r.start ? formatMoney(r.start, base) : '—'}</td>
                  <td className="num">{formatMoney(r.end, base)}</td>
                  {/* Sign inverted: paying down debt is a gain. */}
                  <td className={`num ${sign(-r.change)}`}>{formatMoney(r.change, base)}</td>
                  <td className="num">—</td>
                  {anyFx && <td className="num">{Math.abs(r.fxEffect) > 0.5 ? formatMoney(r.fxEffect, base) : '—'}</td>}
                  <td className="num">—</td>
                  <td className="num">—</td>
                </tr>
              ))}
            </tbody>
          )}
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td><strong>Net worth</strong></td>
              <td /><td />
              <td className={`num ${sign(netChange)}`}><strong>{formatMoney(netChange, base)}</strong></td>
              <td className="num">{formatMoney(sum(assets, 'contributed'), base)}</td>
              {anyFx && <td className={`num ${sign(sum(assets, 'fxEffect'))}`}>{formatMoney(sum(assets, 'fxEffect'), base)}</td>}
              <td className={`num ${sign(sum(assets, 'investmentReturn'))}`}>
                {formatMoney(sum(assets, 'investmentReturn'), base)}
              </td>
              <td />
            </tr>
            {debtRepaid !== 0 && (
              <tr>
                <td className="dim small" colSpan={anyFx ? 8 : 7}>
                  Includes <Money amount={Math.abs(debtRepaid)} currency={base} /> of debt{' '}
                  {debtRepaid > 0 ? 'repaid' : 'taken on'}.
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      <p className="dim small" style={{ marginBottom: 0, marginTop: 10 }}>
        Return % is modified Dietz, assuming contributions landed mid-period — a
        snapshot records the period total, not when the money actually arrived,
        so treat it as close rather than exact.
      </p>
    </div>
  )
}
