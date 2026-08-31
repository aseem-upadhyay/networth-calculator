import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  approveProposal, loadAdminStats, loadProposals, rejectProposal,
  type AdminStats,
} from '../lib/repo'
import { formatMoney } from '../lib/money'
import type { CategoryProposal } from '../lib/types'

/**
 * Admin console. Gated on the `admin` custom claim.
 *
 * Hiding the route is a convenience, not the boundary — the rules are, and they
 * hold whatever JS the browser runs. Nothing here can reach a handle, an email,
 * or anyone's holdings.
 */
export default function Admin({ user, onBack }: { user: User; onBack: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [proposals, setProposals] = useState<CategoryProposal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // No synchronous setState here: the effect below runs it on mount, and
  // clearing the error inline would cost an extra render pass every load.
  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([loadAdminStats(), loadProposals()])
      setStats(s)
      setProposals(p)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // False positive: load()'s first statement is an await, so it yields before
  // any setState. Fetching on mount is what an effect is for.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function act(p: CategoryProposal, approve: boolean) {
    setBusy(p.id)
    try {
      if (approve) await approveProposal(p, user.uid)
      else await rejectProposal(p.id, user.uid, 'not a distinct category')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const pending = proposals.filter((p) => p.status === 'pending')
  const decided = proposals.filter((p) => p.status !== 'pending')

  return (
    <div className="app">
      <div className="spread" style={{ marginBottom: 20 }}>
        <h1>Admin</h1>
        <button onClick={onBack}>Back</button>
      </div>

      {error && <p className="error small">{error}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Accounts</h2>
        {!stats ? <p className="dim small">Loading…</p> : (
          <div className="spread" style={{ justifyContent: 'flex-start', gap: 40 }}>
            <Stat label="Created" value={String(stats.created)} />
            <Stat label="With a snapshot" value={String(stats.active)} />
            <Stat
              label="Never saved"
              value={String(stats.created - stats.active)}
              hint="signed up, then stopped"
            />
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Net worth by currency</h2>
        <p className="dim small" style={{ marginTop: 0 }}>
          Aggregates only — no identities, and never converted across currencies.
        </p>
        {!stats?.byCurrency.length ? (
          <p className="dim small" style={{ margin: 0 }}>No snapshots yet.</p>
        ) : (
          <div className="chart-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Currency</th><th>Accounts</th><th>Total</th>
                  <th>Median</th><th>Low</th><th>High</th>
                </tr>
              </thead>
              <tbody>
                {stats.byCurrency.map((c) => (
                  <tr key={c.currency}>
                    <td>{c.currency}</td>
                    <td className="num">{c.accounts}</td>
                    <td className="num">{formatMoney(c.total, c.currency)}</td>
                    <td className="num">{formatMoney(c.median, c.currency)}</td>
                    <td className="num">{formatMoney(c.min, c.currency)}</td>
                    <td className="num">{formatMoney(c.max, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Category proposals</h2>
        {!pending.length && <p className="dim small">Nothing pending.</p>}
        {pending.map((p) => (
          <div key={p.id} className="spread" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div>
              <strong>{p.label}</strong>{' '}
              <code>{p.id}</code>
              <div className="dim small">
                {p.kind} · {p.group} · by @{p.proposedByHandle}
              </div>
            </div>
            <div className="row" style={{ flex: '0 0 auto' }}>
              <button onClick={() => void act(p, false)} disabled={busy === p.id}>Reject</button>
              <button className="btn-primary" onClick={() => void act(p, true)} disabled={busy === p.id}>
                Approve
              </button>
            </div>
          </div>
        ))}

        {decided.length > 0 && (
          <details style={{ marginTop: 14 }}>
            <summary className="dim small" style={{ cursor: 'pointer' }}>
              {decided.length} already decided
            </summary>
            <ul className="checklist" style={{ marginTop: 8 }}>
              {decided.map((p) => (
                <li key={p.id}>
                  <span className={p.status === 'approved' ? 'ok' : 'dim'}>
                    {p.status === 'approved' ? '✓' : '✕'}
                  </span>
                  <span style={{ flex: 1 }}>{p.label} <code>{p.id}</code></span>
                  <span className="dim small">by @{p.proposedByHandle}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="dim small">{label}</div>
      <div className="num" style={{ fontSize: 28, lineHeight: 1.2 }}>{value}</div>
      {hint && <div className="dim small">{hint}</div>}
    </div>
  )
}
