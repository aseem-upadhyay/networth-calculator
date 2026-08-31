import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { fetchCurrencies, orderCurrencies } from '../lib/fx'
import { createProfile, HandleTakenError } from '../lib/repo'
import { logout } from '../lib/auth'
import type { Profile } from '../lib/types'

/** Mirrors the /handles rule exactly. Diverging would fail at the database instead of here. */
const HANDLE_RE = /^[a-z0-9_]{3,20}$/

function suggestHandle(email: string): string {
  const base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '')
  return base.slice(0, 20).padEnd(3, '0')
}

export default function Onboarding({
  user, onDone,
}: {
  user: User
  onDone: (p: Profile) => void
}) {
  const [handle, setHandle] = useState(() => suggestHandle(user.email ?? ''))
  const [baseCurrency, setBaseCurrency] = useState('INR')
  const [cadence, setCadence] = useState<6 | 12>(12)
  const [currencies, setCurrencies] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Never rejects: falls back through localStorage to a hardcoded table, so
    // the picker is never empty even offline.
    void fetchCurrencies().then(setCurrencies)
  }, [])

  const valid = HANDLE_RE.test(handle)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const profile = await createProfile(user.uid, {
        handle,
        email: user.email ?? '',
        baseCurrency,
        cadenceMonths: cadence,
      })
      onDone(profile)
    } catch (err) {
      setError(
        err instanceof HandleTakenError
          ? `"${handle}" is taken — pick another.`
          : (err as Error).message,
      )
      setBusy(false)
    }
  }

  const options = orderCurrencies(currencies, baseCurrency)

  return (
    <div className="centered">
      <form className="panel" onSubmit={submit}>
        <h1>Set up your account</h1>
        <p className="dim" style={{ marginBottom: 22 }}>
          Signed in as {user.email}
        </p>

        <div className="field">
          <label htmlFor="handle">Handle</label>
          <div className="prefix">
            <span className="sigil">@</span>
            <input
              id="handle"
              value={handle}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
            />
          </div>
          {handle && !valid ? (
            <p className="error">3–20 characters: lowercase letters, numbers, underscore.</p>
          ) : (
            <p className="hint">
              Permanent, and shown against any category you suggest for everyone.
            </p>
          )}
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="currency">Reporting currency</label>
            <select
              id="currency"
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value)}
            >
              {options.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <p className="hint">Individual holdings can be in any currency.</p>
          </div>

          <div className="field">
            <label htmlFor="cadence">Update every</label>
            <select
              id="cadence"
              value={cadence}
              onChange={(e) => setCadence(Number(e.target.value) as 6 | 12)}
            >
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
            </select>
            <p className="hint">Only sets the reminder.</p>
          </div>
        </div>

        {error && <p className="error small" style={{ marginBottom: 12 }}>{error}</p>}

        <button className="btn-primary" type="submit" disabled={!valid || busy} style={{ width: '100%' }}>
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <button
          type="button"
          onClick={() => void logout(user.uid)}
          style={{ width: '100%', marginTop: 8, border: 0, background: 'none', color: 'var(--text-dim)' }}
        >
          Sign out
        </button>
      </form>
    </div>
  )
}
