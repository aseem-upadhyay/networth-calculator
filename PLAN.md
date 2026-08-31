# Net Worth Calculator — Implementation Plan

A static single-page app for recording a full net-worth snapshot once or twice a year,
backed by Firestore, cached in `sessionStorage`, hosted on GitHub Pages.

**Status:** built. Phases 0–8 complete except JSON *import* (§10), which is deliberately
deferred — it is the destructive half and wants its own design pass on merge-vs-overwrite.

---

## 1. Scope

**In scope**
- Low-frequency snapshot entry (every 6–12 months), each stamped with a timestamp.
- Breakup visualisation (composition of the latest snapshot).
- Growth-by-category visualisation, separating contributions from returns.
- Assets **and** liabilities; the headline number is net worth.
- Per-holding currency with FX conversion to a reporting currency.
- Firestore as system of record; `sessionStorage` as read cache, cleared on logout; manual **Refresh**.
- User-added investment categories: private immediately, global on admin approval.
- Admin console: account count, category approval queue, net-worth totals by currency.
- GitHub Pages hosting.

**Non-goals for v1**
- No broker/bank integrations, no automatic price fetching.
- No sharing of *snapshot* data between users.
- No crypto FX (ECB rates cover fiat only — see §7).
- No mobile app; responsive web only.

---

## 2. Stack and hosting

| Concern | Decision | Why |
|---|---|---|
| Build | Vite + React + TypeScript | Static output, zero-config for Pages; types matter for a schema you touch twice a year |
| Charts | Recharts | Native React; stacked-area, donut, waterfall without wrapper glue |
| Backend | Firebase JS SDK v10+ (modular) | Firestore + Auth from a static host |
| Auth | Firebase Auth, Google provider, `signInWithPopup`, **`browserSessionPersistence`** | Open signup, any Google account. Popup not redirect — redirect breaks under Safari storage partitioning. Session persistence for the reason in §6 |
| Cache | `sessionStorage` for financial data, `localStorage` for public reference data | Split by sensitivity, not by convenience — §6 |
| FX rates | Frankfurter (ECB) — `api.frankfurter.dev/v1` | No API key, CORS-enabled, historical endpoint. Key-free matters: a static bundle cannot hide a secret |
| Routing | Hash-only | Three views; avoids the Pages SPA 404 dance |
| Deploy | GitHub Actions → `actions/deploy-pages` | Build on push to `main` |

**GitHub Pages specifics**
- Project page → set `base: '/networth-calculator/'` in `vite.config.ts`. Getting this wrong ships
  a white page with 404s on every asset — the most common Pages failure by a wide margin.
- Add `<username>.github.io` to Firebase Console → Authentication → Settings → **Authorized domains**.
- The Firebase web config (`apiKey` etc.) is **not a secret** — it is a public client identifier.
  All protection comes from Firestore rules (§5) and App Check. Inject it via `import.meta.env` +
  Actions secrets for hygiene, but do not mistake that for security.

---

## 3. Firestore data model

```
/categories/{categorySlug}                  ← GLOBAL, shared by all users
    label        : "Mutual Funds"
    kind         : "asset" | "liability"
    group        : "equity" | "debt" | "cash" | "real-estate"
                 | "commodity" | "alternative" | "liability"
    createdBy    : <uid>
    createdAt    : serverTimestamp

/handles/{handleSlug}                       ← GLOBAL uniqueness index, create-only
    uid          : <uid>
    createdAt    : serverTimestamp

/users/{uid}                                ← Firebase Auth UID (Google sign-in)
    handle            : "aseem"              ← self-declared, unique via /handles
    email             : "…@gmail.com"         ← from the Google token, display only
    baseCurrency      : "INR"                ← reporting currency for totals & charts
    cadenceMonths     : 6 | 12
    categoriesCreated : 0                    ← quota counter, rule-enforced (§5)
    schemaVersion     : 1
    createdAt, updatedAt
    ↑ owner-only. Admin cannot read this document at all — no handle, no email.

/users/{uid}/stats/current                  ← owner writes, owner + ADMIN read
    net        : 4230000                     ← denormalized from newest snapshot
    currency   : "INR"
    asOfDate   : "2026-08-31"
    ↑ created at signup with net: null, so a collection-group count = accounts created

/users/{uid}/customCategories/{slug}        ← private, usable immediately
    label, kind, group
    createdAt         : serverTimestamp
    proposedToGlobal  : false

/categoryProposals/{slug}                   ← the opt-in queue
    label, kind, group
    proposedBy       : <uid>
    proposedByHandle : "aseem"               ← attribution for review
    proposedAt       : serverTimestamp
    status           : "pending" | "approved" | "rejected"
    reviewedBy, reviewedAt, rejectionReason

/users/{uid}/snapshots/{asOfDate}           ← doc id IS the date: "2026-08-31"
    asOfDate     : "2026-08-31"              ← the date the valuation is *for*
    recordedAt   : serverTimestamp           ← first write (immutable)
    updatedAt    : serverTimestamp           ← last write
    baseCurrency : "INR"                     ← frozen; never rewritten
    fxRates      : { "USD": 83.24, "EUR": 90.11, "GBP": 105.4 }   ← FROZEN at asOfDate
    fxAsOf       : "2026-08-29"              ← actual rate date (ECB skips weekends)
    fxSource     : "frankfurter" | "manual"
    note         : "changed jobs, bought car"
    holdings     : [
        { categoryId: "mutual-funds", amount: 1850000, currency: "INR",
          contributed: 240000, note: "" },
        { categoryId: "rsu",          amount:   42000, currency: "USD",
          contributed:  12000, note: "vested Mar + Sep" },
        { categoryId: "home-loan",    amount:  920000, currency: "INR",
          contributed: 0,      note: "" }
    ]
    totals       : { assets: …, liabilities: …, net: … }   ← in baseCurrency, denormalized
```

