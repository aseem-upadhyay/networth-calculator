import { signInWithPopup, signOut, type User } from 'firebase/auth'
import { terminate } from 'firebase/firestore'
import { clearPrivateCache } from './cache'
import { getAuthClient, getDb, googleProvider, readyAuth } from './firebase'

/**
 * Popup, not redirect. Redirect flows break under Safari's storage
 * partitioning when the app is hosted on a domain you don't control, and
 * github.io is exactly that.
 *
 * `readyAuth()` first, because persistence must be set before the sign-in call
 * or the token lands in IndexedDB and outlives the tab.
 */
export async function signInWithGoogle(): Promise<User> {
  const auth = await readyAuth()
  const { user } = await signInWithPopup(auth, googleProvider())
  return user
}

/**
 * Sign out, in four steps — only the first is obvious.
 *
 * The hard reload is what makes the other three trustworthy. A client-side
 * route change leaves every balance sitting in live React state and in already
 * rendered chart components: the UI looks logged out while the data is one
 * devtools poke away. Discarding the JS heap means no ordering bug above can
 * survive, and no in-memory copy is left to leak.
 *
 * localStorage is deliberately untouched — it holds only the public category
 * catalog and ECB rates, so clearing it would leak nothing and merely slow the
 * next sign-in.
 */
export async function logout(uid: string | null): Promise<void> {
  if (uid) clearPrivateCache(uid)

  // Each step is best-effort: a failure here must never strand someone in a
  // half-signed-out state, because the reload below finishes the job regardless.
  try {
    await signOut(getAuthClient())
  } catch {
    /* ignore */
  }
  try {
    await terminate(getDb())
  } catch {
    /* ignore */
  }

  window.location.replace(import.meta.env.BASE_URL)
}
