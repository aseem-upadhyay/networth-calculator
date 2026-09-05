import { computeTotals, snapshotAsOf, type Kinds } from '../lib/calc'
import { monthsUntilDue } from '../lib/export'
import Money from './Money'
import type { Portfolio, Snapshot } from '../lib/types'

/**
 * One portfolio's summary.
 *
 * Shows its figure twice on purpose (Q8): the native currency it is actually
 * kept in, which is what its owner thinks in, and the display currency, which is
 * what makes it comparable with the other folios. Staleness is per-portfolio too
 * — an India folio being overdue says nothing about a US one.
 */
export default function PortfolioCard({
  portfolio, timeline, kinds, displayCurrency, onOpen, onUpdate,
}: {
  portfolio: Portfolio
  timeline: Snapshot[]
  kinds: Kinds
  displayCurrency: string
  onOpen: () => void
  onUpdate: () => void
}) {
  const latest = snapshotAsOf(timeline)
  const showBoth = portfolio.baseCurrency !== displayCurrency

  const native = latest
    ? computeTotals(latest.holdings, kinds, latest.fxRates, latest.baseCurrency).net
    : 0
  const converted = latest
    ? computeTotals(
        latest.holdings, kinds, latest.fxRates, latest.baseCurrency, displayCurrency,
      ).net
    : 0

  const months = latest ? monthsUntilDue(latest.asOfDate, portfolio.cadenceMonths) : 0
  const overdue = latest !== undefined && months <= 0

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="spread" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <h2 style={{ margin: 0 }}>{portfolio.label}</h2>
            {portfolio.region && <span className="tag">{portfolio.region}</span>}
          </div>

          {latest ? (
            <>
              <p className="num" style={{ fontSize: 24, margin: '6px 0 2px' }}>
                <Money amount={native} currency={portfolio.baseCurrency} />
              </p>
              {showBoth && (
                <p className="dim small" style={{ margin: '0 0 2px' }}>
                  <Money amount={converted} currency={displayCurrency} /> in {displayCurrency}
                </p>
              )}
              <p className={`small ${overdue ? 'warn' : 'dim'}`} style={{ margin: 0 }}>
                as of {latest.asOfDate}
                {overdue
                  ? ' · an update is due'
                  : ` · next due in about ${Math.max(1, Math.round(months))} months`}
              </p>
            </>
          ) : (
            <p className="dim small" style={{ margin: '6px 0 0' }}>
              No snapshots yet.
            </p>
          )}
        </div>

        <div className="row actions">
          {latest && <button onClick={onOpen}>View</button>}
          <button className={latest ? '' : 'btn-primary'} onClick={onUpdate}>
            {latest ? 'Update' : 'Add first snapshot'}
          </button>
        </div>
      </div>
    </div>
  )
}
