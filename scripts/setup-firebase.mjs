#!/usr/bin/env node
/**
 * One-off Firebase setup. Run from your laptop with a service-account key —
 * this is never deployed and the key must never be committed.
 *
 *   node scripts/setup-firebase.mjs seed
 *   node scripts/setup-firebase.mjs admin you@gmail.com
 *   node scripts/setup-firebase.mjs status
 *
 * The Admin SDK bypasses security rules entirely, which is precisely why the
 * seed works even though /categories is admin-write-only in firestore.rules.
 */
import { readFileSync } from 'node:fs'
import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? './serviceAccountKey.json'

let credentials
try {
  credentials = JSON.parse(readFileSync(KEY, 'utf8'))
} catch {
  console.error(
    `\nCould not read a service-account key at ${KEY}\n\n` +
      'Firebase Console -> Project settings -> Service accounts -> Generate new private key.\n' +
      'Save it as serviceAccountKey.json in the repo root (already gitignored), or set\n' +
      'GOOGLE_APPLICATION_CREDENTIALS to its path.\n',
  )
  process.exit(1)
}

initializeApp({ credential: cert(credentials) })
const db = getFirestore()
const auth = getAuth()

/**
 * The starting catalog. `group` drives chart colour families, so equity/debt/
 * real-estate read as related rather than as 20 unrelated hues.
 */
const CATEGORIES = [
  // [slug, label, kind, group, regions]
  //
  // GLOBAL is for instruments that exist everywhere. Everything else is tagged
  // with the jurisdictions it belongs to, which is what stops someone in Toronto
  // being offered PPF and someone in Mumbai being offered a 529.
  ['savings-account', 'Savings Account', 'asset', 'cash'],
  ['cash', 'Cash', 'asset', 'cash'],
  ['fixed-deposits', 'Fixed & Recurring Deposits', 'asset', 'debt'],
  ['mutual-funds', 'Mutual Funds', 'asset', 'equity'],
  ['direct-equity', 'Direct Equity', 'asset', 'equity'],
  ['esop-rsu', 'ESOP / RSU', 'asset', 'equity'],
  ['epf', 'EPF', 'asset', 'debt'],
  ['ppf', 'PPF', 'asset', 'debt'],
  ['nps', 'NPS', 'asset', 'debt'],
  ['bonds', 'Bonds', 'asset', 'debt'],
  ['gold', 'Gold', 'asset', 'commodity'],
  ['real-estate', 'Real Estate', 'asset', 'real-estate'],
  ['crypto', 'Crypto', 'asset', 'alternative'],
  ['insurance-cash-value', 'Insurance (Cash Value)', 'asset', 'debt'],
  ['receivables', 'Receivables', 'asset', 'debt'],
  ['home-loan', 'Home Loan', 'liability', 'liability'],
  ['car-loan', 'Car Loan', 'liability', 'liability'],
  ['personal-loan', 'Personal Loan', 'liability', 'liability'],
  ['education-loan', 'Education Loan', 'liability', 'liability'],
  ['credit-card', 'Credit Card Outstanding', 'liability', 'liability'],
]

/** Jurisdiction-specific instruments, added to the same global catalog. */
const REGIONAL = [
  ['elss', 'ELSS', 'asset', 'equity', ['IN']],
  ['ssy', 'Sukanya Samriddhi', 'asset', 'debt', ['IN']],
  ['sgb', 'Sovereign Gold Bonds', 'asset', 'commodity', ['IN']],
  ['401k', '401(k)', 'asset', 'equity', ['US']],
  ['roth-ira', 'Roth IRA', 'asset', 'equity', ['US']],
  ['traditional-ira', 'Traditional IRA', 'asset', 'equity', ['US']],
  ['hsa', 'HSA', 'asset', 'debt', ['US']],
  ['529-plan', '529 Plan', 'asset', 'equity', ['US']],
  ['espp', 'ESPP', 'asset', 'equity', ['US']],
  ['treasury-bonds', 'Treasury / I-Bonds', 'asset', 'debt', ['US']],
  ['rrsp', 'RRSP', 'asset', 'equity', ['CA']],
  ['tfsa', 'TFSA', 'asset', 'equity', ['CA']],
  ['resp', 'RESP', 'asset', 'equity', ['CA']],
  ['fhsa', 'FHSA', 'asset', 'equity', ['CA']],
  ['lira', 'LIRA', 'asset', 'equity', ['CA']],
  ['isa', 'ISA', 'asset', 'equity', ['GB']],
  ['sipp', 'SIPP', 'asset', 'equity', ['GB']],
  ['premium-bonds', 'Premium Bonds', 'asset', 'debt', ['GB']],
  ['workplace-pension', 'Workplace Pension', 'asset', 'equity', ['GB', 'US', 'CA']],
]

