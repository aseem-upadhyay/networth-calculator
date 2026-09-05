import {
  collection, collectionGroup, deleteField, doc, getDocFromServer, getDocsFromServer,
  increment, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
  writeBatch,
} from 'firebase/firestore'
import { getDb } from './firebase'
import { computeTotals, kindLookup } from './calc'
import { mergeCategories, writeCategories, writePrivateCache } from './cache'
import type { Category, CategoryProposal, Profile, Snapshot } from './types'

/** Firestore Timestamp -> epoch ms. Null while a serverTimestamp() is unresolved. */
function ms(v: unknown): number | null {
  return v instanceof Timestamp ? v.toMillis() : null
}

export interface LoadedData {
  profile: Profile | null
  snapshots: Snapshot[]
  categories: Category[]
}

/**
 * The one place a read touches the network.
 *
 * `getDocsFromServer`, never `getDocs`: the plain variants may answer from the
 * SDK's own cache, which would turn the Refresh button into a silent no-op.
 * That is the single easiest bug to ship in this app.
 *
 * A null `profile` means the account exists in Auth but has not been onboarded
 * — the caller sends them to pick a handle.
 */
export async function hardRefresh(uid: string): Promise<LoadedData> {
  const db = getDb()

  const [profSnap, snapsSnap, globalSnap, customSnap] = await Promise.all([
    getDocFromServer(doc(db, 'users', uid)),
    getDocsFromServer(query(collection(db, 'users', uid, 'snapshots'), orderBy('asOfDate'))),
    getDocsFromServer(collection(db, 'categories')),
    getDocsFromServer(collection(db, 'users', uid, 'customCategories')),
  ])

  const profile = profSnap.exists() ? (profSnap.data() as Profile) : null

  const snapshots: Snapshot[] = snapsSnap.docs.map((d) => {
    const raw = d.data()
    return {
      ...raw,
      asOfDate: d.id,
      recordedAt: ms(raw.recordedAt),
      updatedAt: ms(raw.updatedAt),
    } as Snapshot
  })

  const toCategory = (tier: Category['tier']) => (d: { id: string; data: () => any }): Category => ({
    id: d.id, ...d.data(), tier,
  })

  // Union by slug, global winning ties — so approving a proposal needs no
  // migration: the private copy is simply shadowed by the identical global one.
  const categories = mergeCategories(
    globalSnap.docs.map(toCategory('global')),
    customSnap.docs.map(toCategory('custom')),
  )

  if (profile) writePrivateCache(uid, { profile, snapshots })
  writeCategories(categories)

  return { profile, snapshots, categories }
}

export class HandleTakenError extends Error {
  constructor(handle: string) {
    super(`The handle "${handle}" is already taken`)
    this.name = 'HandleTakenError'
  }
}

/**
 * First-time setup: claim a handle and create the profile.
 *
 * All three writes go in one batch, so a lost race on the handle leaves no
 * orphaned profile behind. `/handles/{slug}` is create-only in the rules, so
 * the loser's batch fails at the database rather than in a check-then-write gap.
 */
export async function createProfile(
  uid: string,
  opts: { handle: string; email: string; baseCurrency: string; cadenceMonths: 6 | 12 },
): Promise<Profile> {
  const db = getDb()
  const batch = writeBatch(db)

  batch.set(doc(db, 'handles', opts.handle), {
    uid, createdAt: serverTimestamp(),
  })

  const profile: Profile = {
    handle: opts.handle,
    email: opts.email,
    baseCurrency: opts.baseCurrency,
    cadenceMonths: opts.cadenceMonths,
    // Must exist and be 0: the proposal quota rule reads this field, and a
    // missing field makes get().data.categoriesCreated error rather than
    // evaluate false — every proposal would fail with no obvious cause.
    categoriesCreated: 0,
    schemaVersion: 1,
  }
  batch.set(doc(db, 'users', uid), {
    ...profile, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })

  // Created empty so an unfiltered collection-group read yields both
  // "accounts created" and "accounts that saved something" (PLAN.md §5).
  batch.set(doc(db, 'users', uid, 'stats', 'current'), {
    net: null, currency: opts.baseCurrency, asOfDate: null,
  })

  try {
    await batch.commit()
  } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') {
      throw new HandleTakenError(opts.handle)
    }
    throw e
  }
  return profile
}

/**
 * Drop keys whose value is undefined.
 *
 * Firestore throws on undefined rather than treating it as absent. The
 * alternative — `ignoreUndefinedProperties: true` on the client — would also
 * silently swallow a cleared field under merge:true and leave the stale value
 * behind, so the explicit strip is the safer of the two.
 */
function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

export type SnapshotDraft = Omit<Snapshot, 'recordedAt' | 'updatedAt' | 'totals'>

/**
 * Write a snapshot, then re-read everything from the server.
 *
 * The re-read is required, not defensive. `serverTimestamp()` is a sentinel:
 * the local echo of your own write returns null for that field until the server
 * resolves it, so without this the UI would render "Last updated: —" straight
 * after saving.
 */
