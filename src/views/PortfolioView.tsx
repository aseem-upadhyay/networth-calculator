import { lazy, Suspense } from 'react'
import { computeTotals, kindLookup, verifyTotals } from '../lib/calc'
import Money from '../components/Money'
import type { Category, Portfolio, Snapshot } from '../lib/types'

const Breakup = lazy(() => import('../components/Breakup'))
const Growth = lazy(() => import('../components/Growth'))
const DeltaTable = lazy(() => import('../components/DeltaTable'))

/** One portfolio's own history: composition, growth, and where the change came from. */
export default function PortfolioView({
  portfolio, timeline, categories, displayCurrency, onBack, onEdit, onNew,
}: {
  portfolio: Portfolio
  timeline: Snapshot[]
  categories: Category[]
  displayCurrency: string
  onBack: () => void
  onEdit: (s: Snapshot) => void
  onNew: () => void
}) {
  const kinds = kindLookup(categories)
  const latest = timeline.at(-1)

  // Totals are denormalized at save time and can drift from the holdings they
  // claim to summarise. Recomputing is cheap; silently charting a stale figure
  // is not (PLAN.md §3).
  const drifted = timeline.filter((s) => !verifyTotals(s, kinds).storedAgrees)

  return (
    <div className="app">
      <div className="spread" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <div className="spread" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <h1 style={{ margin: 0 }}>{portfolio.label}</h1>
            {portfolio.region && <span className="tag">{portfolio.region}</span>}
          </div>
          <p className="dim small" style={{ margin: 0 }}>
            kept in {portfolio.baseCurrency} · every {portfolio.cadenceMonths} months
          </p>
        </div>
        <div className="row actions">
          <button onClick={onBack}>All portfolios</button>
          <button className="btn-primary" onClick={onNew}>New snapshot</button>
        </div>
      </div>

      {drifted.length > 0 && (
        <div className="banner">
          {drifted.length} snapshot{drifted.length === 1 ? '' : 's'} had a stored total
          that disagreed with its holdings. The figures shown are recomputed from
          the holdings, which are the source of truth. Re-saving will correct the
          stored value.
        </div>
      )}

      {latest && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Net worth</h2>
          <p className="num" style={{ fontSize: 30, margin: '0 0 4px' }}>
            <Money
              amount={computeTotals(
                latest.holdings, kinds, latest.fxRates, latest.baseCurrency, displayCurrency,
              ).net}
              currency={displayCurrency}
            />
          </p>
          <p className="dim small" style={{ margin: 0 }}>
            as of {latest.asOfDate} · {latest.holdings.length} holdings
          </p>
        </div>
      )}

      {latest && (
        <Suspense fallback={<div className="card dim small">Loading charts…</div>}>
          <div className="stack" style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
            <Breakup snapshot={latest} categories={categories} displayCurrency={displayCurrency} />
            <Growth snapshots={timeline} categories={categories} displayCurrency={displayCurrency} />
            <DeltaTable snapshots={timeline} categories={categories} displayCurrency={displayCurrency} />
          </div>
        </Suspense>
      )}

      <div className="card">
        <h2>History</h2>
        {timeline.length === 0 && <p className="dim small" style={{ margin: 0 }}>Nothing recorded yet.</p>}
        <ul className="checklist">
          {[...timeline].reverse().map((s) => (
            <li key={s.asOfDate}>
              <span style={{ flex: 1 }}>
                <strong>{s.asOfDate}</strong>
                {s.note && <span className="dim"> · {s.note}</span>}
              </span>
              <Money
                amount={computeTotals(
                  s.holdings, kinds, s.fxRates, s.baseCurrency, displayCurrency,
                ).net}
                currency={displayCurrency}
              />
              <button onClick={() => onEdit(s)} style={{ padding: '2px 10px', fontSize: 13 }}>
                Edit
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