**Design notes**

- **Doc id = `asOfDate`.** Idempotency for free: re-entering the same date *edits* that snapshot
  rather than duplicating it. Two snapshots in one day become impossible — irrelevant at this cadence.
- **`holdings` is an embedded array, not a subcollection.** A snapshot is always read and written
  whole, and holds tens of rows, not thousands. One doc read instead of N; the 1 MB limit is far away.
- **Two timestamps, deliberately.** `recordedAt`/`updatedAt` answer "when did I touch this";
  `asOfDate` answers "what date is this true for". They diverge the moment you backdate history or
  enter March's numbers in May.
- **`fxRates` is frozen per snapshot.** This is the single most important decision in the FX design —
  see §7.
- **`totals` is denormalized** so the dashboard and charts render without walking every holding.
  Recompute on load and warn on mismatch; that catches a bad write instead of silently charting it.
- **Snapshots are editable; categories are not.** See §11 F12.

**Read volume:** a lifetime of yearly snapshots is ~20 docs. One full fetch is
`1 profile + N snapshots + M categories` — permanently inside the free tier.

---

## 4. Categories — three tiers

Resolved (Q5): **curated global catalog + private custom categories + opt-in proposal queue.**
This drops the per-user quota from the shared namespace entirely, because the shared namespace is no
longer user-writable. `/categories` becomes admin-write-only, which removes the abuse surface that
the quota was invented to contain. The quota moves to proposals, where the blast radius is a review
list rather than everyone's picker.

| Tier | Path | Who writes | Visible to |
|---|---|---|---|
| Global catalog | `/categories/{slug}` | Admin only | Everyone |
| Private custom | `/users/{uid}/customCategories/{slug}` | Owner | Owner |
| Proposal | `/categoryProposals/{slug}` | Any signed-in user (quota-capped) | Owner + admin |

Seed the global tier with ~20 so the common case never needs an add: savings account, FD/RD, mutual
funds, direct equity, ESOP/RSU, EPF, PPF, NPS, bonds, gold, real estate, crypto, cash, insurance
(cash value), receivables — plus liabilities: home loan, car loan, personal loan, credit-card
outstanding, education loan.

**Add flow**
1. User types a label in the category picker.
2. Client slugifies: `"Mutual  Funds!"` → `mutual-funds`.
3. **Typeahead surfaces near-matches first**, searching global *and* the user's private tier. The
   user must see existing options before "Create new category" becomes clickable.
4. The category is written to `/users/{uid}/customCategories/{slug}` and is **usable immediately** —
   nobody waits on a review to record their own net worth.
5. A checkbox, unticked by default, offers *"Suggest this category for everyone."* Ticking it also
   writes `/categoryProposals/{slug}`. This is the opt-in.

**Resolution at render:** `global ∪ myCustom`, unioned **by slug**, global winning ties. Slug-as-id
makes this a one-liner and means approval needs no migration — the day a proposal is approved, the
user's private copy is silently shadowed by the identical global one, and every historical snapshot
referencing that `categoryId` keeps resolving. Nothing to backfill.

**Proposal lifecycle**
```
user ticks the box  →  /categoryProposals/{slug}  status: pending
                                  ↓  admin console (§5)
        approve ──→ batch: set /categories/{slug} + status: approved
        reject  ──→ status: rejected + rejectionReason
```
Approval is a single `writeBatch`, so the catalog entry and the queue update land together or not at
all — no half-approved state to reconcile by hand six months later.

Duplicate protection is unchanged and still structural: slug-as-doc-id means `"Mutual Funds"`,
`"mutual funds"` and `"MUTUAL FUNDS"` collide at the database, not just in the UI.

Guardrails live in the rules, not the UI, because the UI is a static bundle anyone can bypass.

---

## 5. Identity, access & administration

**Resolved: Google sign-in, open to any personal Google account.** `signInWithPopup` with the Google
provider — popup rather than redirect, because redirect flows break under Safari's storage
partitioning when the app is hosted on a domain you don't control. No email-domain gate.

