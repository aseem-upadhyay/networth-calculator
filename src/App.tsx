import { lazy, Suspense, useEffect, useState } from 'react'
import { useSession } from './hooks/useSession'
import { logout } from './lib/auth'
import { fetchCurrencies, orderCurrencies } from './lib/fx'
import SignIn from './views/SignIn'
import Onboarding from './views/Onboarding'
import Setup from './views/Setup'
import SnapshotEditor from './views/SnapshotEditor'
import Footer from './components/Footer'
import Money from './components/Money'
// Recharts is ~150 kB gzipped and renders only once a snapshot exists, so it
// stays out of the sign-in path entirely.

// Dev-only chart harness (`?charts`). The ternary is what actually removes it:
// a bare `lazy(() => import(...))` at module scope still emits the chunk even
// when nothing reaches it, because the dynamic import is not inside the branch
// that import.meta.env.DEV constant-folds away.
const Admin = lazy(() => import('./views/Admin'))
const DeleteAccount = lazy(() => import('./views/DeleteAccount'))
const PortfolioView = lazy(() => import('./views/PortfolioView'))
const Portfolios = lazy(() => import('./views/Portfolios'))
const CombinedSummary = lazy(() => import('./components/CombinedSummary'))
const Categories = lazy(() => import('./views/Categories'))
const ImportBackup = lazy(() => import('./views/ImportBackup'))
import { useAdmin } from './hooks/useAdmin'
import { useRedacted } from './hooks/useRedacted'
import { buildBackup, downloadBackup, monthsUntilDue } from './lib/export'
import { availableDisplayCurrencies, combineTotals, kindLookup, snapshotAsOf } from './lib/calc'
import PortfolioCard from './components/PortfolioCard'
import { addCustomCategory, saveSnapshot, setDisplayCurrency } from './lib/repo'
import type { Snapshot } from './lib/types'

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

type View =
  | { name: 'dashboard' }
  | { name: 'portfolio'; id: string }
  | { name: 'portfolios' }
  | { name: 'editor'; portfolioId: string; editing?: Snapshot }
  | { name: 'categories' }
  | { name: 'import' }
  | { name: 'admin' }
  | { name: 'delete' }

