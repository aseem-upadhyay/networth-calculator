import { lazy, Suspense, useEffect, useState } from 'react'
import { useSession } from './hooks/useSession'
import { logout } from './lib/auth'
import { fetchCurrencies } from './lib/fx'
import { formatMoney } from './lib/money'
import SignIn from './views/SignIn'
import Onboarding from './views/Onboarding'
import Setup from './views/Setup'
import SnapshotEditor from './views/SnapshotEditor'
// Recharts is ~150 kB gzipped and renders only once a snapshot exists, so it
// stays out of the sign-in path entirely.
const Breakup = lazy(() => import('./components/Breakup'))
const Growth = lazy(() => import('./components/Growth'))
const DeltaTable = lazy(() => import('./components/DeltaTable'))

// Dev-only chart harness (`?charts`). The ternary is what actually removes it:
// a bare `lazy(() => import(...))` at module scope still emits the chunk even
// when nothing reaches it, because the dynamic import is not inside the branch
// that import.meta.env.DEV constant-folds away.
const ChartPreview = import.meta.env.DEV ? lazy(() => import('./dev/ChartPreview')) : null
const Admin = lazy(() => import('./views/Admin'))
import { useAdmin } from './hooks/useAdmin'
import { useRedacted } from './hooks/useRedacted'
import { buildBackup, downloadBackup, monthsUntilDue } from './lib/export'
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
  | { name: 'editor'; editing?: Snapshot }
  | { name: 'admin' }

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

  if (ChartPreview && new URLSearchParams(location.search).has('charts')) {
    return <Suspense fallback={null}><ChartPreview /></Suspense>
  }

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
      const { profile, snapshots, categories, fetchedAt, user } = session
      const latest = snapshots.at(-1)

      if (view.name === 'admin' && isAdmin) {
        return (
          <Suspense fallback={<div className="centered"><p className="dim">Loading…</p></div>}>
            <Admin user={user} onBack={() => setView({ name: 'dashboard' })} />
          </Suspense>
        )
      }

      if (view.name === 'editor') {
        return (
          <SnapshotEditor
            uid={user.uid}
            profile={profile}
            snapshots={snapshots}
            categories={categories}
            currencies={currencies}
            editing={view.editing}
            onCancel={() => setView({ name: 'dashboard' })}
            onSaved={(data) => {
              setSession({ ...session, ...data, fetchedAt: Date.now() })
              setView({ name: 'dashboard' })
            }}
          />
        )
      }

      return (
        <div className="app">
          <header className="spread" style={{ marginBottom: 24 }}>
            <div>
              <h1>Net Worth Calculator</h1>
              <p className="dim small" style={{ margin: 0 }}>
                @{profile.handle} · reporting in {profile.baseCurrency} ·{' '}
                {categories.length} categories
              </p>
            </div>
            <div className="stack-sm" style={{ textAlign: 'right' }}>
              <div className="row">
                <button onClick={() => void refresh()} disabled={refreshing}>
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
                <button className="btn-primary" onClick={() => setView({ name: 'editor' })}>
                  {latest ? 'New snapshot' : 'Add your first snapshot'}
                </button>
              </div>
              {/* Tab-scoped cache, so "open in new tab" is a silent path to
                  stale numbers. Keep the age visible, not tucked away. */}
              <div className="dim small">Updated {ago(fetchedAt)}</div>
            </div>
          </header>

          {latest && (() => {
            const months = monthsUntilDue(latest.asOfDate, profile.cadenceMonths)
            if (months > 0.5) return null
            return (
              <div className="banner">
                {months <= 0
                  ? <>Your last snapshot is from <strong>{latest.asOfDate}</strong> — an update is due.</>
                  : <>Next update due in about {Math.round(months * 4.3)} weeks.</>}
              </div>
            )
          })()}

          <div className="card" style={{ marginBottom: 16 }}>
            {latest ? (
              <>
                <h2>Net worth</h2>
                <p className="num" style={{ fontSize: 32, margin: '0 0 4px' }}>
                  {formatMoney(latest.totals.net, latest.baseCurrency)}
                </p>
                <p className="dim small" style={{ margin: 0 }}>
                  as of {latest.asOfDate} · {latest.holdings.length} holdings ·
                  assets {formatMoney(latest.totals.assets, latest.baseCurrency)} ·
                  liabilities {formatMoney(latest.totals.liabilities, latest.baseCurrency)}
                </p>
              </>
            ) : (
              <>
                <h2>No snapshots yet</h2>
                <p className="dim small" style={{ margin: 0 }}>
                  Record what you own and owe today. Growth charts need two
                  snapshots, so backdating an older one is worth the ten minutes.
                </p>
              </>
            )}
          </div>

          {latest && (
            <Suspense fallback={<div className="card dim small">Loading charts…</div>}>
              <div style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
                <Breakup snapshot={latest} categories={categories} />
                <Growth snapshots={snapshots} categories={categories} />
                <DeltaTable snapshots={snapshots} categories={categories} />
              </div>
            </Suspense>
          )}

          {snapshots.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h2>History</h2>
              <ul className="checklist">
                {[...snapshots].reverse().map((s) => (
                  <li key={s.asOfDate}>
                    <span style={{ flex: 1 }}>
                      <strong>{s.asOfDate}</strong>
                      {s.note && <span className="dim"> · {s.note}</span>}
                    </span>
                    <span className="num">{formatMoney(s.totals.net, s.baseCurrency)}</span>
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
          )}

          <div className="toolbar" style={{ marginTop: 4 }}>
            <button onClick={toggleRedacted} title="Blur every figure on screen">
              {redacted ? 'Show amounts' : 'Hide amounts'}
            </button>
            <button
              disabled={!snapshots.length}
              onClick={() => downloadBackup(buildBackup(profile, snapshots, categories))}
              title="A year of snapshots cannot be reconstructed — keep a copy"
            >
              Export JSON
            </button>
            {isAdmin && <button onClick={() => setView({ name: 'admin' })}>Admin</button>}
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
        </div>
      )
    }
  }
}
