import { useCallback, useEffect, useRef, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { getAuthClient, isConfigured, readyAuth } from '../lib/firebase'
import { readCategories, readPrivateCache } from '../lib/cache'
import { hardRefresh } from '../lib/repo'
import type { Category, Portfolio, Profile, Snapshot } from '../lib/types'

export interface SessionData {
  user: User
  profile: Profile
  portfolios: Portfolio[]
  /** portfolioId -> that folio's own timeline. */
  snapshots: Record<string, Snapshot[]>
  categories: Category[]
  /** When the cached copy was fetched, for the age label beside Refresh. */
  fetchedAt: number
}

export type Session =
  | { status: 'unconfigured' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  /** Authenticated but no profile document yet — pick a handle. */
  | { status: 'onboarding'; user: User }
  | ({ status: 'ready' } & SessionData)
  | { status: 'error'; message: string }

export function useSession() {
  const [session, setSession] = useState<Session>(
    isConfigured ? { status: 'loading' } : { status: 'unconfigured' },
  )
  const [refreshing, setRefreshing] = useState(false)
  const userRef = useRef<User | null>(null)

  const load = useCallback(async (user: User, { preferCache }: { preferCache: boolean }) => {
    // A warm tab renders with zero network reads. sessionStorage dies with the
    // tab, so at a twice-a-year cadence this mostly helps across an F5 and
    // while navigating between views — which is the honest extent of its job.
    if (preferCache) {
      const cached = readPrivateCache(user.uid)
      const cats = readCategories()
      if (cached && cats) {
        setSession({ status: 'ready', user, categories: cats, ...cached })
        return
      }
    }

    try {
      // A manual Refresh bypasses every cache, including the catalog's.
      const { profile, portfolios, snapshots, categories } =
        await hardRefresh(user.uid, { force: !preferCache })
      if (!profile) {
        setSession({ status: 'onboarding', user })
        return
      }
      setSession({
        status: 'ready', user, profile, portfolios, snapshots, categories,
        fetchedAt: Date.now(),
      })
    } catch (e) {
      setSession({ status: 'error', message: (e as Error).message })
    }
  }, [])

  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false

    // Persistence must be set before the first auth state resolves, or the
    // token can be restored from IndexedDB under the default policy.
    const ready = readyAuth().catch(() => getAuthClient())

    const unsub = ready.then((auth) =>
      onAuthStateChanged(
        auth,
        (user) => {
          if (cancelled) return
          userRef.current = user
          if (!user) {
            setSession({ status: 'signed-out' })
            return
          }
          setSession({ status: 'loading' })
          void load(user, { preferCache: true })
        },
        (err) => !cancelled && setSession({ status: 'error', message: err.message }),
      ),
    )

    return () => {
      cancelled = true
      void unsub.then((fn) => fn())
    }
  }, [load])

  /** The Refresh button: always bypasses both caches. */
  const refresh = useCallback(async () => {
    const user = userRef.current
    if (!user) return
    setRefreshing(true)
    try {
      await load(user, { preferCache: false })
    } finally {
      setRefreshing(false)
    }
  }, [load])

  return { session, setSession, refresh, refreshing }
}