export default function App() {
  const { session, setSession, refresh, refreshing } = useSession()
  const [view, setView] = useState<View>({ name: 'dashboard' })
  const [currencies, setCurrencies] = useState<Record<string, string>>({})
  const [redacted, toggleRedacted] = useRedacted()
  const isAdmin = useAdmin(session.status === 'ready' ? session.user : null)

  useEffect(() => {
    // Never rejects — falls back through localStorage to a hardcoded table.
    void fetchCurrencies().then(setCurrencies)
  }, [])

  switch (session.status) {
    case 'unconfigured':
      return <Setup />

    case 'loading':
      return <div className="centered"><p className="dim">Loading…</p></div>

    case 'signed-out':
      return <SignIn />

    case 'onboarding':
      return (
        <Onboarding
          user={session.user}
          // Must fetch, not fabricate. Setting {snapshots: [], categories: []}
          // here rendered a working account with an empty catalog, because the
          // 20 seeded categories were never read.
          onDone={() => {
            setSession({ status: 'loading' })
            void refresh()
          }}
        />
      )

    case 'error':
      return (
        <div className="centered">
          <div className="panel">
            <h1>Something went wrong</h1>
            <p className="dim small">{session.message}</p>
            <div className="row" style={{ marginTop: 16 }}>
              <button onClick={() => void refresh()}>Retry</button>
              <button onClick={() => void logout(null)}>Sign out</button>
            </div>
          </div>
        </div>
      )

    case 'ready': {
      const { profile, portfolios, snapshots: byFolio, categories, fetchedAt, user } = session
      const display = profile.displayCurrency
      const kinds = kindLookup(categories)

      if (!portfolios.length) {
        return (
          <div className="centered">
            <div className="panel">
              <h1>Setting things up</h1>
              <p className="dim small">
                This account predates portfolios and has not been migrated yet.
                Its data is safe and untouched.
              </p>
              <button onClick={() => void refresh()} disabled={refreshing} style={{ marginTop: 12 }}>
                {refreshing ? 'Checking…' : 'Check again'}
              </button>
            </div>
          </div>
        )
      }

      const allSnapshots = Object.values(byFolio).flat()
      const reachable = availableDisplayCurrencies(allSnapshots)
      const combined = combineTotals(portfolios, byFolio, kinds, display)
      const back = () => setView({ name: 'dashboard' })

      if (view.name === 'admin' && isAdmin) {
        return (
          <Suspense fallback={<div className="centered"><p className="dim">Loading…</p></div>}>
            <Admin user={user} onBack={back} />
          </Suspense>
        )
      }

      if (view.name === 'delete') {
        return (
          <Suspense fallback={<div className="centered"><p className="dim">Loading…</p></div>}>
            <DeleteAccount
              user={user} profile={profile} portfolios={portfolios}
              snapshots={byFolio} categories={categories} onCancel={back}
            />
          </Suspense>
        )
      }

      if (view.name === 'categories') {
        return (
          <Suspense fallback={<div className="centered"><p className="dim">Loading…</p></div>}>
            <Categories
              uid={user.uid} categories={categories} portfolios={portfolios}
              snapshots={byFolio} onChanged={() => void refresh()} onBack={back}
            />
          </Suspense>
        )
      }

      if (view.name === 'import') {
        return (
          <Suspense fallback={<div className="centered"><p className="dim">Loading…</p></div>}>
            <ImportBackup
              uid={user.uid} portfolios={portfolios} snapshots={byFolio}
              onDone={() => { setView({ name: 'dashboard' }); void refresh() }}
              onCancel={back}
            />
          </Suspense>
        )
      }

      if (view.name === 'portfolios') {
        return (
          <Suspense fallback={<div className="centered"><p className="dim">Loading…</p></div>}>
            <Portfolios
              uid={user.uid} portfolios={portfolios} timelines={byFolio}
              currencies={currencies} onChanged={() => void refresh()} onBack={back}
            />
          </Suspense>
        )
      }

      if (view.name === 'portfolio') {
        const p = portfolios.find((x) => x.id === view.id)
        if (!p) { setView({ name: 'dashboard' }); return null }
        return (
          <Suspense fallback={<div className="centered"><p className="dim">Loading…</p></div>}>
            <PortfolioView
              portfolio={p} timeline={byFolio[p.id] ?? []} categories={categories}
              displayCurrency={display} onBack={back}
              onEdit={(s) => setView({ name: 'editor', portfolioId: p.id, editing: s })}
              onNew={() => setView({ name: 'editor', portfolioId: p.id })}
            />
          </Suspense>
        )
      }

      if (view.name === 'editor') {
        const p = portfolios.find((x) => x.id === view.portfolioId)
        if (!p) { setView({ name: 'dashboard' }); return null }
        const timeline = byFolio[p.id] ?? []
        return (
          <SnapshotEditor
            portfolio={p}
            snapshots={timeline}
            categories={categories}
            currencies={currencies}
            editing={view.editing}
            persistence={{
              saveSnapshot: (draft, cats) =>
                saveSnapshot(user.uid, p.id, draft, cats, timeline)
                  .then((d) => ({ snapshots: d.snapshots[p.id] ?? [], categories: d.categories })),
              createCategory: async (c) => (await addCustomCategory(user.uid, {
                ...c, handle: profile.handle, categoriesCreated: profile.categoriesCreated,
              })).category,
            }}
            onCancel={() => setView({ name: 'portfolio', id: p.id })}
            onSaved={(data) => {
              setSession({
                ...session,
                snapshots: { ...byFolio, [p.id]: data.snapshots },
                categories: data.categories,
                fetchedAt: Date.now(),
              })
              setView({ name: 'portfolio', id: p.id })
            }}
          />
        )
      }

      const overdue = portfolios.filter((p) => {
        const latest = snapshotAsOf(byFolio[p.id] ?? [])
        return latest && monthsUntilDue(latest.asOfDate, p.cadenceMonths) <= 0
      })

      return (
        <div className="app">
          <header className="spread" style={{ marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1>Net Worth Calculator</h1>
              <p className="dim small toolbar" style={{ margin: 0 }}>
                <span>@{profile.handle} · showing</span>
                {/* Each snapshot converts through its own frozen rates, so this
                    re-expresses every folio's whole history, not just today. */}
                <select
                  value={display}
                  aria-label="Display currency"
                  style={{ width: 'auto', padding: '2px 6px', fontSize: 13 }}
                  onChange={(e) => {
                    const next = e.target.value
                    setSession({ ...session, profile: { ...profile, displayCurrency: next } })
                    void setDisplayCurrency(user.uid, next)
                  }}
                >
                  {orderCurrencies(currencies, display)
                    .filter((c) => !allSnapshots.length || reachable.includes(c.code))
                    .map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </select>
              </p>
            </div>
            <div className="stack-sm" style={{ textAlign: 'right' }}>
              <div className="row">
                <button onClick={() => void refresh()} disabled={refreshing}>
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
                <button onClick={() => setView({ name: 'portfolios' })}>Portfolios</button>
                <button onClick={() => setView({ name: 'categories' })}>Categories</button>
              </div>
              <div className="dim small">Updated {ago(fetchedAt)}</div>
            </div>
          </header>

          {overdue.length > 0 && (
            <div className="banner">
              An update is due for{' '}
              <strong>{overdue.map((p) => p.label).join(', ')}</strong>.
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <h2>Net worth</h2>
            <p className="num" style={{ fontSize: 32, margin: '0 0 4px' }}>
              <Money amount={combined.net} currency={display} />
            </p>
            <p className="dim small" style={{ margin: 0 }}>
              assets <Money amount={combined.assets} currency={display} /> ·
              liabilities <Money amount={combined.liabilities} currency={display} />
            </p>
            {/* Portfolios are valued on their own schedules, so a combined figure
                usually blends dates. Saying which is what makes it honest rather
                than falsely precise. */}
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

          {/* Hidden with a single folio: it would restate the card below it, and
              someone who never adds a second should not meet the concept. */}
          {portfolios.length > 1 && (
            <Suspense fallback={<div className="card dim small">Loading…</div>}>
              <div style={{ marginBottom: 16 }}>
                <CombinedSummary
                  portfolios={portfolios} timelines={byFolio}
                  categories={categories} displayCurrency={display}
                />
              </div>
            </Suspense>
          )}

          <div className="grid-cards" style={{ marginBottom: 16 }}>
            {portfolios.map((p) => (
              <PortfolioCard
                key={p.id} portfolio={p} timeline={byFolio[p.id] ?? []}
                kinds={kinds} displayCurrency={display}
                onOpen={() => setView({ name: 'portfolio', id: p.id })}
                onUpdate={() => setView({ name: 'editor', portfolioId: p.id })}
              />
            ))}
          </div>

          <div className="toolbar" style={{ marginTop: 4 }}>
            <button onClick={toggleRedacted} title="Blur every figure on screen">
              {redacted ? 'Show amounts' : 'Hide amounts'}
            </button>
            <button
              disabled={!allSnapshots.length}
              onClick={() => downloadBackup(buildBackup(profile, portfolios, byFolio, categories))}
              title="A year of snapshots cannot be reconstructed — keep a copy"
            >
              Export JSON
            </button>
            <button onClick={() => setView({ name: 'import' })}>Restore</button>
            {isAdmin && <button onClick={() => setView({ name: 'admin' })}>Admin</button>}
            <button
              onClick={() => setView({ name: 'delete' })}
              style={{ color: 'var(--negative)' }}
            >
              Delete account
            </button>
            <span className="dim small" style={{ marginLeft: 'auto' }}>
              {user.email} ·{' '}
              <button
                onClick={() => void logout(user.uid)}
                style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent)' }}
              >
                Sign out
              </button>
            </span>
          </div>

          <Footer />
        </div>
      )
    }
  }
}
