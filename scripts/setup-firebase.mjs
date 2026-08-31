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

async function seed() {
  const existing = new Set((await db.collection('categories').get()).docs.map((d) => d.id))
  const fresh = CATEGORIES.filter(([id]) => !existing.has(id))

  if (fresh.length === 0) {
    console.log(`All ${CATEGORIES.length} categories already present. Nothing to do.`)
    return
  }

  const batch = db.batch()
  for (const [id, label, kind, group] of fresh) {
    batch.set(db.collection('categories').doc(id), {
      label, kind, group, createdAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()

  console.log(`Seeded ${fresh.length} categories:`)
  for (const [id, label] of fresh) console.log(`  ${id.padEnd(24)} ${label}`)
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

async function status() {
  const cats = await db.collection('categories').get()
  const proposals = await db.collection('categoryProposals').where('status', '==', 'pending').get()
  const { users } = await auth.listUsers(1000)
  const admins = users.filter((u) => u.customClaims?.admin)

  console.log(`categories          ${cats.size}`)
  console.log(`pending proposals   ${proposals.size}`)
  console.log(`accounts            ${users.length}`)
  console.log(`admins              ${admins.length}${admins.length ? ` (${admins.map((u) => u.email).join(', ')})` : ''}`)
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

const [cmd, arg] = process.argv.slice(2)
const commands = { seed, admin, status, proposals, approve, reject }

if (!commands[cmd]) {
  console.error(
    'Usage: node scripts/setup-firebase.mjs <command>\n\n' +
      '  seed                    write the starter category catalog\n' +
      '  admin <email>           grant the admin custom claim\n' +
      '  status                  counts of categories, proposals, accounts, admins\n' +
      '  proposals               list every proposal and its verdict\n' +
      '  approve <slug>          publish a proposal to the global catalog\n' +
      '  reject <slug> [reason]  record a rejection\n',
  )
  process.exit(1)
}

await commands[cmd](arg)
process.exit(0)
