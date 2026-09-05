# Backend options and what they cost

A decision doc, not a plan. Written because the app uses none of Firestore's
distinguishing features — no realtime listeners, no offline sync, no
horizontal scale — so it is worth knowing whether that choice costs anything.

**Short answer: not much, and less than instinct suggests.** The reason is the
access pattern, so that comes first.

---

## 1. This workload is unusual, and it changes every conclusion

Most "Firestore gets expensive" advice is written about chatty apps — a feed, a
chat, a dashboard someone leaves open. This is the opposite:

| | |
|---|---|
| Sessions per user per year | **~6** (two updates plus casual checks) |
| Reads per session | **~46** (measured: profile, portfolios, snapshots, 41 categories) |
| Writes per user per year | **~6** |
| Storage per user, lifetime | **~50 KB** (20 snapshots at ~3 KB) |
| **Months active per year** | **~2** |

That last row is the one nobody models, and it dominates. Auth vendors bill by
**monthly active users**, not signups. A million people who each open the app
twice a year is roughly **167k MAU**, not 1M. An app used daily would be 1M MAU
and cost six times more on identical signup numbers.

Everything below assumes these figures. They are the arguable part — if real
usage is five sessions a month rather than six a year, re-run the maths.

---

## 2. What each scale actually generates

| | 100 signups | 100k signups | 1M signups |
|---|---|---|---|
| Sessions / year | 600 | 600,000 | 6,000,000 |
| Reads / year | 27,600 | 27.6M | 276M |
| Reads / day (avg) | 76 | 75,600 | 756,000 |
| Writes / year | 600 | 600,000 | 6M |
| Storage | 10 MB | 5 GB | 50 GB |
| **MAU** | 17 | 16,700 | 167,000 |

Firestore's free tier is 50,000 reads/day. At 100k signups the *average* day
already exceeds it — but only just, and reads are the cheapest thing Firestore
sells.

---

## 3. Annual cost, by option

Approximate, at list prices, and prices move. Verify before committing.

| Option | 100 | 100k | 1M | Auth included |
|---|---|---|---|---|
| **Firebase (current)** | **$0** | **~$14** | **~$7,200** | yes |
| — of which data | $0 | ~$14 | ~$260 | |
| — of which auth (MAU) | $0 | $0 | **~$6,980** | |
| **Supabase** | $0¹ | ~$300 | ~$2,960 | yes |
| **Turso + Firebase Auth** | $0 | ~$100 | ~$7,100² | no (borrowed) |
| **Cloudflare D1 + Workers** | $0 | ~$60 | ~$60³ | no |
| **Neon + own auth** | $0 | ~$230 | ~$830 | no |
| **PocketBase, self-hosted** | ~$60 | ~$120 | ~$600⁴ | yes |

¹ Free tier **pauses after ~7 days of inactivity** and needs a manual restore —
see §5. For an app opened twice a year this is close to disqualifying.
² Data is nearly free; the $7k is Firebase Auth again.
³ D1 free tier covers 5M row-reads/day; the cost is the $5/month Workers plan.
Genuinely flat here.
⁴ One small VM handles this write volume easily. The cost is operational, not
compute — see §5.

### What the table actually says

**At 100 signups every option is free.** Nothing to decide.

**At 100k, Firebase is the cheapest by a wide margin** — about $14/year, because
MAU sits under the 50k free tier and reads are cheap. Supabase costs 20× more,
and it is still only $300.

**At 1M the picture inverts, and it is entirely about auth.** Firestore's data
bill is ~$260/year — trivial. Firebase Auth is **~$6,980**. Supabase charges
~$0.00325/MAU against Firebase's ~$0.0046, which is the whole difference.

So the migration question is not "is Firestore expensive". It is **"is Firebase
Auth expensive", and only above roughly 400k signups at this usage rate.**

---

## 4. The real cost of the current design

Not money — shape. Loading a user is **N+1 queries**: one for the portfolio
list, then one per portfolio for its snapshots. In SQL that is a single join.
Adding a tenth portfolio adds a tenth round trip.

At present scale this is invisible. It is the thing that would age worst, and it
is a fair argument for Postgres independent of price.

Firestore does earn two things the app relies on:

- **Security rules run server-side with no backend.** On a static host this is
  the whole game. Supabase's RLS is an equivalent; Turso, D1 and Neon have no
  answer without a server in front.
- **Auth that works from a static page.** Also true of Supabase.

---

## 5. Gotchas that do not appear in pricing tables

- **Supabase free tier pauses.** ~7 days of inactivity suspends the project until
  someone restores it from the dashboard. For a twice-a-year app that is a real
  outage risk on the free tier; the $25/month Pro tier removes it.
- **Turso, D1 and Neon have no auth.** You keep Firebase Auth — which is exactly
  the expensive part at scale — or add Clerk/Auth0/Supabase Auth and pay there.
- **D1 and Neon have no client-side security model.** Without Firestore rules or
  Postgres RLS you need a server enforcing access, which ends the static-site
  architecture and adds a deploy target.
- **PocketBase means you are on call.** Backups, upgrades, uptime, and a single
  machine holding everyone's financial history.
- **Migrating auth re-keys everything.** UIDs are provider-specific. Every user
  signs in again and every document must be re-pointed. This is the single
  largest cost of moving and it does not shrink with scale — it grows.

---

## 6. Recommendation

**Stay.** Not out of inertia — the numbers say the quota is not a constraint
until roughly 400k signups, and the migration costs a data-layer rewrite, rules
re-expressed as RLS, and every existing account broken.

Revisit if any of these becomes true:

- **Signups pass ~250k**, where auth MAU starts to matter and the arithmetic is
  worth redoing with real usage rather than these assumptions.
- **Usage turns out to be monthly rather than twice-yearly.** This flips MAU by
  6× and moves the crossover down to roughly 60k signups.
- **The data model wants joins** — cross-portfolio queries, cohort analysis,
  anything reporting-shaped. That is a design argument, not a cost one, and it
  is the most likely reason to move.

If a move happens, **Supabase** is the target: it is the only option that
replaces both halves (database *and* auth) and keeps rules server-side without
introducing a server. Budget the auth migration as the hard part.

---

## 7. If you want to reduce cost without moving

Cheaper than any migration, and worth doing regardless:

- **Cache the category catalog properly.** 41 of the ~46 reads per session are
  categories, and they are identical for every user and change perhaps monthly.
  Serving them from a single cached document — or a build-time JSON file — cuts
  reads per session from ~46 to ~5, an **89% reduction** that costs one document
  write per catalog change.
- **Collapse the N+1.** A per-user index document listing each portfolio's
  latest snapshot would let the dashboard render from two reads instead of N+1,
  with the full timeline fetched only when a portfolio is opened.
- **App Check**, which stops the only realistic way to burn the quota at current
  scale — a script looping reads on one signed-in account (§ PLAN.md).
