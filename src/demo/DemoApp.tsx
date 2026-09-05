import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { computeTotals, kindLookup } from '../lib/calc'
import { slugify } from '../lib/cache'
import { fetchCurrencies } from '../lib/fx'
import { formatMoney } from '../lib/money'
import type { SnapshotDraft } from '../lib/repo'
import SnapshotEditor from '../views/SnapshotEditor'
import Footer from '../components/Footer'
import { DEMO_CATEGORIES, DEMO_PROFILE, DEMO_SNAPSHOTS } from './demoData'
import type { Category, Snapshot } from '../lib/types'

const Breakup = lazy(() => import('../components/Breakup'))
const Growth = lazy(() => import('../components/Growth'))
const DeltaTable = lazy(() => import('../components/DeltaTable'))

type View = { name: 'dashboard' } | { name: 'editor'; editing?: Snapshot }

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
  const [snapshots, setSnapshots] = useState<Snapshot[]>(DEMO_SNAPSHOTS)
  const [categories, setCategories] = useState<Category[]>(DEMO_CATEGORIES)
  const [view, setView] = useState<View>({ name: 'dashboard' })
  const [currencies, setCurrencies] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState(false)

  useEffect(() => { void fetchCurrencies().then(setCurrencies) }, [])

  const latest = snapshots.at(-1)

  const persistence = useMemo(() => ({
    // Same shape the Firestore-backed version returns, so the editor cannot
    // tell the difference — it just never leaves memory.
    saveSnapshot: async (draft: SnapshotDraft, cats: Category[]) => {
      const totals = computeTotals(
        draft.holdings, kindLookup(cats), draft.fxRates, draft.baseCurrency,
      )
      const saved: Snapshot = {
        ...draft, totals, recordedAt: Date.now(), updatedAt: Date.now(),
      }
      const next = [...snapshots.filter((s) => s.asOfDate !== draft.asOfDate), saved]
        .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
      setSnapshots(next)
      setCategories(cats)
      setDirty(true)
      return { snapshots: next, categories: cats }
    },
    createCategory: async (c: { slug: string; label: string; kind: Category['kind']; group: Category['group'] }) => {
      const category: Category = {
        id: c.slug || slugify(c.label), label: c.label, kind: c.kind, group: c.group, tier: 'custom',
      }
      setCategories((cs) => [...cs, category].sort((a, b) => a.label.localeCompare(b.label)))
      setDirty(true)
      return category
    },
  }), [snapshots])

  if (view.name === 'editor') {
    return (
      <>
        <DemoBanner dirty={dirty} onReset={reset} onExit={onExit} />
        <SnapshotEditor
          profile={DEMO_PROFILE}
          snapshots={snapshots}
          categories={categories}
          currencies={currencies}
          editing={view.editing}
          persistence={persistence}
          onSaved={({ snapshots: s, categories: c }) => {
            setSnapshots(s); setCategories(c); setView({ name: 'dashboard' })
          }}
          onCancel={() => setView({ name: 'dashboard' })}
        />
      </>
    )
  }

  function reset() {
    setSnapshots(DEMO_SNAPSHOTS)
    setCategories(DEMO_CATEGORIES)
    setDirty(false)
    setView({ name: 'dashboard' })
  }

  return (
    <>
      <DemoBanner dirty={dirty} onReset={reset} onExit={onExit} />
      <div className="app">
        <header className="spread" style={{ marginBottom: 24 }}>
          <div>
            <h1>Net Worth Calculator</h1>
            <p className="dim small" style={{ margin: 0 }}>
              @demo · reporting in INR · {categories.length} categories
            </p>
          </div>
          <button className="btn-primary" onClick={() => setView({ name: 'editor' })}>
            New snapshot
          </button>
        </header>

        {latest && (
          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Net worth</h2>
            <p className="num" style={{ fontSize: 32, margin: '0 0 4px' }}>
              {formatMoney(latest.totals.net || 0, latest.baseCurrency)}
            </p>
            <p className="dim small" style={{ margin: 0 }}>
              as of {latest.asOfDate} · {latest.holdings.length} holdings
            </p>
          </div>
        )}

        {latest && (
          <Suspense fallback={<div className="card dim small">Loading charts…</div>}>
            <div style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
              <Breakup snapshot={latest} categories={categories} />
              <Growth snapshots={snapshots} categories={categories} />
              <DeltaTable snapshots={snapshots} categories={categories} />
            </div>
          </Suspense>
        )}

        <div className="card">
          <h2>History</h2>
          <ul className="checklist">
            {[...snapshots].reverse().map((s) => (
              <li key={s.asOfDate}>
                <span style={{ flex: 1 }}>
                  <strong>{s.asOfDate}</strong>
                  {s.note && <span className="dim"> · {s.note}</span>}
                </span>
                <button
                  onClick={() => setView({ name: 'editor', editing: s })}
                  style={{ padding: '2px 10px', fontSize: 13 }}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
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
