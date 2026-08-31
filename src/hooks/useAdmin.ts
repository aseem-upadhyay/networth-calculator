import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'

/**
 * Read the `admin` custom claim off the ID token.
 *
 * A claim rather than an /admins document lookup: exists() in a rule costs a
 * document read per evaluation, and the console's whole job is listing many
 * documents. A claim costs nothing.
 *
 * The result is derived during render by matching the resolved claim against
 * the current uid, so switching accounts can never briefly show the previous
 * user's admin state.
 *
 * A claim reaches the client on the next token refresh (~1h) or on re-login, so
 * a freshly granted admin may need to sign out and back in.
 */
export function useAdmin(user: User | null): boolean {
  const uid = user?.uid ?? null
  const [claim, setClaim] = useState<{ uid: string; admin: boolean } | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    user
      .getIdTokenResult()
      .then((t) => {
        if (!cancelled) setClaim({ uid: user.uid, admin: t.claims.admin === true })
      })
      .catch(() => {
        if (!cancelled) setClaim({ uid: user.uid, admin: false })
      })
    return () => { cancelled = true }
  }, [user])

  return claim !== null && claim.uid === uid && claim.admin
}