This gives every user a real `request.auth.uid`, which is the thing that lets rules isolate
`/users/{uid}` to its owner. The self-declared username survives as a **display handle** on the
profile, reverse-indexed at `/handles/{slug} → uid` with create-only rules so a handle is unique and
cannot be taken over. The handle earns a real job beyond cosmetics: it attributes global categories
("added by @aseem"), which is the only moderation signal a serverless app has.

Two consequences of open signup worth naming:

- **The "restricted to a domain" constraint is dropped** — and it was never expressible in Firestore
  rules regardless. Rules see `request.auth`, `request.time`, `request.path` and `request.resource`,
  but never the request origin, so no rule can mean "only from my Pages site". **App Check**
  (reCAPTCHA v3, site key bound to your domain) stays in the plan as the one real defence against
  someone driving the public Firebase config straight from `curl`.
- **The global category collection is now writable by anyone on the internet with a Gmail account**,
  not by a known set of colleagues. That promotes F2 from housekeeping to a genuine abuse surface,
  and it is why the rules below carry a hard per-user creation quota. See Q5.

### Proposal quota, enforced without a server

Rules cannot count a collection, but they *can* assert cross-document state after a batched write.
Requiring every proposal to atomically bump a counter on the proposer's own profile caps queue-flooding
at the database layer:

```ts
// client: one writeBatch() containing both operations, or neither lands
batch.set(proposalRef, { label, kind, group, proposedBy: uid, proposedByHandle: handle,
                         proposedAt: serverTimestamp(), status: 'pending' });
batch.update(userRef, { categoriesCreated: increment(1) });
```

The rule refuses the proposal unless the same batch incremented that counter, and refuses it past the
cap. A script cannot bury the review queue under 400 rows — at most `MAX_PER_USER`.

### Admin identity: a custom claim, not a database flag

Two ways to mark an admin. The database-flag version (`exists(/admins/$(uid))`) costs **one extra
document read per rule evaluation**, and the admin console's whole job is listing many documents — so
that read multiplies across every row. A **custom claim** costs nothing:

```js
// one-off local Node script, service-account key, never deployed
await getAuth().setCustomUserClaims(uid, { admin: true });
```

Rules then check `request.auth.token.admin == true` for free. The claim lands in the ID token on next
refresh (~1 hour, or force it with `getIdToken(true)`), which is irrelevant for a one-time setup. No
Cloud Function, no Blaze plan, nothing deployed — a script you run once from your laptop.

### Admin console

A route in the same static bundle, rendered only when the claim is present. Hiding the route is a UX
nicety, not the security boundary — rules are, and they hold regardless of what JS the browser runs.

**1. Accounts created.** One unfiltered collection-group read, which the aggregate view (item 3) has
to perform anyway:
```ts
const docs = (await getDocs(collectionGroup(db, 'stats'))).docs.map(d => d.data());
const created = docs.length;
const active  = docs.filter(d => d.net != null).length;
```
Because the stats doc is created at signup with `net: null`, this yields two numbers instead of the
one asked for: **accounts created** and **accounts that have actually saved a snapshot**. The gap
between them is the more interesting figure — it is your drop-off rate.

