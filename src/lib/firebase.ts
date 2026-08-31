import { type FirebaseApp, initializeApp } from 'firebase/app'
import {
  type Auth, browserSessionPersistence, getAuth, GoogleAuthProvider, setPersistence,
} from 'firebase/auth'
import { type Firestore, initializeFirestore, memoryLocalCache } from 'firebase/firestore'

/**
 * Firebase wiring. Two deliberate departures from the defaults, both from PLAN.md §6.
 *
 * The web config below is NOT a secret — it is a public client identifier that
 * ships in the bundle by design. All protection comes from the Firestore rules
 * and App Check.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isConfigured = Boolean(config.apiKey && config.projectId)

/**
 * Initialisation is lazy on purpose.
 *
 * `getAuth()` throws `auth/invalid-api-key` the moment it runs without
 * credentials. At module scope that takes down the entire app before React
 * mounts — so an unconfigured build would render a blank page instead of the
 * setup instructions explaining why. The app must survive having no backend.
 */
interface Services {
  app: FirebaseApp
  db: Firestore
  auth: Auth
}

let services: Services | null = null

function init(): Services {
  if (services) return services
  if (!isConfigured) {
    throw new Error(
      'Firebase is not configured. Copy .env.example to .env and fill in the web config.',
    )
  }

  const app = initializeApp(config)

  // Departure 1: no IndexedDB persistence. We run our own sessionStorage cache,
  // and two caches that can disagree is worse than one cache you control.
  const db = initializeFirestore(app, { localCache: memoryLocalCache() })

  const auth = getAuth(app)

  services = { app, db, auth }
  return services
}

export const getDb = (): Firestore => init().db
export const getAuthClient = (): Auth => init().auth

export function googleProvider(): GoogleAuthProvider {
  const p = new GoogleAuthProvider()
  p.setCustomParameters({ prompt: 'select_account' })
  return p
}

/**
 * Departure 2: session-scoped auth.
 *
 * Firebase defaults to browserLocalPersistence, which parks the refresh token in
 * IndexedDB where it outlives the tab. Leaving that while moving balances to
 * sessionStorage would protect the wrong asset — a surviving token doesn't just
 * reveal stale numbers, it fetches live ones and can write. So the token dies
 * with the tab too.
 *
 * Await this before any sign-in call. Cost: one Google popup per new tab, which
 * for a twice-a-year app is a fair price.
 */
export async function readyAuth(): Promise<Auth> {
  const auth = getAuthClient()
  await setPersistence(auth, browserSessionPersistence)
  return auth
}

/**
 * App Check: the closest thing to "restricted to a domain" that actually exists.
 * Rules cannot see a request's origin, so this is what stops someone driving the
 * public config straight from curl. Optional in dev, required before going live.
 */
export async function initAppCheck(): Promise<void> {
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY
  if (!siteKey || !isConfigured) return
  // Dynamic import so builds without a site key never ship the reCAPTCHA code.
  const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check')
  initializeAppCheck(init().app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  })
}
