import { useState } from 'react'
import { slugify } from '../lib/cache'
import { fetchCurrencies, guessCurrency, orderCurrencies } from '../lib/fx'
import { createPortfolio, deletePortfolio, updatePortfolio } from '../lib/repo'
import type { Portfolio, Snapshot } from '../lib/types'

/** Regions with their own seeded instruments. Anything else stays region-less. */
const REGIONS: { code: string | null; label: string }[] = [
  { code: null, label: 'No specific country' },
  { code: 'IN', label: 'India' },
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'GB', label: 'United Kingdom' },
]

export default function Portfolios({
  uid, portfolios, timelines, currencies, onChanged, onBack,
}: {
  uid: string
  portfolios: Portfolio[]
  timelines: Record<string, Snapshot[]>
  currencies: Record<string, string>
  onChanged: () => void
  onBack: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [region, setRegion] = useState<string | null>(null)
  const [currency, setCurrency] = useState(() => guessCurrency('INR'))
  const [cadence, setCadence] = useState<6 | 12>(12)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  void fetchCurrencies

  const slug = slugify(label)
  const taken = portfolios.some((p) => p.id === slug)
  const canAdd = slug.length >= 2 && !taken && !busy

  async function add() {
    setBusy(true); setError(null)
    try {
      await createPortfolio(uid, {
        id: slug, label: label.trim(), region,
        baseCurrency: currency, cadenceMonths: cadence,
        order: portfolios.length,
      })
      setAdding(false); setLabel('')
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: Portfolio) {
    setBusy(true); setError(null)
    try {
      await deletePortfolio(uid, p.id)
      setConfirming(null)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <div className="spread" style={{ marginBottom: 20 }}>
        <h1>Portfolios</h1>
        <button onClick={onBack}>Back</button>
      </div>

      <p className="dim small" style={{ marginTop: -8 }}>
        Each portfolio keeps its own timeline, so you can update one without
        claiming anything about the others. A country is optional — it only
        decides which instruments the category picker offers first.
      </p>

      {error && <p className="error small">{error}</p>}

      <div className="grid-cards" style={{ marginBottom: 16 }}>
        {portfolios.map((p) => {
          const count = timelines[p.id]?.length ?? 0
          const isLast = portfolios.length === 1
          return (
            <div key={p.id} className="card">
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="spread" style={{ justifyContent: 'flex-start', gap: 8 }}>
                    <strong>{p.label}</strong>
                    {p.region && <span className="tag">{p.region}</span>}
                  </div>
                  <p className="dim small" style={{ margin: '4px 0 0' }}>
                    {p.baseCurrency} · every {p.cadenceMonths} months ·{' '}
                    {count} snapshot{count === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="row actions">
                  <select
                    value={p.cadenceMonths}
                    aria-label={`${p.label} cadence`}
                    style={{ width: 'auto', padding: '3px 6px', fontSize: 13 }}
                    onChange={(e) => {
                      void updatePortfolio(uid, p.id, {
                        cadenceMonths: Number(e.target.value) as 6 | 12,
                      }).then(onChanged)
                    }}
                  >
                    <option value={6}>6 months</option>
                    <option value={12}>12 months</option>
                  </select>
                  {!isLast && (
                    <button
                      style={{ color: 'var(--negative)' }}
                      onClick={() => setConfirming(confirming === p.id ? null : p.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              {confirming === p.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                  <p className="small" style={{ margin: '0 0 8px' }}>
                    Deleting <strong>{p.label}</strong> removes {count} snapshot
                    {count === 1 ? '' : 's'} permanently. Its history cannot be
                    reconstructed — export first if you might want it.
                  </p>
                  <div className="row">
                    <button onClick={() => setConfirming(null)}>Keep it</button>
                    <button
                      disabled={busy}
                      style={{ background: 'var(--negative)', borderColor: 'var(--negative)', color: '#fff' }}
                      onClick={() => void remove(p)}
                    >
                      {busy ? 'Deleting…' : 'Delete portfolio'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!adding ? (
        <button className="btn-primary" onClick={() => setAdding(true)}>Add a portfolio</button>
      ) : (
        <div className="card">
          <h2>New portfolio</h2>
          <div className="field">
            <label htmlFor="plabel">Name</label>
            <input id="plabel" value={label} autoFocus placeholder="e.g. India, Retirement, Fidelity"
              onChange={(e) => setLabel(e.target.value)} />
            {taken && <p className="error">You already have one called that.</p>}
          </div>
          <div className="row">
            <div className="field">
              <label htmlFor="pregion">Country</label>
              <select id="pregion" value={region ?? ''} onChange={(e) => setRegion(e.target.value || null)}>
                {REGIONS.map((r) => (
                  <option key={r.code ?? 'none'} value={r.code ?? ''}>{r.label}</option>
                ))}
              </select>
              <p className="hint">Orders the category list. Never restricts it.</p>
            </div>
            <div className="field">
              <label htmlFor="pcur">Kept in</label>
              <select id="pcur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {orderCurrencies(currencies, currency).map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pcad">Update every</label>
              <select id="pcad" value={cadence}
                onChange={(e) => setCadence(Number(e.target.value) as 6 | 12)}>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
              </select>
            </div>
          </div>
          <div className="row">
            <button onClick={() => { setAdding(false); setLabel('') }}>Cancel</button>
            <button className="btn-primary" disabled={!canAdd} onClick={() => void add()}>
              {busy ? 'Creating…' : 'Create portfolio'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
