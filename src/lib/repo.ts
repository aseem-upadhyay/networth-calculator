import type { DocumentReference } from 'firebase/firestore'
import {
  collection, collectionGroup, deleteField, doc, getDocFromServer, getDocsFromServer,
  deleteDoc, increment, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where,
  writeBatch,
} from 'firebase/firestore'
import { getDb } from './firebase'
import { computeTotals, kindLookup } from './calc'
import { mergeCategories, readCategories, writeCategories, writePrivateCache } from './cache'
import type { Backup } from './export'
import type { Category, CategoryProposal, Portfolio, Profile, Snapshot } from './types'

/** Firestore Timestamp -> epoch ms. Null while a serverTimestamp() is unresolved. */
function ms(v: unknown): number | null {
  return v instanceof Timestamp ? v.toMillis() : null
}

export interface LoadedData {
  profile: Profile | null
  portfolios: Portfolio[]
  /** portfolioId -> that folio's own timeline. Each has its own dates. */
  snapshots: Record<string, Snapshot[]>
  categories: Category[]
}

function toSnapshot(id: string, raw: Record<string, unknown>): Snapshot {
  return {
    ...raw,
    asOfDate: id,
    recordedAt: ms(raw.recordedAt),
    updatedAt: ms(raw.updatedAt),
  } as Snapshot
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
export async function hardRefresh(uid: string, opts: { force?: boolean } = {}): Promise<LoadedData> {
  const db = getDb()

  const [profSnap, folioSnap, globalCats, customSnap] = await Promise.all([
    getDocFromServer(doc(db, 'users', uid)),
    getDocsFromServer(query(collection(db, 'users', uid, 'portfolios'), orderBy('order'))),
    loadGlobalCategories(opts.force),
    getDocsFromServer(collection(db, 'users', uid, 'customCategories')),
  ])

  const profile = profSnap.exists() ? (profSnap.data() as Profile) : null
  const portfolios: Portfolio[] = folioSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Portfolio)

  // One query per portfolio. A collection-group query cannot be scoped to a
  // single user's subtree without a redundant uid field on every snapshot, and
  // nobody has enough portfolios for the fan-out to matter.
  const timelines = await Promise.all(
    portfolios.map((p) =>
      getDocsFromServer(
        query(collection(db, 'users', uid, 'portfolios', p.id, 'snapshots'), orderBy('asOfDate')),
      ),
    ),
  )

  const snapshots: Record<string, Snapshot[]> = {}
  portfolios.forEach((p, i) => {
    snapshots[p.id] = timelines[i].docs.map((d) => toSnapshot(d.id, d.data()))
  })

  const toCategory = (tier: Category['tier']) => (d: { id: string; data: () => any }): Category => ({
    regions: ['GLOBAL'], // pre-migration documents carry no regions field
    id: d.id, ...d.data(), tier,
  })

  // Union by slug, global winning ties — so approving a proposal needs no
  // migration: the private copy is simply shadowed by the identical global one.
  const categories = mergeCategories(
    globalCats,
    customSnap.docs.map(toCategory('custom')),
  )

  if (profile) writePrivateCache(uid, { profile, portfolios, snapshots })
  writeCategories(categories)

  return { profile, portfolios, snapshots, categories }
}

/**
 * Read the global catalog from its single manifest document.
 *
 * Falls back to the collection if the manifest is missing — a project that has
 * not run `fb:catalog` yet must still work, and a stale manifest is a worse
 * failure than a slow read. The fallback costs one document read per category,
 * which is what this exists to avoid, so it is a safety net rather than a path
 * anything should sit on.
 */
