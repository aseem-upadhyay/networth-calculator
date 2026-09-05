import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { availableDisplayCurrencies, combineTotals, computeTotals, kindLookup } from '../lib/calc'
import { slugify } from '../lib/cache'
import { fetchCurrencies, guessCurrency, orderCurrencies } from '../lib/fx'
import type { SnapshotDraft } from '../lib/repo'
import SnapshotEditor from '../views/SnapshotEditor'
import Footer from '../components/Footer'
import {
  DEMO_CATEGORIES, DEMO_PORTFOLIO, DEMO_PORTFOLIO_US, DEMO_SNAPSHOTS, DEMO_SNAPSHOTS_US,
} from './demoData'
import PortfolioCard from '../components/PortfolioCard'
import Money from '../components/Money'
import type { Category, Snapshot } from '../lib/types'

const CombinedSummary = lazy(() => import('../components/CombinedSummary'))
const PortfolioView = lazy(() => import('../views/PortfolioView'))

type View =
  | { name: 'dashboard' }
  | { name: 'portfolio'; id: string }
  | { name: 'editor'; portfolioId: string; editing?: Snapshot }

/**
 * A fully interactive demo with no sign-in and no persistence.
 *
 * Everything lives in React state: edits, new snapshots, new categories all
 * work and the charts recompute, but nothing is written anywhere and a reload
 * restores the fixtures. Firebase is never initialised — the demo path calls no
 * repo function, so the SDK's lazy init never fires and an unconfigured build
 * can still run the whole tour.
 *
 * It exists because the alternative for showing the app was signing in and
 * putting real balances on a screen in front of other people.
 */
