# Net Worth Calculator

A twice-a-year snapshot of everything you own and owe, with growth split into
**what you added, what it earned, and what the currency did**.

Static React app on GitHub Pages, backed by Firestore. Full design rationale in
[PLAN.md](PLAN.md) — read that before changing anything structural; most of the
non-obvious decisions have a reason recorded there.

## Requirements

Node 22 (pinned in `.nvmrc`). This machine's default `node` is v10, which cannot
run Vite:

```bash
nvm use
```

## Local development

```bash
npm install
npm run dev
```

The dev server serves at **http://localhost:5173/networth-calculator/**, not the
root — the app is built for a GitHub project page, so `base` carries that prefix.

```bash
npm test        # 23 tests: FX direction, growth attribution, cache merge
npm run build   # tsc -b && vite build
npm run lint
```

The app renders without Firebase credentials — it shows setup instructions
instead of signing in. That is deliberate, so the deploy pipeline can be verified
before the backend exists.

## Setup checklist

These steps need your Firebase Console and GitHub settings, so they are not
scriptable from here.

### 1. Firebase project

1. Create a project, add a **Web app**, copy the config.
2. `cp .env.example .env` and fill it in.
3. **Authentication** → enable the **Google** provider.
4. **Authentication → Settings → Authorized domains** → add
   `aseem-upadhyay.github.io`. Without this every sign-in fails with
   `auth/unauthorized-domain`.
5. **Firestore** → create the database in production mode.

### 2. Deploy the rules

```bash
npx firebase-tools deploy --only firestore:rules,firestore:indexes
```

Never leave the default rules in place — `firestore.rules` is the *only*
boundary protecting anyone's balances. There is no server.

### 3. GitHub Pages

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions** → add each `VITE_*` name from
   `.env.example`.

These are public client identifiers, not secrets — they ship in the bundle by
design. They live in Actions secrets so the project id isn't sitting in git
history, not because exposure would be a breach.

### 4. Seed categories and set your admin claim

Both need a service-account key: **Project settings → Service accounts →
Generate new private key**, saved as `serviceAccountKey.json` in the repo root
(gitignored). The Admin SDK bypasses rules, which is why the seed works despite
`/categories` being admin-write-only.

```bash
npm run fb:seed
```

```bash
npm run fb:admin -- you@gmail.com
```

```bash
npm run fb:status
```

Sign in through the app once before `fb:admin` — the account has to exist before
it can be flagged. A custom claim rather than an `/admins` document, because
`exists()` costs a document read on *every* rule evaluation and the console's
whole job is listing many documents.

### 5. App Check (before going public)

Register a **reCAPTCHA v3** site key and set `VITE_RECAPTCHA_SITE_KEY`. Firestore
rules cannot see a request's origin, so App Check is the only thing stopping
someone driving the public config straight from `curl`.

## Architecture notes

Three things that look like mistakes but are not:

- **Auth uses `browserSessionPersistence`.** Firebase defaults to parking the
  refresh token in IndexedDB, where it outlives the tab. Since balances are in
  `sessionStorage`, leaving that default would protect the wrong asset — a
  surviving token fetches *live* data and can write.
- **Firestore's own cache is off** (`memoryLocalCache()`). We run our own
  session cache; two caches that can disagree is worse than one you control.
- **Reads use `getDocsFromServer`, not `getDocs`.** `getDocs` may answer from the
  SDK cache, which would make the Refresh button a silent no-op.

## Layout

```
src/lib/types.ts        domain model, mirrors the Firestore shape
src/lib/money.ts        FX conversion + Intl formatting
src/lib/calc.ts         totals, growth attribution, modified Dietz, CAGR
src/lib/cache.ts        sessionStorage/localStorage split, category merge
src/lib/fx.ts           Frankfurter (ECB) client
src/lib/firebase.ts     lazy init, session persistence, App Check
src/lib/repo.ts         every Firestore read/write, incl. admin aggregates
src/lib/palette.ts      validated chart colours, keyed to group
src/lib/export.ts       JSON backup + due-date maths
src/components/         Breakup, Growth, DeltaTable, CategoryPicker
src/views/              SignIn, Onboarding, SnapshotEditor, Admin, Setup
src/dev/ChartPreview    `?charts` fixture harness (dev builds only)
firestore.rules         the actual security boundary
scripts/setup-firebase  seed, admin claim, proposal review
```

## Chart colour

Colour is keyed to a category's **group**, never its rank, so a filter or a
reordering never repaints the survivors. The palette validates on all six
checks in both light and dark (worst adjacent CVD ΔE 9.1 / 8.4). Three light
slots fall below 3:1 contrast, which obliges relief — hence every chart ships
beside a table carrying the same numbers. The donut shows groups rather than
categories because a part-to-whole ring stops being readable past ~6 segments.
