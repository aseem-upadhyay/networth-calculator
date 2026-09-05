import { useRef, useState } from 'react'
import {
  InvalidBackupError, parseBackup, planImport, type Backup, type ImportPlan,
} from '../lib/export'
import { importBackup } from '../lib/repo'
import type { Portfolio, Snapshot } from '../lib/types'

/**
 * Restore from an exported file.
 *
 * The file is parsed and a plan shown before anything is written — an import
 * that silently overwrote a year of snapshots would be worse than having no
 * import at all. Conflicts are named individually rather than summarised as a
 * count, because "3 dates will be overwritten" is not enough to decide with.
 */
export default function ImportBackup({
  uid, portfolios, snapshots, onDone, onCancel,
}: {
  uid: string
  portfolios: Portfolio[]
  snapshots: Record<string, Snapshot[]>
  onDone: () => void
  onCancel: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [backup, setBackup] = useState<Backup | null>(null)
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [mode, setMode] = useState<'skip' | 'overwrite'>('skip')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function pick(file: File) {
    setError(null); setBackup(null); setPlan(null)
    try {
      const parsed = parseBackup(await file.text())
      setBackup(parsed)
      setPlan(planImport(parsed, portfolios, snapshots))
    } catch (e) {
      setError(e instanceof InvalidBackupError ? e.message : (e as Error).message)
    }
  }

  async function run() {
    if (!backup) return
    setBusy(true); setError(null)
    try {
      const r = await importBackup(uid, backup, mode, snapshots)
      setResult(
        `Restored ${r.snapshots} snapshot${r.snapshots === 1 ? '' : 's'} across ` +
        `${r.portfolios} portfolio${r.portfolios === 1 ? '' : 's'}` +
        (r.skipped ? `, left ${r.skipped} existing one${r.skipped === 1 ? '' : 's'} alone.` : '.'),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="centered">
        <div className="panel">
          <h1>Restored</h1>
          <p className="dim">{result}</p>
          <button className="btn-primary" onClick={onDone} style={{ width: '100%' }}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div className="centered">
      <div className="panel">
        <h1>Restore from a file</h1>
        <p className="dim small">
          Pick a JSON file exported from this app. Nothing is written until you
          confirm what it would do.
        </p>

        <input
          ref={fileRef} type="file" accept="application/json,.json"
          style={{ marginBottom: 16 }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f) }}
        />

        {error && <p className="error small">{error}</p>}

        {plan && (
          <>
            <div className="card" style={{ background: 'var(--surface-2)', marginBottom: 16 }}>
              <p style={{ margin: '0 0 8px', fontWeight: 550 }}>
                {plan.totalSnapshots} snapshot{plan.totalSnapshots === 1 ? '' : 's'} in this file
              </p>
              <ul className="small dim" style={{ margin: 0, paddingLeft: 18 }}>
                {plan.portfolios.map((p) => (
                  <li key={p.id}>
                    {p.label} — {p.snapshots} snapshot{p.snapshots === 1 ? '' : 's'}
                    {p.isNew ? ' (new portfolio)' : ''}
                  </li>
                ))}
              </ul>

              {plan.conflicts.length > 0 && (
                <>
                  <p style={{ margin: '14px 0 6px', fontWeight: 550 }}>
                    Already present
                  </p>
                  <ul className="small dim" style={{ margin: 0, paddingLeft: 18 }}>
                    {plan.conflicts.map((c) => (
                      <li key={`${c.portfolio}-${c.asOfDate}`}>{c.portfolio} · {c.asOfDate}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {plan.conflicts.length > 0 && (
              <div className="field">
                <label>Dates you already have</label>
                <div className="seg" style={{ display: 'flex' }}>
                  <button className={mode === 'skip' ? 'on' : ''} onClick={() => setMode('skip')}>
                    Keep mine
                  </button>
                  <button className={mode === 'overwrite' ? 'on' : ''} onClick={() => setMode('overwrite')}>
                    Use the file
                  </button>
                </div>
                <p className="hint">
                  {mode === 'skip'
                    ? 'Nothing you already have is changed. Only missing dates are added.'
                    : 'The file replaces those dates. Your current values for them are lost.'}
                </p>
              </div>
            )}

            <div className="row">
              <button onClick={onCancel} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={() => void run()} disabled={busy}>
                {busy ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </>
        )}

        {!plan && (
          <button onClick={onCancel} style={{ width: '100%' }}>Cancel</button>
        )}
      </div>
    </div>
  )
}