An earlier draft used `getCountFromServer` with `where('net','!=',null)`, which is cheaper per read
but wrong here twice over. Firestore rejects a declared single-field index outright (*"this index is
not necessary, configure using single field index controls"*) — automatic single-field indexes are
not user-declarable, and a collection-group filter on one field needs a `fieldOverrides` entry rather
than an `indexes` entry. More to the point, the aggregate view needs every `net` value anyway to
compute sums and medians, so the count aggregation saved nothing. **Scale caveat:** this is one read
per account. Fine into the low thousands; past that, reintroduce `getCountFromServer` for the bare
count and accept that medians need the full read regardless.

**2. Category approval queue.** `where('status','==','pending')`, each row showing label, kind, group
and `proposedByHandle`. Approve/reject writes the batch from §4. This is where the handle stops being
cosmetic: it is the only attribution a serverless app has when deciding whether a proposal is real.

**3. Net worth aggregates by currency** (Q6: aggregates, no identities). The same collection-group
read as item 1, grouped and summed client-side into count / sum / median / range per currency. Do **not**
convert across currencies — the whole point is per-currency reporting, and each `net` is already in its
owner's own base.

The privacy split is **enforced in the rules, not just in the UI.** Because the denormalized figures
live in `/users/{uid}/stats/current` rather than on the profile, the admin claim grants read on the
stats subcollection and *nothing else*: no handle, no email, no snapshots. The console cannot render an
identified table even if someone edited the JS to try — there is no query that would return a name.
That is the difference between choosing not to look and not being able to.

Three honest caveats, so this isn't oversold:
- **Document paths carry the uid.** A collection-group result is `users/AbC123xyz/stats/current`, so
  rows are pseudonymous, not anonymous. The uid is an opaque Firebase identifier, and the rules block
  the `/users/{uid}` read that would map it to a handle.
- **Rules never constrain the Firebase Console.** As project owner you can read every document and the
  entire Auth user list regardless of what is written above. This design constrains the *deployed app*,
  not the *operator* — which is still worth doing, because it means no accidental exposure through the
  public bundle. It is not a promise you could make to a user about yourself.
- **`net` is written by the user's own client**, in the same batch as the snapshot. Rules cannot
  recompute a sum, so it is an operational signal, not an audited figure. Fine for "is anyone using
  this"; not fine for anything you would act on financially.

### Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null && request.auth.token.email_verified;
    }
    function isAdmin() { return isSignedIn() && request.auth.token.admin == true; }
    function me() { return /databases/$(database)/documents/users/$(request.auth.uid); }
    function quotaBumped() {
      return getAfter(me()).data.categoriesCreated == get(me()).data.categoriesCreated + 1
          && getAfter(me()).data.categoriesCreated <= 15;
    }

    // Profile, snapshots, custom categories: owner-only. The admin claim buys
    // NOTHING here — no handle, no email, no holdings.
    match /users/{uid} {
      allow read, write: if isSignedIn() && request.auth.uid == uid;

      match /snapshots/{snapshotId} {
        allow read, write: if isSignedIn() && request.auth.uid == uid;
      }
      match /customCategories/{slug} {
        allow read, write: if isSignedIn() && request.auth.uid == uid;
      }
      // The one admin-readable island: a bare number, its currency, its date.
      match /stats/{docId} {
        allow read:  if isSignedIn() && (request.auth.uid == uid || isAdmin());
        allow write: if isSignedIn() && request.auth.uid == uid;
      }
    }

    // Collection-group read, required for the console's aggregates. A nested
    // match alone does NOT authorize collectionGroup('stats') — this rule does.
    match /{path=**}/stats/{docId} {
      allow read: if isAdmin();
    }

    // Unique display handles. Create-only, so a handle is never reassigned or stolen.
    match /handles/{handle} {
      allow read:   if isSignedIn();
      allow create: if isSignedIn()
        && handle.matches('^[a-z0-9_]{3,20}$')
        && request.resource.data.keys().hasOnly(['uid','createdAt'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.createdAt == request.time;
      allow update, delete: if false;
    }

    function validCategory(id, d) {
      return id.matches('^[a-z0-9]+(-[a-z0-9]+)*$')
        && id.size() >= 2 && id.size() <= 40
        && d.label is string && d.label.size() >= 2 && d.label.size() <= 40
        && d.kind in ['asset','liability']
        && d.group in ['equity','debt','cash','real-estate',
                       'commodity','alternative','liability'];
    }

    // Global catalog: world-readable to signed-in users, ADMIN-WRITE-ONLY.
    // No user path in, so the abuse surface the quota once guarded is gone.
    match /categories/{categoryId} {
      allow read:   if isSignedIn();
      allow create: if isAdmin() && validCategory(categoryId, request.resource.data);
      allow update, delete: if false;   // immutable; corrections via console only
    }

    // Proposal queue: anyone may propose (quota-capped), only admin may rule on it.
    match /categoryProposals/{categoryId} {
      allow read: if isAdmin()
                  || (isSignedIn() && resource.data.proposedBy == request.auth.uid);

      allow create: if isSignedIn()
        && quotaBumped()
        && validCategory(categoryId, request.resource.data)
        && request.resource.data.keys().hasOnly(
             ['label','kind','group','proposedBy','proposedByHandle','proposedAt','status'])
        && request.resource.data.proposedBy == request.auth.uid
        && request.resource.data.proposedAt == request.time
        && request.resource.data.status == 'pending';

      // Only the verdict may change, and only an admin may change it.
      allow update: if isAdmin()
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['status','reviewedBy','reviewedAt','rejectionReason'])
        && request.resource.data.status in ['approved','rejected']
        && request.resource.data.reviewedBy == request.auth.uid;

      allow delete: if false;
    }
  }
}
```

Five clauses worth naming:
- `proposedAt == request.time` is what *forces* the client to use `serverTimestamp()`. Without it, a
  client can backdate freely.
- `hasOnly` pins the shape exactly. Without it, anyone can staple a 900 KB junk field onto a document
  the admin console will render.
- `diff().affectedKeys().hasOnly([...])` on the proposal update is the important one: an admin can
  record a verdict but cannot quietly rewrite the `label` a user proposed into something else. It
  constrains the privileged path, not just the public one.
- `get()`/`getAfter()` count against the rules access budget (10 document reads per single-doc
  request). We spend 2 on the quota check; `isAdmin()` reads a token claim and spends none — which is
  the whole reason it is a claim and not an `/admins` document (§5).
- **The profile must be created with `categoriesCreated: 0`** at first sign-in. If the field is
  missing, `get(me()).data.categoriesCreated` errors and every proposal fails — a confusing failure to
  debug six months later. Seed it in the same write that creates the profile.

---

## 6. Cache layer and sync flows

Firestore's own IndexedDB persistence stays **off** (`memoryLocalCache()`). Two caches that can
disagree is worse than one cache you control.

### Storage is split by sensitivity, not by convenience

Blanket-moving everything to `sessionStorage` would throw away caching that costs nothing to keep.
Two of the three cached things are not private at all:

| Data | Store | Why |
|---|---|---|
| Profile + snapshots | **`sessionStorage`** | Actual balances. Dies with the tab, cleared on logout |
| Global category catalog | `localStorage` | Shared by every user *by design* — there is nothing to protect, and it is the largest slice of the cold-start read count |
| FX rate tables | `localStorage` | Public ECB data. Persisting it also gives the manual-rate fallback (§7) something to prefill from when Frankfurter is down |

```ts
const SCHEMA = 1;
const privKey = (uid: string) => `nwc:v${SCHEMA}:${uid}`;      // sessionStorage
const CATS_KEY = `nwc:v${SCHEMA}:categories`;                  // localStorage
const FX_KEY   = `nwc:v${SCHEMA}:fxrates`;                     // localStorage

