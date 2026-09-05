import { useState } from 'react'
import type { User } from 'firebase/auth'
import { deleteAuthUser } from '../lib/auth'
import { clearPrivateCache } from '../lib/cache'
import { buildBackup, downloadBackup } from '../lib/export'
import { deleteAccount } from '../lib/repo'
import type { Category, Profile, Snapshot } from '../lib/types'

/**
 * Leaving has to be as easy as joining, or "your data is yours" is decoration.
 *
 * Two deliberate frictions, both for the user rather than against them: export
 * is offered first, because this is irreversible and yearly snapshots cannot be
 * reconstructed; and the handle must be typed out, so the button cannot be hit
 * by muscle memory.
 */
export default function DeleteAccount({
  user, profile, snapshots, categories, onCancel,
}: {
  user: User
  profile: Profile
  snapshots: Snapshot[]
  categories: Category[]
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exported, setExported] = useState(false)

  const confirmed = typed.trim() === profile.handle

  async function go() {
    setBusy(true)
    setError(null)
    try {
      await deleteAccount(user.uid, profile.handle)
      clearPrivateCache(user.uid)
      await deleteAuthUser(user)
      // Hard reload rather than a route change: it discards the JS heap, so no
      // balance survives in memory after the account is gone.
      window.location.replace(import.meta.env.BASE_URL)
    } catch (e) {
      const code = (e as { code?: string }).code
      setError(
        code === 'auth/popup-closed-by-user'
          ? 'Your data was deleted, but the sign-in record needs one more confirmation. Reopen and try again.'
          : (e as Error).message,
      )
      setBusy(false)
    }
  }

  return (
    <div className="centered">
      <div className="panel">
        <h1>Delete your account</h1>

        <p className="dim">
          This cannot be undone. A year of snapshots is not something you can
          reconstruct from memory, so take a copy first.
        </p>

        <button
          style={{ width: '100%', marginBottom: 20 }}
          onClick={() => {
            downloadBackup(buildBackup(profile, snapshots, categories))
            setExported(true)
          }}
        >
          {exported ? 'Downloaded ✓  Download again' : 'Download my data first'}
        </button>

        <div className="card" style={{ background: 'var(--surface-2)', marginBottom: 20 }}>
          <p style={{ margin: '0 0 8px', fontWeight: 550 }}>What gets deleted</p>
          <ul className="small dim" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'} and every holding in them</li>
            <li>Your profile, reporting currency, and the handle @{profile.handle}</li>
            <li>Private categories you created, and any suggestion still awaiting review</li>
            <li>Your sign-in record — this app forgets your email entirely</li>
          </ul>

          <p style={{ margin: '14px 0 8px', fontWeight: 550 }}>What stays, and why</p>
          <p className="small dim" style={{ margin: 0 }}>
            Category suggestions already approved into the shared list. They
            belong to everyone by then, and removing one would break the charts
            of every user whose history references it. They carry a label and
            nothing about your finances.
          </p>
        </div>

        <div className="field">
          <label htmlFor="confirm">
            Type <strong>{profile.handle}</strong> to confirm
          </label>
          <input
            id="confirm" value={typed} autoComplete="off" autoCapitalize="off"
            spellCheck={false} onChange={(e) => setTyped(e.target.value)}
          />
        </div>

        {error && <p className="error small">{error}</p>}

        <div className="row">
          <button onClick={onCancel} disabled={busy}>Keep my account</button>
          <button
            onClick={() => void go()}
            disabled={!confirmed || busy}
            style={{
              background: confirmed ? 'var(--negative)' : undefined,
              borderColor: confirmed ? 'var(--negative)' : undefined,
              color: confirmed ? '#fff' : undefined,
              fontWeight: 550,
            }}
          >
            {busy ? 'Deleting…' : 'Delete everything'}
          </button>
        </div>
      </div>
    </div>
  )
}