async function loadGlobalCategories(force = false): Promise<Category[]> {
  const db = getDb()

  // Fresh copy in localStorage costs nothing at all. The catalog is the same for
  // every user and changes rarely, so most sessions should not touch the network
  // for it. Refresh forces past this.
  if (!force) {
    const cached = readCategories()
    if (cached?.length) return cached.filter((c) => c.tier === 'global')
  }

  try {
    const manifest = await getDocFromServer(doc(db, 'catalog', 'current'))
    if (manifest.exists()) {
      const data = manifest.data() as { categories: Omit<Category, 'tier'>[] }
      return data.categories.map((c) => ({ ...c, regions: c.regions ?? ['GLOBAL'], tier: 'global' }))
    }
  } catch {
    // The manifest may not be readable yet — its rule ships separately from this
    // code. Falling back keeps the app working during that window; it just costs
    // the reads this exists to save.
  }

  const snap = await getDocsFromServer(collection(db, 'categories'))
  return snap.docs.map((d) => {
    const raw = d.data() as Partial<Category>
    // Documents written before regions existed default to everywhere.
    return { ...raw, regions: raw.regions ?? ['GLOBAL'], id: d.id, tier: 'global' } as Category
  })
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
  opts: {
    handle: string; email: string; baseCurrency: string; cadenceMonths: 6 | 12
    portfolioLabel?: string; region?: string | null
  },
): Promise<{ profile: Profile; portfolio: Portfolio }> {
  const db = getDb()
  const batch = writeBatch(db)

  batch.set(doc(db, 'handles', opts.handle), {
    uid, createdAt: serverTimestamp(),
  })

  const profile: Profile = {
    handle: opts.handle,
    email: opts.email,
    displayCurrency: opts.baseCurrency,
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

  // Every account starts with one portfolio. With a single folio the concept
  // should be invisible; it only surfaces once a second one exists.
  const portfolio: Portfolio = {
    id: DEFAULT_PORTFOLIO_ID,
    label: opts.portfolioLabel ?? 'Main',
    region: opts.region ?? null,
    baseCurrency: opts.baseCurrency,
    cadenceMonths: opts.cadenceMonths,
    order: 0,
  }
  const { id: _id, ...portfolioDoc } = portfolio
  batch.set(doc(db, 'users', uid, 'portfolios', portfolio.id), {
    ...portfolioDoc, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })

  try {
    await batch.commit()
  } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') {
      throw new HandleTakenError(opts.handle)
    }
    throw e
  }
  return { profile, portfolio }
}

export const DEFAULT_PORTFOLIO_ID = 'main'

