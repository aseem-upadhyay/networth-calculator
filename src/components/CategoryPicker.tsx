import { useMemo, useState } from 'react'
import { slugify } from '../lib/cache'
import { CATEGORY_GROUPS, type Category, type CategoryGroup, type CategoryKind } from '../lib/types'

export interface NewCategory {
  slug: string
  label: string
  kind: CategoryKind
  group: CategoryGroup
  proposeGlobal: boolean
}

export function CategorySelect({
  categories, value, onChange, onAddNew,
}: {
  categories: Category[]
  value: string
  onChange: (id: string) => void
  onAddNew: () => void
}) {
  const assets = categories.filter((c) => c.kind === 'asset')
  const liabilities = categories.filter((c) => c.kind === 'liability')

  return (
    <select
      value={value}
      onChange={(e) => (e.target.value === '__new__' ? onAddNew() : onChange(e.target.value))}
    >
      <option value="" disabled>Choose a category…</option>
      <optgroup label="Assets">
        {assets.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </optgroup>
      <optgroup label="Liabilities">
        {liabilities.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </optgroup>
      <option value="__new__">+ Add a category…</option>
    </select>
  )
}

/**
 * Inline form for a category the catalog doesn't have.
 *
 * Matches are shown as you type and take precedence visually over the create
 * button: the point is that you see the existing options before adding a
 * near-duplicate. Slug collision is still caught at the database — same slug
 * means same document id — but no regex catches "MF" vs "Mutual Fund", so the
 * only real defence is putting them in front of you.
 */
export function NewCategoryForm({
  categories, onCancel, onCreate, busy, error,
}: {
  categories: Category[]
  onCancel: () => void
  onCreate: (c: NewCategory) => void
  busy: boolean
  error: string | null
}) {
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<CategoryKind>('asset')
  const [group, setGroup] = useState<CategoryGroup>('equity')
  const [proposeGlobal, setProposeGlobal] = useState(false)

  const slug = slugify(label)
  const exact = categories.find((c) => c.id === slug)

  const matches = useMemo(() => {
    const q = label.trim().toLowerCase()
    if (q.length < 2) return []
    return categories
      .filter((c) => c.label.toLowerCase().includes(q) || c.id.includes(slugify(q)))
      .slice(0, 5)
  }, [label, categories])

  return (
    <div className="card" style={{ background: 'var(--surface-2)', marginTop: 10 }}>
      <div className="field">
        <label htmlFor="newcat">New category</label>
        <input
          id="newcat"
          value={label}
          autoFocus
          placeholder="e.g. Angel Investments"
          onChange={(e) => setLabel(e.target.value)}
        />
        {slug && <p className="hint">Saved as <code>{slug}</code></p>}
      </div>

      {matches.length > 0 && (
        <div className="field">
          <p className="hint" style={{ marginTop: 0 }}>Already in the list:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {matches.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onCancel(); setTimeout(() => onCreate({ ...c, slug: c.id, proposeGlobal: false }), 0) }}
                style={{ padding: '4px 10px', fontSize: 13 }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row">
        <div className="field">
          <label htmlFor="newkind">Type</label>
          <select id="newkind" value={kind} onChange={(e) => {
            const k = e.target.value as CategoryKind
            setKind(k)
            setGroup(k === 'liability' ? 'liability' : 'equity')
          }}>
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="newgroup">Group</label>
          <select id="newgroup" value={group} onChange={(e) => setGroup(e.target.value as CategoryGroup)}>
            {CATEGORY_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <p className="hint">Sets the chart colour family.</p>
        </div>
      </div>

      <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={proposeGlobal}
          onChange={(e) => setProposeGlobal(e.target.checked)}
          style={{ width: 'auto', marginTop: 3 }}
        />
        <span>
          Suggest this for everyone
          <span className="dim"> — goes to a review queue. Yours works immediately either way.</span>
        </span>
      </label>

      {exact && <p className="error small">That already exists as “{exact.label}”. Pick it above instead.</p>}
      {error && <p className="error small">{error}</p>}

      <div className="row">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="btn-primary"
          disabled={slug.length < 2 || !!exact || busy}
          onClick={() => onCreate({ slug, label: label.trim(), kind, group, proposeGlobal })}
        >
          {busy ? 'Adding…' : 'Add category'}
        </button>
      </div>
    </div>
  )
}
