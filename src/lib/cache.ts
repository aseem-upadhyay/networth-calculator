import type { Category, Portfolio, Profile, Snapshot } from './types'

/**
 * Read cache, split by sensitivity rather than convenience (PLAN.md §6).
 *
 *   sessionStorage  profile + snapshots — actual balances, die with the tab
 *   localStorage    global category catalog — shared by every user by design
 *
 * Bump SCHEMA on any shape change. A version mismatch discards and refetches;
 * it never attempts a merge. At a 6-12 month update cadence you will not
 * remember the old shape, and a half-migrated cache is worse than a cold start.
 */
// 2: snapshots moved under portfolios, profile.baseCurrency -> displayCurrency.
// A version bump discards and refetches rather than merging — at a 6-12 month
// cadence nobody remembers the old shape, and a half-migrated cache is worse
// than a cold start.
export const SCHEMA = 2

const privKey = (uid: string) => `nwc:v${SCHEMA}:${uid}`
const CATS_KEY = `nwc:v${SCHEMA}:categories`

export interface PrivateCache {
  schemaVersion: number
  uid: string
  /** Client clock, for the "as of" label next to the Refresh button. */
  fetchedAt: number
  profile: Profile
  portfolios: Portfolio[]
  /** portfolioId -> that folio's own timeline, ordered by asOfDate. */
  snapshots: Record<string, Snapshot[]>
}

/**
 * Every accessor is wrapped: Safari private mode throws on write, quota can be
 * exceeded, and stored JSON can be corrupt. The cache is an optimisation, so
 * every failure degrades to a cold read rather than an error.
 */
function safeRead<T>(store: Storage, key: string): T | null {
  try {
    const raw = store.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function safeWrite(store: Storage, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function readPrivateCache(uid: string): PrivateCache | null {
  const c = safeRead<PrivateCache>(sessionStorage, privKey(uid))
  if (!c || c.schemaVersion !== SCHEMA || c.uid !== uid) return null
  return c
}

export function writePrivateCache(
  uid: string,
  data: { profile: Profile; portfolios: Portfolio[]; snapshots: Record<string, Snapshot[]> },
): PrivateCache {
  const payload: PrivateCache = {
    schemaVersion: SCHEMA, uid, fetchedAt: Date.now(), ...data,
  }
  safeWrite(sessionStorage, privKey(uid), payload)
  return payload
}

/**
 * The catalog is identical for every user and changes perhaps monthly, so it is
 * cached across sessions rather than re-fetched each time. A day is short enough
 * that an approved category shows up promptly and long enough that most sessions
 * pay nothing for it; the Refresh button bypasses this entirely.
 */
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000

interface CachedCatalog {
  schemaVersion: number
  fetchedAt: number
  version: number
  categories: Category[]
}

export function readCategories(opts: { ignoreTtl?: boolean } = {}): Category[] | null {
  const c = safeRead<CachedCatalog>(localStorage, CATS_KEY)
  if (!c || c.schemaVersion !== SCHEMA) return null
  if (!opts.ignoreTtl && Date.now() - c.fetchedAt > CATALOG_TTL_MS) return null
  return c.categories
}

export function writeCategories(categories: Category[], version = 0): void {
  safeWrite(localStorage, CATS_KEY, {
    schemaVersion: SCHEMA, fetchedAt: Date.now(), version, categories,
  })
}

/**
 * Clear the private cache on sign-out.
 *
 * localStorage is deliberately left alone: it holds only the public category
 * catalog and ECB rates, so wiping it would leak nothing and merely slow the
 * next load. The in-memory copy is handled by the hard reload in `logout()` —
 * clearing storage without discarding the JS heap leaves every balance sitting
 * in live React state.
 */
export function clearPrivateCache(uid: string): void {
  try {
    sessionStorage.removeItem(privKey(uid))
  } catch {
    /* ignore */
  }
}

/** Merge the two category tiers. Union by slug, global wins ties (PLAN.md §4). */
export function mergeCategories(global: Category[], custom: Category[]): Category[] {
  const bySlug = new Map<string, Category>()
  for (const c of custom) bySlug.set(c.id, c)
  for (const c of global) bySlug.set(c.id, c) // global overwrites, so approval needs no migration
  return [...bySlug.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/** Slugify a label into a category id. Collisions are the dedupe mechanism, not a bug. */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}
