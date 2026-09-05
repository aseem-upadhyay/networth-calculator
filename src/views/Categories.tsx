import { useCallback, useEffect, useMemo, useState } from 'react'
import { partitionByRegion } from '../lib/categories'
import { deleteCustomCategory, loadMyProposals, withdrawProposal, type MyProposal } from '../lib/repo'
import { GROUP_LABEL, groupColor } from '../lib/palette'
import { useDarkMode } from '../hooks/useDarkMode'
import type { Category, Portfolio, Snapshot } from '../lib/types'

/**
 * Browse the catalog, and see what happened to your suggestions.
 *
 * Categories could previously only be added mid-snapshot, and a suggestion went
 * into silence — no way to tell approved from rejected from never-looked-at.
 * Deleting a private category is refused while a snapshot still references it,
 * since that would leave holdings pointing at nothing.
 */
export default function Categories({
  uid, categories, portfolios, snapshots, onChanged, onBack,
}: {
  uid: string
  categories: Category[]
  portfolios: Portfolio[]
  snapshots: Record<string, Snapshot[]>
  onChanged: () => void
  onBack: () => void
}) {
  const dark = useDarkMode()
  const [proposals, setProposals] = useState<MyProposal[]>([])
  const [filter, setFilter] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setProposals(await loadMyProposals(uid))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [uid])

  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])

  /** Every categoryId any snapshot still points at. */
  const inUse = useMemo(() => {
    const used = new Map<string, number>()
    for (const timeline of Object.values(snapshots)) {
      for (const s of timeline) {
        for (const h of s.holdings) used.set(h.categoryId, (used.get(h.categoryId) ?? 0) + 1)
      }
    }
    return used
  }, [snapshots])

  const regions = useMemo(
    () => [...new Set(categories.flatMap((c) => c.regions))].sort(),
    [categories],
  )
  const shown = filter
    ? partitionByRegion(categories, filter === 'GLOBAL' ? null : filter).relevant
        .filter((c) => c.regions.includes(filter))
    : categories

  const mine = categories.filter((c) => c.tier === 'custom')

  async function remove(c: Category) {
    setBusy(c.id); setError(null)
    try {
      await deleteCustomCategory(uid, c.id)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function withdraw(p: MyProposal) {
    setBusy(p.id); setError(null)
    try {
      await withdrawProposal(p.id)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="app">
      <div className="spread" style={{ marginBottom: 20 }}>
        <h1>Categories</h1>
        <button onClick={onBack}>Back</button>
      </div>

      {error && <p className="error small">{error}</p>}

      {proposals.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Your suggestions</h2>
          <ul className="checklist">
            {proposals.map((p) => (
              <li key={p.id}>
                <span className={p.status === 'approved' ? 'ok' : p.status === 'rejected' ? 'dim' : 'warn'}>
                  {p.status === 'approved' ? '✓' : p.status === 'rejected' ? '✕' : '·'}
                </span>
                <span style={{ flex: 1 }}>
                  {p.label} <code>{p.id}</code>
                  {p.status === 'rejected' && p.rejectionReason && (
                    <span className="dim"> — {p.rejectionReason}</span>
                  )}
                  {p.status === 'pending' && <span className="dim"> — awaiting review</span>}
                  {p.status === 'approved' && <span className="dim"> — everyone can use it now</span>}
                </span>
                {p.status === 'pending' && (
                  <button
                    disabled={busy === p.id}
                    onClick={() => void withdraw(p)}
                    style={{ padding: '2px 10px', fontSize: 13 }}
                  >
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mine.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Yours only</h2>
          <p className="dim small" style={{ marginTop: 0 }}>
            Private to you unless a suggestion is approved.
          </p>
          <ul className="checklist">
            {mine.map((c) => {
              const uses = inUse.get(c.id) ?? 0
              return (
                <li key={c.id}>
                  <span className="dot" style={{ background: groupColor(c.group, dark) }} />
                  <span style={{ flex: 1 }}>
                    {c.label} <span className="dim">· {GROUP_LABEL[c.group]}</span>
                  </span>
                  {uses > 0 ? (
                    <span className="dim small">used in {uses} snapshot{uses === 1 ? '' : 's'}</span>
                  ) : (
                    <button
                      disabled={busy === c.id}
                      onClick={() => void remove(c)}
                      style={{ padding: '2px 10px', fontSize: 13, color: 'var(--negative)' }}
                    >
                      Delete
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="spread" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>All categories <span className="dim">({shown.length})</span></h2>
          <div className="seg">
            <button className={!filter ? 'on' : ''} onClick={() => setFilter(null)}>All</button>
            {regions.map((r) => (
              <button key={r} className={filter === r ? 'on' : ''} onClick={() => setFilter(r)}>
                {r === 'GLOBAL' ? 'Everywhere' : r}
              </button>
            ))}
          </div>
        </div>
        <p className="dim small" style={{ marginTop: 0 }}>
          New categories are added while editing a snapshot, where the portfolio
          decides which are offered first. {portfolios.length > 1
            ? 'Each portfolio sees its own jurisdiction ahead of the rest.'
            : ''}
        </p>
        <ul className="checklist">
          {shown.map((c) => (
            <li key={c.id}>
              <span className="dot" style={{ background: groupColor(c.group, dark) }} />
              <span style={{ flex: 1 }}>
                {c.label} <span className="dim">· {GROUP_LABEL[c.group]}</span>
              </span>
              <span className="dim small">
                {c.regions.map((r) => (r === 'GLOBAL' ? 'everywhere' : r)).join(', ')}
              </span>
              {c.tier === 'custom' && <span className="tag">yours</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