const IN_ONLY = new Set(['epf', 'ppf', 'nps'])

function allSeeds() {
  return [
    ...CATEGORIES.map(([id, label, kind, group]) =>
      [id, label, kind, group, IN_ONLY.has(id) ? ['IN'] : ['GLOBAL']]),
    ...REGIONAL,
  ]
}

async function seed() {
  const ALL = allSeeds()
  const existing = new Set((await db.collection('categories').get()).docs.map((d) => d.id))
  const fresh = ALL.filter(([id]) => !existing.has(id))

  if (fresh.length === 0) {
    console.log(`All ${ALL.length} categories already present. Nothing to do.`)
    return
  }

  const batch = db.batch()
  for (const [id, label, kind, group, regions] of fresh) {
    batch.set(db.collection('categories').doc(id), {
      label, kind, group, regions, createdAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()

  await rebuildCatalog()
  console.log(`Seeded ${fresh.length} categories:`)
  for (const [id, label, , , regions] of fresh) {
    console.log(`  ${id.padEnd(20)} ${String(label).padEnd(26)} ${regions.join(',')}`)
  }
  if (existing.size) console.log(`(${existing.size} already existed, left untouched)`)
}

/**
 * A custom claim rather than an /admins document: exists() would cost one
 * document read per rule evaluation, and the console's whole job is listing
 * many documents, so that read would multiply across every row.
 */
async function admin(email) {
  if (!email) {
    console.error('Usage: node scripts/setup-firebase.mjs admin you@gmail.com')
    process.exit(1)
  }

  let user
  try {
    user = await auth.getUserByEmail(email)
  } catch {
    console.error(
      `No account found for ${email}.\n` +
        'Sign in through the app once first — the account has to exist before it can be flagged.',
    )
    process.exit(1)
  }

  await auth.setCustomUserClaims(user.uid, { admin: true })
  console.log(`Admin claim set for ${email} (uid ${user.uid}).`)
  console.log(
    'The claim reaches the browser on the next token refresh (~1h), or immediately\n' +
      'if you sign out and back in.',
  )
}

/**
 * Compare /catalog/current against /categories.
 *
 * The manifest is a denormalized copy, and seed/approve rebuild it — but nothing
 * catches a change made outside those paths, such as an edit in the Firebase
 * Console where rules do not apply. A manifest listing a category that no longer
 * exists is worse than a slow read: the picker offers it, and the holding points
 * at nothing.
 */
async function catalogDrift() {
  const cats = await db.collection('categories').get()
  const doc = await db.doc('catalog/current').get()
  if (!doc.exists) return { missing: true, stale: [], absent: [] }

  const inCats = new Set(cats.docs.map((d) => d.id))
  const inManifest = new Set((doc.data().categories ?? []).map((c) => c.id))
  return {
    missing: false,
    // In the manifest but not the catalog: the app offers something gone.
    stale: [...inManifest].filter((id) => !inCats.has(id)),
    // In the catalog but not the manifest: the app cannot see something real.
    absent: [...inCats].filter((id) => !inManifest.has(id)),
  }
}

async function status() {
  const cats = await db.collection('categories').get()
  const proposals = await db.collection('categoryProposals').where('status', '==', 'pending').get()
  const { users } = await auth.listUsers(1000)
  const admins = users.filter((u) => u.customClaims?.admin)

  console.log(`categories          ${cats.size}`)
  console.log(`pending proposals   ${proposals.size}`)
  console.log(`accounts            ${users.length}`)
  console.log(`admins              ${admins.length}${admins.length ? ` (${admins.map((u) => u.email).join(', ')})` : ''}`)

  const drift = await catalogDrift()
  if (drift.missing) {
    console.log('catalog             MISSING — run `npm run fb:catalog`')
  } else if (drift.stale.length || drift.absent.length) {
    console.log('catalog             DRIFTED — run `npm run fb:catalog`')
    if (drift.stale.length) console.log(`  offered but deleted: ${drift.stale.join(', ')}`)
    if (drift.absent.length) console.log(`  exists but hidden  : ${drift.absent.join(', ')}`)
  } else {
    console.log('catalog             in sync')
  }
}

async function proposals() {
  const snap = await db.collection('categoryProposals').orderBy('proposedAt', 'desc').get()
  if (snap.empty) {
    console.log('No proposals.')
    return
  }
  const live = new Set((await db.collection('categories').get()).docs.map((d) => d.id))
  for (const d of snap.docs) {
    const p = d.data()
    const mark = p.status === 'pending' ? '?' : p.status === 'approved' ? 'y' : 'n'
    console.log(
      `  [${mark}] ${d.id.padEnd(22)} ${String(p.label).padEnd(24)} ` +
        `${p.kind}/${p.group}  by @${p.proposedByHandle}` +
        (live.has(d.id) ? '  (already global)' : ''),
    )
  }
}

/**
 * Approve in one batch: the catalog entry and the verdict land together or not
 * at all. A half-approved proposal is the kind of state nobody reconciles by
 * hand six months later.
 *
 * The proposer's private copy is deliberately left alone — both tiers key on the
 * same slug, so the global one simply shadows it on merge. No migration, and
 * every historical snapshot referencing that categoryId keeps resolving.
 */
async function approve(slug) {
  if (!slug) {
    console.error('Usage: node scripts/setup-firebase.mjs approve <slug>')
    process.exit(1)
  }
  const ref = db.collection('categoryProposals').doc(slug)
  const snap = await ref.get()
  if (!snap.exists) {
    console.error(`No proposal "${slug}". Run \`npm run fb:proposals\` to list them.`)
    process.exit(1)
  }
  const p = snap.data()
  if ((await db.collection('categories').doc(slug).get()).exists) {
    console.error(`"${slug}" is already in the global catalog.`)
    process.exit(1)
  }

  const batch = db.batch()
  batch.set(db.collection('categories').doc(slug), {
    label: p.label, kind: p.kind, group: p.group, createdAt: FieldValue.serverTimestamp(),
  })
  batch.update(ref, {
    status: 'approved',
    // No signed-in admin in a CLI context. Recorded honestly rather than
    // forged as a uid that never reviewed anything.
    reviewedBy: 'cli',
    reviewedAt: FieldValue.serverTimestamp(),
  })
  await batch.commit()

  await rebuildCatalog()
  console.log(`Approved "${p.label}" (${slug}) -> global catalog.`)
  console.log('Every user sees it on their next refresh.')
}

async function reject(slug) {
  if (!slug) {
    console.error('Usage: node scripts/setup-firebase.mjs reject <slug> [reason]')
    process.exit(1)
  }
  const reason = process.argv.slice(4).join(' ') || 'not a distinct category'
  await db.collection('categoryProposals').doc(slug).update({
    status: 'rejected',
    reviewedBy: 'cli',
    reviewedAt: FieldValue.serverTimestamp(),
    rejectionReason: reason,
  })
  console.log(`Rejected ${slug}: ${reason}`)
  console.log("The proposer keeps their private copy — rejection is not deletion.")
}

/**
 * Per-account detail. Written to verify that "delete my account" actually
 * deletes: run it before and after, and every document below should be gone.
 */
async function inspect() {
  const { users } = await auth.listUsers(1000)
  console.log(`auth accounts: ${users.length}`)
  for (const u of users) {
    const [snaps, customs, stats, prof] = await Promise.all([
      db.collection(`users/${u.uid}/snapshots`).get(),
      db.collection(`users/${u.uid}/customCategories`).get(),
      db.doc(`users/${u.uid}/stats/current`).get(),
      db.doc(`users/${u.uid}`).get(),
    ])
    console.log(`  ${u.email}  (${u.uid})`)
    console.log(
      `    profile=${prof.exists} handle=${prof.data()?.handle ?? '-'} ` +
        `snapshots=${snaps.size} custom=${customs.size} stats=${stats.exists}`,
    )
  }
  const handles = await db.collection('handles').get()
  console.log('handles      :', handles.docs.map((d) => d.id).join(', ') || '(none)')
  const props = await db.collection('categoryProposals').get()
  console.log('proposals    :', props.docs.map((d) => `${d.id}:${d.data().status}`).join(', ') || '(none)')
}

/**
 * Move each user's snapshots into a default portfolio (PLAN-portfolios.md §3).
 *
 * Idempotent: a user who already has portfolios is skipped, so a partial run can
 * simply be repeated. Copies are verified before the originals are deleted —
 * losing a year of snapshots to a half-finished migration is the one outcome
 * worth being paranoid about.
 *
 * Pass --commit to actually write; without it this only reports.
 */
async function migratePortfolios() {
  const commit = process.argv.includes('--commit')
  const { users } = await auth.listUsers(1000)
  console.log(commit ? 'MIGRATING\n' : 'DRY RUN — pass --commit to apply\n')

  for (const u of users) {
    const userRef = db.doc(`users/${u.uid}`)
    const prof = await userRef.get()
    if (!prof.exists) continue

    const existing = await userRef.collection('portfolios').get()
    if (!existing.empty) {
      console.log(`  ${u.email}: already has ${existing.size} portfolio(s), skipping`)
      continue
    }

    const legacy = await userRef.collection('snapshots').get()
    const currency = prof.data().baseCurrency ?? prof.data().displayCurrency ?? 'INR'
    console.log(`  ${u.email}: ${legacy.size} snapshot(s) -> portfolios/main (${currency})`)
    if (!commit) continue

    const batch = db.batch()
    batch.set(userRef.collection('portfolios').doc('main'), {
      label: 'Main',
      region: null,
      baseCurrency: currency,
      cadenceMonths: prof.data().cadenceMonths ?? 12,
      order: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    for (const d of legacy.docs) {
      batch.set(userRef.collection('portfolios').doc('main').collection('snapshots').doc(d.id), d.data())
    }
    // baseCurrency splits: what a folio is kept in vs what the user is looking at.
    batch.update(userRef, {
      displayCurrency: currency,
      schemaVersion: 2,
      baseCurrency: FieldValue.delete(),
      cadenceMonths: FieldValue.delete(),
    })
    await batch.commit()

    // Only now, with copies confirmed on the server, remove the originals.
    const copied = await userRef.collection('portfolios').doc('main').collection('snapshots').get()
    if (copied.size !== legacy.size) {
      console.error(`    ABORT: copied ${copied.size} of ${legacy.size}; originals left in place`)
      continue
    }
    const del = db.batch()
    legacy.docs.forEach((d) => del.delete(d.ref))
    await del.commit()
    console.log(`    done: ${copied.size} copied, originals removed`)
  }

  // Existing categories predate the regions field.
  const cats = await db.collection('categories').get()
  const missing = cats.docs.filter((d) => !d.data().regions)
  console.log(`\ncategories without regions: ${missing.length}`)
  if (commit && missing.length) {
    const IN = new Set(['epf', 'ppf', 'nps', 'fixed-deposits'])
    const batch = db.batch()
    missing.forEach((d) => batch.update(d.ref, { regions: IN.has(d.id) ? ['IN'] : ['GLOBAL'] }))
    await batch.commit()
    console.log(`  tagged ${missing.length}`)
  }
}

/**
 * Find and remove orphaned documents.
 *
 * This cannot live in the app. Deleting a Firestore document does not delete its
 * subcollections, and the surviving children are invisible to the client SDK —
 * `getDocs()` only returns documents that have fields, so a parent that exists
 * *solely* as the ancestor of a subcollection is skipped entirely. Only the
 * Admin SDK can enumerate them, via listDocuments() and listCollections().
 *
 * Five kinds of orphan are possible here:
 *   1. Firestore data for an account no longer in Firebase Auth
 *   2. A /users/{uid} that exists only as a parent — subtree with no profile
 *   3. Snapshots under a portfolio document that was removed
 *   4. A /handles entry pointing at a uid with no profile — a name held hostage
 *   5. Proposals from an account that no longer exists
 *
 * Reports by default; --commit deletes. Cleanup uses recursiveDelete, which the
 * Admin SDK implements children-first via BulkWriter — the same ordering the
 * client code has to do by hand.
 */
async function orphans() {
  const commit = process.argv.includes('--commit')
  const { users } = await auth.listUsers(1000)
  const liveUids = new Set(users.map((u) => u.uid))

  const found = []

  // listDocuments() returns references INCLUDING ones with no fields of their
  // own — which is exactly what a .get() based scan would miss.
  const userRefs = await db.collection('users').listDocuments()

  for (const ref of userRefs) {
    const snap = await ref.get()
    const subs = await ref.listCollections()

    if (!snap.exists) {
      if (subs.length) {
        found.push({ kind: 'subtree with no profile', ref, detail: subs.map((c) => c.id).join(', ') })
      }
      continue
    }
    if (!liveUids.has(ref.id)) {
      found.push({ kind: 'data for a deleted auth account', ref, detail: snap.data().handle ?? ref.id })
      continue
    }

    // Snapshots whose portfolio document is gone.
    const folioRefs = await ref.collection('portfolios').listDocuments()
    for (const f of folioRefs) {
      const fSnap = await f.get()
      if (fSnap.exists) continue
      const inner = await f.collection('snapshots').get()
      if (inner.size) {
        found.push({ kind: 'snapshots under a deleted portfolio', ref: f, detail: `${inner.size} snapshot(s)` })
      }
    }
  }

  // Handles pointing nowhere: these block a name for everyone else.
  const handles = await db.collection('handles').get()
  for (const h of handles.docs) {
    const owner = h.data().uid
    if (!liveUids.has(owner) || !(await db.doc(`users/${owner}`).get()).exists) {
      found.push({ kind: 'handle with no owner', ref: h.ref, detail: `@${h.id}` })
    }
  }

  // Proposals from accounts that no longer exist. Approved ones are left alone:
  // the category is in the shared catalog by then and its provenance still matters.
  const props = await db.collection('categoryProposals').get()
  for (const p of props.docs) {
    const d = p.data()
    if (d.status !== 'pending') continue
    if (!liveUids.has(d.proposedBy)) {
      found.push({ kind: 'pending proposal from a deleted account', ref: p.ref, detail: p.id })
    }
  }

  if (!found.length) {
    console.log('No orphans. Every document has a live parent.')
    return
  }

  console.log(commit ? 'DELETING\n' : 'DRY RUN — pass --commit to delete\n')
  for (const f of found) console.log(`  [${f.kind}] ${f.ref.path}  — ${f.detail}`)

  if (!commit) {
    console.log(`\n${found.length} orphan(s). Re-run with --commit to remove them.`)
    return
  }

  // recursiveDelete handles children before parents itself, which is the whole
  // reason to use it rather than a hand-rolled batch.
  for (const f of found) {
    await db.recursiveDelete(f.ref)
    console.log(`  removed ${f.ref.path}`)
  }
  console.log(`\nRemoved ${found.length} orphan(s).`)
}

/**
 * Rebuild /catalog/current from /categories.
 *
 * Denormalization needs an owner or it drifts. This is it: seed and approve both
 * call it, and it can be run by hand if the two ever disagree. The manifest is a
 * few KB against a 1 MB document limit, so it holds thousands of categories.
 */
async function rebuildCatalog() {
  const snap = await db.collection('categories').get()
  const categories = snap.docs
    .map((d) => ({
      id: d.id,
      label: d.data().label,
      kind: d.data().kind,
      group: d.data().group,
      regions: d.data().regions ?? ['GLOBAL'],
    }))
    .sort((a, b) => a.label.localeCompare(b.label))

  await db.doc('catalog/current').set({
    categories,
    count: categories.length,
    // Lets a client tell one build from another without reading the array.
    version: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  })

  const bytes = Buffer.byteLength(JSON.stringify(categories))
  console.log(`catalog/current rebuilt: ${categories.length} categories, ${(bytes / 1024).toFixed(1)} KB`)
  console.log(`  a session now reads 1 document here instead of ${categories.length}`)
}

const [cmd, arg] = process.argv.slice(2)
const commands = {
  seed, admin, status, proposals, approve, reject, inspect, orphans,
  'rebuild-catalog': rebuildCatalog,
  'migrate-portfolios': migratePortfolios,
}

if (!commands[cmd]) {
  console.error(
    'Usage: node scripts/setup-firebase.mjs <command>\n\n' +
      '  seed                    write the starter category catalog\n' +
      '  admin <email>           grant the admin custom claim\n' +
      '  status                  counts of categories, proposals, accounts, admins\n' +
      '  inspect                 per-account documents, for verifying deletion\n' +
      '  migrate-portfolios      move snapshots into a default portfolio (--commit)\n' +
      '  orphans                 find documents whose parent is gone (--commit to delete)\n' +
      '  rebuild-catalog         regenerate /catalog/current from /categories\n' +
      '  proposals               list every proposal and its verdict\n' +
      '  approve <slug>          publish a proposal to the global catalog\n' +
      '  reject <slug> [reason]  record a rejection\n',
  )
  process.exit(1)
}

await commands[cmd](arg)
process.exit(0)
