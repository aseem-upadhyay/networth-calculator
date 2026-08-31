import { useState } from 'react'
import { signInWithGoogle } from '../lib/auth'

export default function SignIn() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      const code = (e as { code?: string }).code
      // Closing the popup is a decision, not a failure — don't shout about it.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError(null)
      } else if (code === 'auth/unauthorized-domain') {
        setError('This domain is not in the Firebase authorized-domains list.')
      } else {
        setError((e as Error).message)
      }
      setBusy(false)
    }
  }

  return (
    <div className="centered">
      <div className="panel">
        <h1>Net Worth Calculator</h1>
        <p className="dim" style={{ marginBottom: 22 }}>
          A twice-a-year snapshot of everything you own and owe, with the growth
          split into what you added, what it earned, and what the currency did.
        </p>

        <button className="btn-primary" onClick={go} disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>

        {error && <p className="error small" style={{ marginTop: 12 }}>{error}</p>}

        {/*
          PLAN.md F13. The admin console can read aggregate net-worth figures,
          which inverts the per-user isolation everything else guarantees. That
          costs one sentence to disclose, and the disclosure is the whole
          difference between an operator with visibility and an operator with
          undisclosed visibility.
        */}
        <p className="dim small" style={{ marginTop: 22 }}>
          Your holdings are private and readable only by you. Aggregate usage
          statistics — how many accounts exist, and net-worth totals grouped by
          currency — are visible to whoever operates this app.
        </p>
      </div>
    </div>
  )
}