export async function saveSnapshot(
  uid: string,
  draft: SnapshotDraft,
  categories: Category[],
  existing: Snapshot[],
): Promise<LoadedData> {
  const db = getDb()
  const totals = computeTotals(
    draft.holdings, kindLookup(categories), draft.fxRates, draft.baseCurrency,
  )

  const prior = existing.find((s) => s.asOfDate === draft.asOfDate)
  const isNewest = existing.every((s) => s.asOfDate <= draft.asOfDate)

  const batch = writeBatch(db)
  batch.set(
    doc(db, 'users', uid, 'snapshots', draft.asOfDate),
    {
      ...draft,
      holdings: draft.holdings.map(stripUndefined),
      // Firestore rejects undefined outright, and an absent key under
      // merge:true would leave a previously saved note in place — so clearing
      // one has to be an explicit delete, not an omission.
      note: draft.note?.trim() ? draft.note.trim() : deleteField(),
      totals,
      // Preserve the original recording time across edits; only updatedAt moves.
      recordedAt: prior?.recordedAt ? Timestamp.fromMillis(prior.recordedAt) : serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )

  // Only the newest snapshot denormalizes up to the admin-readable stats doc —
  // editing 2024 must not make it look like this year's number.
  if (isNewest) {
    batch.set(doc(db, 'users', uid, 'stats', 'current'), {
      net: totals.net, currency: draft.baseCurrency, asOfDate: draft.asOfDate,
    })
  }

  await batch.commit()
  return hardRefresh(uid)
}

export class ProposalExistsError extends Error {
  constructor(slug: string) {
    super(`"${slug}" has already been proposed`)
    this.name = 'ProposalExistsError'
  }
}

export class QuotaExceededError extends Error {
  constructor() {
    super('You have reached the limit on category suggestions')
    this.name = 'QuotaExceededError'
  }
}

/**
 * Add a category to the user's private tier, optionally suggesting it globally.
 *
 * The private write lands first and on its own, so the category is usable
 * immediately — nobody waits on a review to record their own net worth. The
 * proposal is a separate, optional batch.
 *
 * That batch must carry the `categoriesCreated` increment: the rules assert
 * `getAfter(profile).categoriesCreated == get(profile).categoriesCreated + 1`,
 * which is how a quota gets enforced with no server to count anything.
 */
export async function addCustomCategory(
  uid: string,
  opts: {
    slug: string
    label: string
    kind: Category['kind']
    group: Category['group']
    proposeGlobal: boolean
    handle: string
    categoriesCreated: number
  },
): Promise<{ category: Category; proposed: boolean }> {
  const db = getDb()
  const { slug, label, kind, group } = opts
  const customRef = doc(db, 'users', uid, 'customCategories', slug)

  // Written first and alone, so the category is usable immediately. The flag
  // starts false and only flips if the proposal actually lands.
  await setDoc(customRef, {
    label, kind, group, createdAt: serverTimestamp(), proposedToGlobal: false,
  })

  const category: Category = { id: slug, label, kind, group, tier: 'custom' }
  if (!opts.proposeGlobal) return { category, proposed: false }

  // The increment is not bookkeeping — the rules assert
  // getAfter(profile).categoriesCreated == get(profile).categoriesCreated + 1,
  // which is how a quota is enforced with no server able to count anything.
  //
  // set() rather than a create() the web SDK does not have: create-only
  // semantics come from the rules, where `allow update` on a proposal is
  // admin-only, so writing over someone else's proposal is denied.
  const batch = writeBatch(db)
  batch.set(doc(db, 'categoryProposals', slug), {
    label, kind, group,
    proposedBy: uid,
    proposedByHandle: opts.handle,
    proposedAt: serverTimestamp(),
    status: 'pending',
  })
  batch.update(doc(db, 'users', uid), {
    categoriesCreated: increment(1), updatedAt: serverTimestamp(),
  })
  batch.update(customRef, { proposedToGlobal: true })

  try {
    await batch.commit()
  } catch (e) {
    if ((e as { code?: string }).code !== 'permission-denied') throw e
    // A rules rejection carries no reason, and the two causes are
    // indistinguishable from here: a proposal by someone else is unreadable to
    // us, so we cannot probe for it. Lean on the count we already hold.
    throw opts.categoriesCreated >= 15 ? new QuotaExceededError() : new ProposalExistsError(slug)
  }

  return { category, proposed: true }
}

/* ---------------------------------------------------------------- admin --- */

export interface CurrencyAggregate {
  currency: string
  accounts: number
  total: number
  median: number
  min: number
  max: number
}

export interface AdminStats {
  /** Every account, including those that signed up and never saved anything. */
  created: number
  /** Accounts with at least one snapshot. The gap between the two is drop-off. */
  active: number
  byCurrency: CurrencyAggregate[]
}

/**
 * Aggregates for the admin console — deliberately identity-free.
 *
 * The rules grant the admin claim read on `stats` subcollections and nothing
 * else: no profile, no handle, no email, no holdings. This is not a UI promise
 * that could be edited away in the bundle — there is no query the console
 * *could* run that returns a name.
 *
 * Caveat kept honest: collection-group paths embed the uid, so rows are
 * pseudonymous rather than anonymous. And the Firebase Console ignores rules
 * entirely, so this constrains the app, not the operator.
 *
 * One read per account. Fine into the low thousands; past that, swap the count
 * for getCountFromServer and accept that medians still need the full read.
 */
export async function loadAdminStats(): Promise<AdminStats> {
  const db = getDb()
  const snap = await getDocsFromServer(collectionGroup(db, 'stats'))
  const rows = snap.docs.map((d) => d.data() as { net: number | null; currency: string })

  const withData = rows.filter((r) => r.net != null)
  const buckets = new Map<string, number[]>()
  for (const r of withData) {
    const list = buckets.get(r.currency) ?? []
    list.push(r.net as number)
    buckets.set(r.currency, list)
  }

  const byCurrency = [...buckets.entries()]
    .map(([currency, values]) => {
      const sorted = [...values].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return {
        currency,
        accounts: sorted.length,
        total: sorted.reduce((a, b) => a + b, 0),
        // Never convert across currencies here: per-currency reporting is the
        // entire point, and each figure is already in its owner's own base.
        median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
        min: sorted[0],
        max: sorted[sorted.length - 1],
      }
    })
    .sort((a, b) => b.accounts - a.accounts)

  return { created: rows.length, active: withData.length, byCurrency }
}

export async function loadProposals(): Promise<CategoryProposal[]> {
  const db = getDb()
  const snap = await getDocsFromServer(
    query(collection(db, 'categoryProposals'), orderBy('proposedAt', 'desc')),
  )
  return snap.docs.map((d) => ({
    id: d.id, ...d.data(), proposedAt: ms(d.data().proposedAt),
  })) as CategoryProposal[]
}

/**
 * Approve in one batch: the catalog entry and the verdict land together or not
 * at all. The proposer's private copy is left alone — both tiers key on the same
 * slug, so the global one shadows it on merge. No migration, and every historical
 * snapshot referencing that categoryId keeps resolving.
 */
export async function approveProposal(p: CategoryProposal, reviewerUid: string): Promise<void> {
  const db = getDb()
  const batch = writeBatch(db)
  batch.set(doc(db, 'categories', p.id), {
    label: p.label, kind: p.kind, group: p.group,
    createdBy: p.proposedBy, createdAt: serverTimestamp(),
  })
  batch.update(doc(db, 'categoryProposals', p.id), {
    status: 'approved', reviewedBy: reviewerUid, reviewedAt: serverTimestamp(),
  })
  await batch.commit()
}

export async function rejectProposal(
  slug: string, reviewerUid: string, reason: string,
): Promise<void> {
  await updateDoc(doc(getDb(), 'categoryProposals', slug), {
    status: 'rejected', reviewedBy: reviewerUid, reviewedAt: serverTimestamp(),
    rejectionReason: reason,
  })
}

/* --------------------------------------------------------- account exit --- */

export interface DeletionSummary {
  snapshots: number
  customCategories: number
  proposalsWithdrawn: number
  handleReleased: boolean
}

/**
 * Delete everything this account owns.
 *
 * Firestore has no recursive delete from a client, so every document is
 * enumerated and removed explicitly. Volumes here are tiny — a lifetime of
 * yearly snapshots is ~20 documents — so a single batch covers it comfortably
 * inside the 500-operation limit.
 *
 * Order matters: Firestore data goes first, while the user is still
 * authenticated and the rules still recognise them as the owner. Deleting the
 * auth record first would strip that permission and strand the data forever
 * with no one able to reach it.
 *
 * What deliberately survives, and is stated plainly in the UI rather than
 * quietly omitted: category suggestions already approved into the shared
 * catalog. They belong to every user by then, and pulling one would break every
 * historical snapshot referencing that slug.
 */
export async function deleteAccount(uid: string, handle: string): Promise<DeletionSummary> {
  const db = getDb()

  const [snaps, customs, proposals] = await Promise.all([
    getDocsFromServer(collection(db, 'users', uid, 'snapshots')),
    getDocsFromServer(collection(db, 'users', uid, 'customCategories')),
    getDocsFromServer(
      query(collection(db, 'categoryProposals'), where('proposedBy', '==', uid)),
    ),
  ])

  const batch = writeBatch(db)
  snaps.docs.forEach((d) => batch.delete(d.ref))
  customs.docs.forEach((d) => batch.delete(d.ref))

  // Only pending ones: the rules refuse a decided proposal, and a rejection
  // needs to persist so the same slug cannot simply be resubmitted.
  const pending = proposals.docs.filter((d) => d.data().status === 'pending')
  pending.forEach((d) => batch.delete(d.ref))

  batch.delete(doc(db, 'users', uid, 'stats', 'current'))
  batch.delete(doc(db, 'handles', handle))
  batch.delete(doc(db, 'users', uid))

  await batch.commit()

  return {
    snapshots: snaps.size,
    customCategories: customs.size,
    proposalsWithdrawn: pending.length,
    handleReleased: true,
  }
}
