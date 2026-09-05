import { useState } from 'react'
import { signInWithGoogle } from '../lib/auth'
import { RULES_URL } from '../lib/meta'
import Footer from '../components/Footer'

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

        <button
          onClick={() => { location.search = '?demo' }}
          style={{ width: '100%', marginTop: 8 }}
        >
          Try the demo — no sign-in, nothing saved
        </button>

        {/*
          The earlier wording here said holdings were "readable only by you",
          which was false: Firestore rules do not apply to Firebase Console
          access, so the operator can read the database directly. An overclaim
          is worse than no claim — if a user ever discovers it, every other
          statement becomes suspect. So this says the true, less comfortable
          thing, and points at the rules so it can be checked rather than
          believed.
        */}
        <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong style={{ color: 'var(--text)' }}>No other user can see your holdings.</strong>{' '}
            That is enforced by{' '}
            <a href={RULES_URL} target="_blank" rel="noreferrer noopener">database rules</a>, not
            just by this interface — you can read them yourself.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            The operator can access the database directly, as with any
            self-hosted app. What this app shows them is deliberately limited to
            aggregates: how many accounts exist, and net-worth totals grouped by
            currency, with no names attached.
          </p>
          <p style={{ margin: 0 }}>
            You can export everything as JSON at any time, and delete your
            account and all its data permanently.
          </p>
        </div>
        <Footer />
      </div>
    </div>
  )
}