/** Create an additional portfolio. */
export async function createPortfolio(uid: string, p: Portfolio): Promise<Portfolio> {
  const { id, ...rest } = p
  await setDoc(doc(getDb(), 'users', uid, 'portfolios', id), {
    ...rest, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  return p
}

export async function updatePortfolio(
  uid: string, id: string, patch: Partial<Omit<Portfolio, 'id'>>,
): Promise<void> {
  await updateDoc(doc(getDb(), 'users', uid, 'portfolios', id), {
    ...patch, updatedAt: serverTimestamp(),
  })
}

/**
 * Delete a portfolio and its whole timeline.
 *
 * Its snapshots are a level deeper than the document being removed, and
 * Firestore has no recursive delete from a client — deleting only the parent
 * would orphan years of history somewhere unreachable and still billable.
 */
export async function deletePortfolio(uid: string, id: string): Promise<number> {
  const ref = doc(getDb(), 'users', uid, 'portfolios', id)
  const snaps = await getDocsFromServer(collection(ref, 'snapshots'))

  // Snapshots first, then the portfolio itself. See deleteLevels.
  await deleteLevels([snaps.docs.map((d) => d.ref), [ref]])

  const left = await getDocsFromServer(collection(ref, 'snapshots'))
  if (!left.empty) {
    throw new Error(
      `Deleted the portfolio but ${left.size} snapshot(s) remain. Re-run to finish clearing them.`,
    )
  }
  return snaps.size
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

/**
 * Change the currency the user is looking at.
 *
 * History is untouched: every snapshot keeps its own baseCurrency and its own
 * frozen rate table, and the UI converts through those. So switching from INR
 * to CAD re-expresses years of history at the rates that applied on each
 * valuation date — it does not rewrite anything, and switching back is exact.
 */
export async function setDisplayCurrency(uid: string, currency: string): Promise<void> {
  await updateDoc(doc(getDb(), 'users', uid), {
    displayCurrency: currency, updatedAt: serverTimestamp(),
  })
}

/**
 * Recompute the admin-readable stats figure across every portfolio.
 *
 * Combined net worth blends dates by design: each portfolio contributes its most
 * recent snapshot, and those are rarely the same day. `asOfDate` records the
 * newest of them, so a reader knows how current the freshest input is — the
 * dashboard shows the full provenance.
 */
export async function updateCombinedStats(uid: string, data: LoadedData): Promise<void> {
  if (!data.profile) return
  const display = data.profile.displayCurrency
  const kinds = kindLookup(data.categories)

  let net = 0
  let newest = ''
  for (const p of data.portfolios) {
    const latest = data.snapshots[p.id]?.at(-1)
    if (!latest) continue
    net += computeTotals(latest.holdings, kinds, latest.fxRates, latest.baseCurrency, display).net
    if (latest.asOfDate > newest) newest = latest.asOfDate
  }

  await setDoc(doc(getDb(), 'users', uid, 'stats', 'current'), {
    net, currency: display, asOfDate: newest || null,
  })
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
  portfolioId: string,
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
    doc(db, 'users', uid, 'portfolios', portfolioId, 'snapshots', draft.asOfDate),
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

  await batch.commit()

  // The admin stats figure is now a sum across portfolios, so it cannot be
  // computed from this one write. Refresh first, then denormalize from the
  // complete picture.
  const data = await hardRefresh(uid)
  if (isNewest) await updateCombinedStats(uid, data)
  return data
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
    /** Where this instrument exists; defaults to everywhere. */
    regions?: string[]
  },
): Promise<{ category: Category; proposed: boolean }> {
  const db = getDb()
  const { slug, label, kind, group } = opts
  const customRef = doc(db, 'users', uid, 'customCategories', slug)

  // Written first and alone, so the category is usable immediately. The flag
  // starts false and only flips if the proposal actually lands.
  await setDoc(customRef, {
    label, kind, group, regions: opts.regions ?? ['GLOBAL'],
    createdAt: serverTimestamp(), proposedToGlobal: false,
  })

  const category: Category = {
    id: slug, label, kind, group, regions: opts.regions ?? ['GLOBAL'], tier: 'custom',
  }
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


/* ----------------------------------------------------------- deletion --- */

/**
 * Firestore allows 500 operations per batch. 400 leaves headroom so a caller
 * that adds a couple of writes alongside a delete cannot silently cross the line.
 */
const BATCH_LIMIT = 400

export function chunk<T>(items: T[], size = BATCH_LIMIT): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Delete documents deepest-first, in batches.
 *
 * `levels` must be ordered children before parents, and each level is fully
 * committed before the next begins. That ordering is load-bearing for a reason
 * specific to Firestore: **deleting a document does not delete its
 * subcollections.** A parent removed first stops appearing in collection
 * queries while its children carry on existing — still stored, still billed,
 * and no longer reachable by enumeration, because the only way anything finds
 * them is by walking down from that parent.
 *
 * Within a single batch order is irrelevant, since a batch is atomic. It is
 * across batches that it matters, and anything past 400 documents is more than
 * one batch.
 */
async function deleteLevels(levels: DocumentReference[][]): Promise<number> {
  const db = getDb()
  let deleted = 0

  for (const level of levels) {
    for (const group of chunk(level)) {
      const batch = writeBatch(db)
      group.forEach((ref) => batch.delete(ref))
      await batch.commit()
      deleted += group.length
    }
  }
  return deleted
}

/* --------------------------------------------------------- account exit --- */

export interface DeletionSummary {
  snapshots: number
  portfolios?: number
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

  const [folios, customs, proposals] = await Promise.all([
    getDocsFromServer(collection(db, 'users', uid, 'portfolios')),
    getDocsFromServer(collection(db, 'users', uid, 'customCategories')),
    getDocsFromServer(
      query(collection(db, 'categoryProposals'), where('proposedBy', '==', uid)),
    ),
  ])

  // Firestore has no recursive delete from a client, and a portfolio's snapshots
  // are a level deeper than they used to be — deleting the parent alone would
  // orphan them, invisible and unreachable.
  const timelines = await Promise.all(
    folios.docs.map((d) => getDocsFromServer(collection(d.ref, 'snapshots'))),
  )

  // Only pending ones: the rules refuse a decided proposal, and a rejection
  // needs to persist so the same slug cannot simply be resubmitted.
  const pending = proposals.docs.filter((d) => d.data().status === 'pending')
  const snapshotRefs = timelines.flatMap((t) => t.docs.map((d) => d.ref))

  // Strictly deepest-first. The profile document goes last of all: while it
  // exists the account is still coherent and a failed run can simply be
  // repeated, whereas removing it early would strand everything beneath it.
  await deleteLevels([
    snapshotRefs,
    [
      ...folios.docs.map((d) => d.ref),
      ...customs.docs.map((d) => d.ref),
      ...pending.map((d) => d.ref),
      doc(db, 'users', uid, 'stats', 'current'),
    ],
    [doc(db, 'handles', handle)],
    [doc(db, 'users', uid)],
  ])

  await assertNothingLeft(uid)

  return {
    snapshots: snapshotRefs.length,
    customCategories: customs.size,
    proposalsWithdrawn: pending.length,
    handleReleased: true,
  }
}

/**
 * Re-read the account after deletion and fail loudly if anything survived.
 *
 * "Delete my account" is a promise, and the one failure mode worth catching is
 * the quiet one — a subcollection left behind that no screen will ever show
 * again. Better a visible error the user can act on than a clean-looking
 * success hiding residue.
 */
async function assertNothingLeft(uid: string): Promise<void> {
  const db = getDb()
  const folios = await getDocsFromServer(collection(db, 'users', uid, 'portfolios'))

  const leftovers: string[] = []
  if (!folios.empty) leftovers.push(`${folios.size} portfolio(s)`)

  for (const f of folios.docs) {
    const snaps = await getDocsFromServer(collection(f.ref, 'snapshots'))
    if (!snaps.empty) leftovers.push(`${snaps.size} snapshot(s) under ${f.id}`)
  }

  const customs = await getDocsFromServer(collection(db, 'users', uid, 'customCategories'))
  if (!customs.empty) leftovers.push(`${customs.size} custom categor(ies)`)

  if (leftovers.length) {
    throw new Error(`Deletion incomplete — ${leftovers.join(', ')} remain. Run it again to finish.`)
  }
}

/**
 * Restore a backup.
 *
 * `mode` decides what happens to dates that already exist:
 *   'skip'      leave what is there — nothing is ever destroyed
 *   'overwrite' the file wins for the dates it contains, others are untouched
 *
 * There is deliberately no "wipe everything first" mode. A restore that empties
 * the account before writing has a window where a mid-flight failure leaves
 * nothing at all, and the delete-account flow already exists for people who
 * genuinely want to start over.
 */
export async function importBackup(
  uid: string,
  backup: Backup,
  mode: 'skip' | 'overwrite',
  existingSnapshots: Record<string, { asOfDate: string }[]>,
): Promise<{ portfolios: number; snapshots: number; skipped: number }> {
  const db = getDb()
  const batch = writeBatch(db)
  let written = 0
  let skipped = 0

  for (const p of backup.portfolios) {
    const { id, ...rest } = p
    // merge:true so restoring into an existing folio does not clobber a cadence
    // or label the user has since changed.
    batch.set(doc(db, 'users', uid, 'portfolios', id), { ...rest, updatedAt: serverTimestamp() }, { merge: true })

    const present = new Set((existingSnapshots[id] ?? []).map((s) => s.asOfDate))
    for (const snap of backup.snapshots[id] ?? []) {
      if (mode === 'skip' && present.has(snap.asOfDate)) { skipped += 1; continue }
      // asOfDate becomes the document id; both timestamps are re-stamped below.
      const { asOfDate, recordedAt, updatedAt: _updatedAt, ...body } = snap
      batch.set(doc(db, 'users', uid, 'portfolios', id, 'snapshots', asOfDate), {
        ...body,
        // Preserve when it was originally recorded; stamp the restore itself.
        recordedAt: recordedAt ? Timestamp.fromMillis(recordedAt) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      written += 1
    }
  }

  await batch.commit()
  return { portfolios: backup.portfolios.length, snapshots: written, skipped }
}

export interface MyProposal {
  id: string
  label: string
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
}

/**
 * The user's own suggestions and how they were ruled on.
 *
 * Rules let a proposer read their own proposals, so this needs no admin rights.
 * Without it, suggesting a category was a write into silence — no way to learn
 * whether it was approved, rejected, or never looked at.
 */
export async function loadMyProposals(uid: string): Promise<MyProposal[]> {
  const db = getDb()
  const snap = await getDocsFromServer(
    query(collection(db, 'categoryProposals'), where('proposedBy', '==', uid)),
  )
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MyProposal)
}

/** Withdraw a suggestion that has not been ruled on yet. */
export async function withdrawProposal(slug: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'categoryProposals', slug))
}

/** Remove one of your own private categories. */
export async function deleteCustomCategory(uid: string, slug: string): Promise<void> {
  await deleteDoc(doc(getDb(), 'users', uid, 'customCategories', slug))
}
