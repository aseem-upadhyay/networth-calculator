import { useMemo, useState } from 'react'
import { computeTotals, kindLookup } from '../lib/calc'
import { convertToBase, formatMoney, MissingRateError } from '../lib/money'
import type { SnapshotDraft } from '../lib/repo'
import { orderCurrencies } from '../lib/fx'
import { useRates } from '../hooks/useRates'
import { CategorySelect, NewCategoryForm, type NewCategory } from '../components/CategoryPicker'
import type { Category, FxRates, Holding, Profile, Snapshot } from '../lib/types'

/** Stable empty table: a `{}` literal per render would bust every memo below. */
const NO_RATES: FxRates = {}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

const emptyRow = (currency: string): Holding => ({
  categoryId: '', amount: 0, currency, contributed: 0,
})

/**
 * Persistence arrives as props rather than imports, so the same editor drives
 * the real Firestore-backed app and the in-memory demo. Nothing in here knows
 * which one it is running inside.
 */
export interface EditorPersistence {
  saveSnapshot: (
    draft: SnapshotDraft, categories: Category[],
  ) => Promise<{ snapshots: Snapshot[]; categories: Category[] }>
  createCategory: (c: NewCategory) => Promise<Category>
}

export default function SnapshotEditor({
  profile, snapshots, categories, currencies, editing, persistence, onSaved, onCancel,
}: {
  profile: Profile
  snapshots: Snapshot[]
  categories: Category[]
  currencies: Record<string, string>
  /** The snapshot being edited, or undefined to start a new one. */
  editing?: Snapshot
  persistence: EditorPersistence
  onSaved: (data: { snapshots: Snapshot[]; categories: Category[] }) => void
  onCancel: () => void
}) {
  const previous = useMemo(
    () => snapshots.filter((s) => !editing || s.asOfDate < editing.asOfDate).at(-1),
    [snapshots, editing],
  )

  const [asOfDate, setAsOfDate] = useState(editing?.asOfDate ?? todayIso())
  const [baseCurrency, setBase] = useState(editing?.baseCurrency ?? profile.baseCurrency)
  const [note, setNote] = useState(editing?.note ?? '')
  const [holdings, setHoldings] = useState<Holding[]>(() => {
    if (editing) return editing.holdings.map((h) => ({ ...h, contributed: 0 }))
    // Prefill from the previous snapshot so a yearly update is "edit 8 numbers"
    // rather than "re-enter everything from scratch".
    if (previous) return previous.holdings.map((h) => ({ ...h, contributed: 0 }))
    return [emptyRow(profile.baseCurrency)]
  })

  const [localCats, setLocalCats] = useState<Category[]>(categories)
  const [addingFor, setAddingFor] = useState<number | null>(null)
  const [catBusy, setCatBusy] = useState(false)
  const [catError, setCatError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { rates, retry, setRate } = useRates(baseCurrency, asOfDate)

  const patch = (i: number, next: Partial<Holding>) =>
    setHoldings((hs) => hs.map((h, j) => (j === i ? { ...h, ...next } : h)))

  const usedCurrencies = useMemo(
    () => [...new Set(holdings.map((h) => h.currency))].filter((c) => c !== baseCurrency),
    [holdings, baseCurrency],
  )

  const rateTable = rates.status === 'loading' ? NO_RATES : rates.rates
  const missing = usedCurrencies.filter((c) => !rateTable[c])

  const totals = useMemo(() => {
    if (rates.status === 'loading' || missing.length) return null
    try {
      const valid = holdings.filter((h) => h.categoryId)
      return computeTotals(valid, kindLookup(localCats), rateTable, baseCurrency)
    } catch (e) {
      return e instanceof MissingRateError ? null : null
    }
  }, [holdings, localCats, rateTable, baseCurrency, rates.status, missing.length])

  async function createCategory(c: NewCategory) {
    const row = addingFor
    setCatBusy(true)
    setCatError(null)
    try {
      const category = await persistence.createCategory(c)
      setLocalCats((cs) => [...cs, category].sort((a, b) => a.label.localeCompare(b.label)))
      if (row !== null) patch(row, { categoryId: category.id })
      setAddingFor(null)
    } catch (e) {
      setCatError((e as Error).message)
    } finally {
      setCatBusy(false)
    }
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const draft: SnapshotDraft = {
        asOfDate,
        baseCurrency,
        fxRates: rateTable,
        fxAsOf: rates.status === 'loading' ? asOfDate : rates.fxAsOf,
        fxSource: rates.status === 'manual' ? 'manual' : 'frankfurter',
        note: note.trim() || undefined,
        holdings: holdings.filter((h) => h.categoryId),
      }
      const data = await persistence.saveSnapshot(draft, localCats)
      onSaved({ snapshots: data.snapshots, categories: data.categories })
    } catch (e) {
      setSaveError((e as Error).message)
      setSaving(false)
    }
  }

  const currencyOptions = orderCurrencies(currencies, baseCurrency, usedCurrencies)
  const filled = holdings.filter((h) => h.categoryId).length
  const canSave = filled > 0 && !missing.length && rates.status !== 'loading' && !saving

  return (
    <div className="app">
      <div className="spread" style={{ marginBottom: 20 }}>
        <h1>{editing ? `Edit ${editing.asOfDate}` : 'New snapshot'}</h1>
        <button onClick={onCancel}>Cancel</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <div className="field">
            <label htmlFor="asof">Valuation date</label>
            <input id="asof" type="date" value={asOfDate} max={todayIso()}
              onChange={(e) => setAsOfDate(e.target.value)} />
            <p className="hint">Re-using a date edits that snapshot.</p>
          </div>
          <div className="field">
            <label htmlFor="base">Reporting currency</label>
            <select id="base" value={baseCurrency} onChange={(e) => setBase(e.target.value)}>
              {currencyOptions.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {rates.status === 'loading' && <p className="dim small">Fetching exchange rates…</p>}

        {rates.status === 'ready' && rates.fxAsOf !== asOfDate && (
          <p className="dim small">
            ECB prices business days only — using rates from <strong>{rates.fxAsOf}</strong>.
            These are frozen into this snapshot, so its total will not drift later.
          </p>
        )}

        {rates.status === 'manual' && (
          <div className="field">
            <p className="error small">
              Exchange rates unavailable ({rates.reason}). Enter them by hand — a snapshot
              is not worth losing to someone else&apos;s outage.
            </p>
            <button type="button" onClick={() => void retry()}>Try again</button>
          </div>
        )}

        {missing.length > 0 && (
          <div className="field">
            <p className="error small">Need a rate for: {missing.join(', ')}</p>
            {missing.map((code) => (
              <div key={code} className="prefix" style={{ marginBottom: 6 }}>
                <span className="sigil">1 {baseCurrency} =</span>
                <input type="number" step="any" placeholder={`${code} per ${baseCurrency}`}
                  onChange={(e) => setRate(code, Number(e.target.value))} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Holdings</h2>
        {holdings.map((h, i) => {
          let converted: string | null = null
          if (h.categoryId && h.currency !== baseCurrency && rateTable[h.currency]) {
            converted = formatMoney(
              convertToBase(h.amount, h.currency, rateTable, baseCurrency), baseCurrency,
            )
          }
          return (
            <div key={i} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 1.2fr auto', gap: 8, alignItems: 'end' }}>
                <div>
                  <label className="small dim">Category</label>
                  <CategorySelect categories={localCats} value={h.categoryId}
                    onChange={(id) => patch(i, { categoryId: id })}
                    onAddNew={() => setAddingFor(i)} />
                </div>
                <div>
                  <label className="small dim">Value</label>
                  <input type="number" step="any" value={h.amount || ''}
                    onChange={(e) => patch(i, { amount: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="small dim">Currency</label>
                  <select value={h.currency} onChange={(e) => patch(i, { currency: e.target.value })}>
                    {currencyOptions.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                  </select>
                </div>
                <div>
                  <label className="small dim">Added since last</label>
                  <input type="number" step="any" value={h.contributed || ''}
                    onChange={(e) => patch(i, { contributed: Number(e.target.value) })} />
                </div>
                <button type="button" onClick={() => setHoldings((hs) => hs.filter((_, j) => j !== i))}
                  disabled={holdings.length === 1} title="Remove">×</button>
              </div>
              {converted && <p className="hint" style={{ marginTop: 4 }}>= {converted}</p>}
              {addingFor === i && (
                <NewCategoryForm categories={localCats} busy={catBusy} error={catError}
                  onCancel={() => { setAddingFor(null); setCatError(null) }}
                  onCreate={(c) => void createCategory(c)} />
              )}
            </div>
          )
        })}

        <button type="button" onClick={() => setHoldings((hs) => [...hs, emptyRow(baseCurrency)])}>
          + Add holding
        </button>
        <p className="hint">
          “Added since last” is what you deposited this period. It is what separates
          a real return from money you simply put in.
        </p>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="note">Note <span className="dim">(optional)</span></label>
          <input id="note" value={note} placeholder="changed jobs, bought a car…"
            onChange={(e) => setNote(e.target.value)} />
        </div>

        {totals && (
          <div className="spread" style={{ marginBottom: 14 }}>
            <div>
              <div className="dim small">Assets</div>
              <div className="num">{formatMoney(totals.assets, baseCurrency)}</div>
            </div>
            <div>
              <div className="dim small">Liabilities</div>
              <div className="num">{formatMoney(totals.liabilities, baseCurrency)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="dim small">Net worth</div>
              <div className="num" style={{ fontSize: 22 }}>{formatMoney(totals.net, baseCurrency)}</div>
            </div>
          </div>
        )}

        {saveError && <p className="error small">{saveError}</p>}

        <button className="btn-primary" onClick={() => void save()} disabled={!canSave} style={{ width: '100%' }}>
          {saving ? 'Saving…' : `Save snapshot (${filled} holding${filled === 1 ? '' : 's'})`}
        </button>
      </div>
    </div>
  )
}