export default function DemoApp({ onExit }: { onExit: () => void }) {
  const portfolios = [DEMO_PORTFOLIO, DEMO_PORTFOLIO_US]
  const [timelines, setTimelines] = useState<Record<string, Snapshot[]>>({
    [DEMO_PORTFOLIO.id]: DEMO_SNAPSHOTS,
    [DEMO_PORTFOLIO_US.id]: DEMO_SNAPSHOTS_US,
  })
  const [categories, setCategories] = useState<Category[]>(DEMO_CATEGORIES)
  const [view, setView] = useState<View>({ name: 'dashboard' })
  const [currencies, setCurrencies] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)
  const [preferred, setDisplay] = useState(guessCurrency('INR'))

  useEffect(() => { void fetchCurrencies().then(setCurrencies) }, [])

  const allSnapshots = useMemo(() => Object.values(timelines).flat(), [timelines])
  const reachable = useMemo(() => availableDisplayCurrencies(allSnapshots), [allSnapshots])
  const display = reachable.includes(preferred) ? preferred : (reachable[0] ?? preferred)
  const kinds = useMemo(() => kindLookup(categories), [categories])
  const combined = combineTotals(portfolios, timelines, kinds, display)

  function reset() {
    setTimelines({
      [DEMO_PORTFOLIO.id]: DEMO_SNAPSHOTS,
      [DEMO_PORTFOLIO_US.id]: DEMO_SNAPSHOTS_US,
    })
    setCategories(DEMO_CATEGORIES)
    setDirty(false)
    setView({ name: 'dashboard' })
  }

  const persistenceFor = (portfolioId: string) => ({
    // Same shape the Firestore-backed version returns, so the editor cannot tell
    // the difference — it just never leaves memory.
    saveSnapshot: async (draft: SnapshotDraft, cats: Category[]) => {
      const totals = computeTotals(
        draft.holdings, kindLookup(cats), draft.fxRates, draft.baseCurrency,
      )
      const saved: Snapshot = { ...draft, totals, recordedAt: Date.now(), updatedAt: Date.now() }
      const next = [...(timelines[portfolioId] ?? []).filter((s) => s.asOfDate !== draft.asOfDate), saved]
        .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
      setTimelines((t) => ({ ...t, [portfolioId]: next }))
      setCategories(cats)
      setDirty(true)
      return { snapshots: next, categories: cats }
    },
    createCategory: async (c: {
      slug: string; label: string; kind: Category['kind']
      group: Category['group']; regions: string[]
    }) => {
      const category: Category = {
        id: c.slug || slugify(c.label), label: c.label, kind: c.kind, group: c.group,
        regions: c.regions, tier: 'custom',
      }
      setCategories((cs) => [...cs, category].sort((a, b) => a.label.localeCompare(b.label)))
      setDirty(true)
      return category
    },
  })

  const bar = <DemoBanner dirty={dirty} onReset={reset} onExit={onExit} />

  if (view.name === 'editor') {
    const p = portfolios.find((x) => x.id === view.portfolioId)!
    return (
      <>
        {bar}
        <SnapshotEditor
          portfolio={p}
          snapshots={timelines[p.id] ?? []}
          categories={categories}
          currencies={currencies}
          editing={view.editing}
          persistence={persistenceFor(p.id)}
          onSaved={() => setView({ name: 'portfolio', id: p.id })}
          onCancel={() => setView({ name: 'portfolio', id: p.id })}
        />
      </>
    )
  }

  if (view.name === 'portfolio') {
    const p = portfolios.find((x) => x.id === view.id)!
    return (
      <>
        {bar}
        <Suspense fallback={<div className="centered"><p className="dim">Loading…</p></div>}>
          <PortfolioView
            portfolio={p} timeline={timelines[p.id] ?? []} categories={categories}
            displayCurrency={display}
            onBack={() => setView({ name: 'dashboard' })}
            onEdit={(s) => setView({ name: 'editor', portfolioId: p.id, editing: s })}
            onNew={() => setView({ name: 'editor', portfolioId: p.id })}
          />
        </Suspense>
      </>
    )
  }

  return (
    <>
      {bar}
      <div className="app">
        <header className="spread" style={{ marginBottom: 24 }}>
          <div>
            <h1>Net Worth Calculator</h1>
            <p className="dim small toolbar" style={{ margin: 0 }}>
              <span>@demo · showing</span>
              <select
                value={display}
                aria-label="Display currency"
                style={{ width: 'auto', padding: '2px 6px', fontSize: 13 }}
                onChange={(e) => setDisplay(e.target.value)}
              >
                {orderCurrencies(currencies, display)
                  .filter((c) => reachable.includes(c.code))
                  .map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </p>
          </div>
        </header>

        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Net worth</h2>
          <p className="num" style={{ fontSize: 32, margin: '0 0 4px' }}>
            <Money amount={combined.net} currency={display} />
          </p>
          <p className="dim small" style={{ margin: 0 }}>
            assets <Money amount={combined.assets} currency={display} /> ·
            liabilities <Money amount={combined.liabilities} currency={display} />
          </p>
          {combined.blended && (
            <p className="dim small" style={{ margin: '8px 0 0' }}>
              Blended:{' '}
              {portfolios
                .filter((p) => combined.provenance[p.id])
                .map((p) => `${p.label} as of ${combined.provenance[p.id]}`)
                .join(' · ')}
            </p>
          )}
        </div>

        <Suspense fallback={<div className="card dim small">Loading…</div>}>
          <div style={{ marginBottom: 16 }}>
            <CombinedSummary
              portfolios={portfolios} timelines={timelines}
              categories={categories} displayCurrency={display}
            />
          </div>
        </Suspense>

        <div className="grid-cards">
          {portfolios.map((p) => (
            <PortfolioCard
              key={p.id} portfolio={p} timeline={timelines[p.id] ?? []}
              kinds={kinds} displayCurrency={display}
              onOpen={() => setView({ name: 'portfolio', id: p.id })}
              onUpdate={() => setView({ name: 'editor', portfolioId: p.id })}
            />
          ))}
        </div>

        <Footer />
      </div>
    </>
  )
}

function DemoBanner({
  dirty, onReset, onExit,
}: { dirty: boolean; onReset: () => void; onExit: () => void }) {
  return (
    <div className="demo-bar">
      <span>
        <strong>Demo</strong> — fictional data. Edit anything you like; nothing is
        saved and a reload starts over.
      </span>
      <span className="toolbar" style={{ marginLeft: 'auto' }}>
        {dirty && <button onClick={onReset}>Reset</button>}
        <button onClick={onExit}>Sign in</button>
      </span>
    </div>
  )
}