type PrivateCache = {
  schemaVersion: number;
  uid: string;
  fetchedAt: number;          // client clock, for the "as of" label
  profile: Profile;
  snapshots: Snapshot[];      // full history, ordered by asOfDate
};
```

### Auth persistence must match, or the change is theatre

Firebase Auth defaults to `browserLocalPersistence` — the refresh token lands in **IndexedDB** and
survives closing the tab. Leaving that default while moving balances to `sessionStorage` protects the
wrong asset: a persisted token doesn't just reveal stale numbers, it lets whoever opens the browser
next fetch *live* data and write to it. The token is strictly more dangerous than the cache it would
be guarding.

So set it explicitly, before any sign-in call:

```ts
await setPersistence(auth, browserSessionPersistence);
```

Cost: signing in again in each new tab. With an already-active Google account the popup is one click
and no password, which is a fair price at a twice-a-year cadence — and if it grates, swapping this one
line back to `browserLocalPersistence` is the escape hatch. Just don't do it while believing
`sessionStorage` is buying privacy.

**Boot** — a warm tab renders with zero network reads; a fresh tab pays for snapshots only, since the
category catalog survives in `localStorage`:
```ts
const cached = readPrivateCache(uid);              // sessionStorage
if (cached?.schemaVersion === SCHEMA) render(cached, readCategories());
else await hardRefresh(uid);
```

Be clear-eyed about the hit rate: `sessionStorage` dies with the tab, so for an app opened twice a
year **nearly every visit is a cold start**. The cache's real job shrinks to "don't refetch while
navigating between dashboard, editor and history, and survive an F5". In-memory React state already
covers the first part; `sessionStorage` adds the reload. That is a narrow benefit, and it is fine — the
read cost was never the problem. A cold start is ~25–45 document reads against a 50,000/day free tier.

**`hardRefresh` — the only place a read touches the network:**
```ts
async function hardRefresh(uid: string) {
  const [prof, snaps, cats] = await Promise.all([
    getDocFromServer(doc(db, 'users', uid)),
    getDocsFromServer(query(collection(db, `users/${uid}/snapshots`), orderBy('asOfDate'))),
    getDocsFromServer(collection(db, 'categories')),
  ]);
  writePrivateCache(uid, {                                        // sessionStorage
    schemaVersion: SCHEMA, uid, fetchedAt: Date.now(),
    profile: …, snapshots: …,
  });
  writeCategories(…);                                             // localStorage
  render();
}
```

> **`getDocsFromServer`, not `getDocs`.** `getDocs` may answer from the SDK's own cache, which would
> make the Refresh button a silent no-op. This is the easiest bug to ship here.

**Save:**
```ts
async function saveSnapshot(uid: string, draft: SnapshotDraft) {
  const ref = doc(db, `users/${uid}/snapshots/${draft.asOfDate}`);
  const prior = findInCache(draft.asOfDate);
  const totals = computeTotals(draft);                  // uses draft.fxRates
  const batch = writeBatch(db);
  batch.set(ref, {
    ...draft, totals,
    recordedAt: prior?.recordedAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  if (isNewestSnapshot(draft.asOfDate)) {               // only the newest denormalizes up
    batch.set(doc(db, `users/${uid}/stats/current`), {
      net: totals.net, currency: draft.baseCurrency, asOfDate: draft.asOfDate,
    });
  }
  await batch.commit();
  await hardRefresh(uid);          // required, not defensive — see below
}
```

The re-read after write is not politeness. `serverTimestamp()` is a **sentinel**: the local echo of
your own write returns `null` for that field until the server round-trip resolves it. Without
`hardRefresh`, the UI renders "Last updated: —" immediately after an update.

**Refresh button** → `hardRefresh(uid)`. Show cache age next to it so the button has a visible reason
to exist.

**Cross-device staleness** mostly evaporates: a tab-scoped cache cannot go stale for a week. The
7-day auto-refresh that a persistent cache would have needed is dropped. What remains is a long-lived
tab left open while you edit elsewhere — which is exactly what the Refresh button and the cache-age
label are for.

**Multi-tab.** `sessionStorage` is per-tab, so two tabs hold two independent caches and a save in one
does not invalidate the other. With `localStorage` a `storage` event could have synced them; with
`sessionStorage` that channel doesn't exist. Acceptable here — but it means "open in new tab" is a
silent way to see stale numbers, so keep the cache-age label visible rather than tucked in a corner.

### Logout

Signing out has to clear four things, and only the first is obvious:

```ts
async function logout() {
  sessionStorage.removeItem(privKey(uid));   // 1. the private cache
  await terminate(db);                       // 2. drop the in-SDK Firestore client
  await signOut(auth);                       // 3. revoke the local auth session
  window.location.replace(import.meta.env.BASE_URL);   // 4. hard reload
}
```

Step 4 is the one that makes the rest trustworthy. A client-side route change leaves every balance
sitting in live React state and in whatever chart components have already rendered — the UI looks
logged out while the data is still one devtools poke away. A hard navigation discards the entire JS
heap, so there is no in-memory copy left to leak, and no ordering bug in steps 1–3 can survive it.

`localStorage` is deliberately **not** cleared: it holds only the public category catalog and ECB
rates, so wiping it would leak nothing and just make the next user's first load slower.

---

## 7. Currency and FX

Per-holding currency with conversion to a per-user `baseCurrency`.

**Rates: Frankfurter (ECB), `api.frankfurter.dev`.** No API key — the whole reason to pick it, since
a static bundle cannot hide one. CORS is open, so a browser can call it directly.

```
https://api.frankfurter.dev/v1/latest?base=INR
https://api.frankfurter.dev/v1/2026-03-31?base=INR    ← historical, for backdated snapshots
https://api.frankfurter.dev/v1/currencies             ← the picker list
```

**The `/v1` prefix is required on this host.** The bare paths that worked on the older
`api.frankfurter.app` return `{"status":404,"message":"not found"}` here — a domain swap alone breaks
every call.

Response shape, so the client types match:
```json
{ "amount": 1.0, "base": "INR", "date": "2026-08-31",
  "rates": { "USD": 0.01134, "EUR": 0.00906, … } }
```
Note the rates are *per one unit of base* — with `base=INR`, `USD: 0.01134` means 1 INR = 0.01134 USD,
so converting a USD holding into INR means **dividing**, not multiplying. Easy sign error to bake in.

Coverage is exactly **30 ECB fiat currencies** (verified against `/v1/currencies`). **No crypto** —
BTC/ETH holdings must be entered pre-converted into a supported currency, or the app needs a second
rate source later.

**The critical rule: freeze rates into the snapshot.**
If totals are converted at *display* time using today's rates, your 2024 net worth changes every
morning, and a "growth" chart becomes partly a chart of currency drift you never chose to record.
So on save, the app fetches rates **for `asOfDate`** and writes them into the document. A saved
snapshot is then fully self-contained and its total never moves again.

- ECB publishes on business days only, and Frankfurter resolves a non-trading date backwards. This is
  not hypothetical: requesting `2024-03-31` (a Sunday, with Good Friday on the 29th) returns
  `"date": "2024-03-28"`. Store what came back as `fxAsOf` — it will legitimately differ from
  `asOfDate`, sometimes by several days.
- **Currencies can be retired between snapshots.** The 2024 response above includes `BGN`; today's
  does not, because Bulgaria joined the euro. So a currency that was valid when a snapshot was saved
  may be absent from both `/v1/currencies` and the latest rate table. Two consequences: the picker
  must accept a legacy currency already present in history even if the API no longer lists it, and
  constant-currency mode (below) must handle a missing latest rate rather than dropping the holding or
  throwing. This is a second, independent argument for freezing rates per snapshot.
- **Never block a save on a third-party API.** If the fetch fails, fall back to manual rate entry
  (prefilled from the last known rates) and set `fxSource: "manual"`. Losing a yearly entry because
  someone else's server was down is not acceptable.
- Cache the latest rate table in `localStorage` (public data — see the split in §6), so it outlives
  the tab and can prefill the manual-entry fallback.

**Two chart modes fall out of frozen rates, for free:**
- **As-reported** — each snapshot uses its own frozen rates. This is what actually happened to your
  wealth, FX movement included.
- **Constant currency** — revalue every snapshot at the *latest* rates. Strips out FX so you can see
  whether the underlying holding actually grew. For anyone holding RSUs in USD, the gap between these
  two views is the interesting number. Guard the retired-currency case: if a historical currency has no
  current rate, fall back to that holding's frozen rate and flag the series as partially
  constant-currency rather than silently mixing bases.

Currency picker: fetched from `/v1/currencies` (which returns code → name, ready to render), cached in
`localStorage`, with a hardcoded 30-entry fallback so the editor still opens offline. Base currency
pinned first, plus any legacy currency found in existing snapshots. Symbols and decimal places from
`Intl.NumberFormat` — no hand-rolled formatting, and note that ECB's set includes zero-decimal
currencies like JPY and KRW where naive `toFixed(2)` reads wrong.

---

## 8. Visualisations

### 8a. Breakup — latest snapshot
- **Donut**, assets only, one arc per category, coloured by `group` so equity/debt/real-estate read
  as families rather than 20 unrelated hues.
- Centre label: net worth in `baseCurrency`.
- Toggles: **by category** ↔ **by group**, and **by currency** (useful once FX is in play — "63% of
  my net worth is USD-denominated" is a risk fact worth seeing).
- Companion table: category, native amount, converted amount, % of assets. Liabilities in their own
  block below — never mixed into the same donut, since a negative arc is meaningless.

### 8b. Growth by category — across snapshots
- **Stacked area chart.** x = `asOfDate`, **time-scaled, not evenly spaced by index** — a 6-month gap
  and an 18-month gap must not look identical. y = value in `baseCurrency`, one series per category.
- Overlaid line: total net worth.
- Modes: **Absolute** · **Share** (100% stacked, shows allocation drift) · **Indexed** (each category
  rebased to 100 at first appearance, so a ₹50 K holding that tripled is visible beside a ₹50 L
  holding that grew 8%) · **As-reported ↔ Constant currency** (§7).
- **Waterfall** for latest-vs-previous. With two or three snapshots an area chart is nearly empty
  while a waterfall reads perfectly — this carries the entire first year of use.

**Contributions vs returns.** Each holding records `contributed` (amount added since the previous
snapshot, in its native currency). This splits every period's change into three honest parts:

```
Δvalue  =  contributions  +  investment return  +  FX effect
```

The delta table shows all three per category. Return uses **modified Dietz**, which is the correct
tool when you know period flows but not their exact dates:

```
return = (endValue − startValue − netFlow) / (startValue + 0.5 × netFlow)
```

The 0.5 assumes contributions arrived mid-period — the standard approximation, and the honest one
given a snapshot only knows the period total. Label it as approximate in the UI.

**Zero-fill rule (must be explicit).** A category first used in snapshot 3 has no value in snapshots
1–2. Treat missing as `0` for stacking, but **exclude** those periods from that category's return and
CAGR — otherwise every new holding reports infinite growth. Skip CAGR entirely for categories present
in fewer than two snapshots.

**CAGR uses actual day deltas**, never snapshot count: `(end/start)^(365/days) − 1`.

---

## 9. Screens

1. **Sign in** — one Google button. First-time users then pick a unique handle and a base currency.
2. **Dashboard** — net worth, change since last snapshot split into contributions / return / FX,
   cache age + Refresh, "next update due" banner, breakup donut, growth chart, delta table,
   privacy-blur toggle, **Log out**.
3. **Snapshot editor** — date, base currency, per-holding rows (category · amount · currency ·
   contributed · note), live FX preview, running totals, snapshot note. **Prefills from the previous
   snapshot** so a yearly update is "edit 8 numbers", not "re-enter everything".
4. **History** — snapshot table, click to edit, JSON export.
5. **Admin** (claim-gated) — accounts created vs. accounts with data, pending-proposal queue with
   approve/reject, net-worth aggregates per currency. No identities, by construction (§5).

---

## 10. Build phases

| Phase | Deliverable | Notes |
|---|---|---|
| 0 | Vite scaffold + Actions workflow, blank page **live on Pages** | Do first. `base` path and Pages config are the riskiest unknowns — find out on day one, not after the app works locally |
| 1 | Firebase project, Google auth, `/handles` claim flow, rules deployed, App Check, emulator for local dev | Rules written and tested before any real data exists. Test the quota path explicitly — it is the one rule with cross-document logic |
| 2 | Category tiers: seed script, picker over `global ∪ custom`, private add, opt-in propose | Seed via Admin SDK or console. Set your own admin claim in the same one-off script |
| 3 | Currency list + Frankfurter client + manual-rate fallback | Before the editor, since the editor depends on it |
| 4 | Snapshot editor, prefill from previous, save path | |
| 5 | Cache layer (split stores), `hardRefresh`, Refresh button, cache-age display, **logout** | The behaviour most likely to be subtly wrong — build it deliberately, not incidentally. Verify logout by reloading and poking devtools, not by trusting the redirect |
| 6 | Breakup donut, growth chart, delta table with Dietz split, waterfall | |
| 7 | Admin console: counts, approval queue, per-currency aggregates |  Last, because nothing else depends on it — and it needs real accounts to be worth looking at |
| 8 | Export/import JSON, due-date nudge, privacy blur, empty states, sign-in disclosure | |

---

## 11. Faults found in the spec

**F1 — "No sign-in + username-keyed data"** — resolved: Google sign-in (§5). Recording why, since
this will look like over-engineering in a year: rules cannot verify a self-declared string and cannot
see the request origin, so a rule permitting a write to `/users/aseem` permits it to everyone, and the
public Firebase config makes that reachable by `curl`. A real `request.auth.uid` is the only thing that
makes `/users/{uid}` isolation expressible.

**F2 — A world-writable global namespace** — resolved by the three-tier model (§4). `/categories` is
now admin-write-only, so the shared picker cannot be polluted at all: the worst a stranger can do is
add rows to a review queue that only you see, capped by quota. The near-duplicate problem (`"MF"` vs
`"Mutual Fund"` vs `"SIP"`) stops being a rules problem and becomes a judgement call at approval time,
which is the right place for it — no regex was ever going to catch that.

**F3 — Liabilities** — resolved: `kind` on every category, subtracted from `totals.net`.

**F4 — Contributions vs returns** — resolved: `contributed` per holding + modified Dietz (§8b).

**F5 — FX turns "growth" into three effects, not one.** Now that holdings carry native currencies, a
category can grow purely because the rupee weakened. Handled by the constant-currency mode and the
three-way delta split (§8b) — but worth knowing this was a consequence of choosing per-holding FX, not
a free addition.

**F6 — Year one has two data points.** A growth chart needs history the cadence cannot supply. →
Backdated entry (E1) plus the waterfall view. Frankfurter's historical endpoint makes backdating
genuinely accurate rather than approximate.

**F7 — cached balances sit in plaintext, wherever they sit.** Resolved by moving them to
`sessionStorage` with an explicit logout path (§6). Three caveats, so the guarantee isn't overstated:
`sessionStorage` **can** outlive a browser restart when session-restore reopens the tab, so this is
tab-scoping, not encryption; the protection is void unless auth persistence moves too (§6); and the
cache must stay disposable — never write it without a server round-trip behind it, so a wipe at any
moment costs nothing. Privacy-blur toggle still worth having for shoulder-surfing, which no storage
choice addresses.

**F13 — The admin console reaches across the per-user boundary** — largely resolved by Q6 choosing
aggregates. Worth recording how, because the obvious implementation would have been worse: putting the
denormalized total on the profile document would have forced the admin claim to grant read on the whole
profile, handle and email included, leaving "aggregates only" as a UI promise that any edited bundle
could break. Isolating it in `/users/{uid}/stats/current` makes the boundary structural — there is no
query the console *could* run that returns a name. What remains is genuine and stated in §5: paths are
pseudonymous rather than anonymous, and the Firebase Console ignores rules entirely, so this constrains
the app rather than the operator. A one-line disclosure at sign-in ("aggregate usage statistics are
visible to the operator") still belongs there, and is now much smaller than it would have been.

**F8 — Two SDK footguns** that silently break the stated flows: `getDocs` answering from cache
(Refresh becomes a no-op) and `serverTimestamp()` reading back `null` locally. Both handled in §6.

**F9 — Sparse category series** need explicit zero-fill and CAGR exclusion, or new holdings report
infinite growth. §8b.

**F10 — Schema evolution at a 6-month cadence.** You will next open this code having forgotten all of
it. Version the cache (`nwc:v1:`) and documents (`schemaVersion`) from the first commit; a version
mismatch must discard and refetch, never attempt a merge.

**F11 — No backup.** A year of snapshots is irreplaceable by definition — you cannot reconstruct last
March's balances. JSON export from day one. This matters more under §5 options B and C, where there
is no account-recovery path at all.

**F12 — Renaming or deleting a category would break history.** Snapshots reference `categoryId`, so
categories are immutable in the rules and history keeps rendering forever. The cost: a typo'd global
label is stuck until an admin fixes it in the console. Right trade — validate labels up front, correct
out of band.

---

## 12. Open questions

*None outstanding.*

*Resolved: Q1 identity → Google sign-in, open signup, handle as display name. Q2 liabilities → yes.
Q3 currency → per-holding + live FX with rates frozen per snapshot. Q4 growth → track contributions.
Q5 governance → curated global + private custom + opt-in proposal queue, with an admin console.
Q6 admin view → aggregates per currency, enforced structurally via an isolated stats subcollection.*

---

## 13. Enhancements worth considering

- **E1 Backdated entry** — seed 3–5 years at signup so the growth chart is useful now, not in 2028.
  Frankfurter's historical endpoint keeps backdated FX honest.
- **E2 Export/import JSON** — backup, and a migration path off Firestore. Promoted to Phase 7.
- **E3 "Next update due" banner** — from `asOfDate + cadenceMonths`; optionally emit an `.ics`, since
  a static site cannot email.
- **E4 Currency exposure view** — % of net worth by denomination. Nearly free once FX exists, and a
  genuine risk signal.
- **E5 Target allocation** — set a desired mix, chart drift against it. Fits the 100%-stacked view.
- **E6 Privacy blur** — one toggle to redact all amounts. Genuinely useful for a net-worth app on a
  laptop in public.
- **E7 XIRR** — true money-weighted return, if per-contribution dates ever get recorded. Modified
  Dietz (§8b) is the honest approximation until then.
- **E8 Print one-pager** — a yearly PDF is a natural output for a yearly ritual.
