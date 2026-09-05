# Multi-portfolio tracking — design

Extends [PLAN.md](PLAN.md).

**Status: phases 1–6 built and migrated.** Both accounts carry `schemaVersion: 2`,
snapshots live under `portfolios/{id}`, and 41 categories are region-tagged
(22 original + 19 regional). Remaining: App Check, and end-to-end testing of the
delete flow — both deliberately held until the modules were finished.

---

## 1. What you actually asked for

> Indian portfolio should be tracked differently than US portfolio. On an overall
> level, the net worth could be combined value of all portfolios but a user would
> want to track the folios independently.

The regional category seeds were the visible symptom. The missing concept underneath
is a **portfolio**: a set of holdings that belongs together, has its own natural
currency, its own relevant instruments, and its own update rhythm.

Once portfolios exist, the category problem dissolves — EPF only ever appears in a
portfolio tagged India, and nobody in Toronto is offered PPF.

---

## 2. The one decision that shapes everything

Is a portfolio a **dimension inside a snapshot**, or its **own snapshot series**?

### Option A — a field on each holding

`Holding` gains `portfolioId`. One snapshot document still covers the whole net
worth on a date; charts filter and group by portfolio.

- **For:** no restructuring, trivial combined total, one point in time is genuinely
  one number, migration is a field default.
- **Against:** every portfolio must be updated in the same sitting. Your 401(k)
  statement and your EPF passbook do not arrive in the same month, and a snapshot
  that omits a portfolio would read as that portfolio going to zero.

### Option B — a snapshot series per portfolio  ← CHOSEN

```
/users/{uid}/portfolios/{portfolioId}/snapshots/{asOfDate}
```

Each portfolio has its own timeline and cadence. Combined net worth is the sum of
each portfolio's most recent snapshot.

- **For:** delivers what "track independently" actually means. Update India in
  March and the US in September without either distorting the other. Cadence
  reminders become per-portfolio, which is the useful granularity.
- **Against:** combined figures span dates (see §5), reads scale with portfolio
  count, and it needs a real migration.

**Chosen: B.** A is a smaller change but it does not deliver independent
tracking — it only re-labels holdings inside a shared update cycle. The date
misalignment B introduces is not a flaw invented by the design; it is the actual
state of your knowledge, and §5 makes it visible rather than hiding it.

---

## 3. Firestore changes — yes, and here they are

Everything below is additive except the snapshot path, which moves.

```
/users/{uid}
    …unchanged…
    displayCurrency   : "CAD"          ← renamed from baseCurrency, see note
    schemaVersion     : 2              ← bumped

/users/{uid}/portfolios/{portfolioId}                       ← NEW
    label            : "India"
    region           : "IN" | "US" | "GB" | "CA" | null     ← biases the picker only
    baseCurrency     : "INR"           ← the currency this folio is naturally kept in
    cadenceMonths    : 6 | 12
    order            : 0               ← display order
    createdAt, updatedAt

/users/{uid}/portfolios/{pid}/snapshots/{asOfDate}          ← MOVED
    …exactly today's snapshot shape, unchanged…

/users/{uid}/snapshots/{asOfDate}                           ← REMOVED after migration

/users/{uid}/stats/current                                  ← unchanged shape
    net, currency, asOfDate            ← net is now the combined figure

/categories/{slug}
    label, kind, group
    regions          : ["IN"] | ["GLOBAL"] | ["US","CA"]    ← NEW
```

**`baseCurrency` splits into two ideas**, which are currently conflated on the
profile: `portfolio.baseCurrency` is what a folio is *kept* in, and
`profile.displayCurrency` is what you are *looking at* right now. They are
different questions and the current single field answers both badly.

**Rules changes** (`firestore.rules`):

- `match /users/{uid}/portfolios/{pid}` and its `snapshots` subcollection —
  owner-only, identical to the existing snapshot rule. Two small blocks.
- `validCategory()` must accept the new `regions` key, or every category write
  starts failing `hasOnly`. **This is the one rule edit that breaks existing
  behaviour if forgotten.**
- `/users/{uid}/snapshots` rule stays until migration completes, then goes.

**Migration.** Two accounts, one snapshot between them, so this is a ten-line
Admin SDK script rather than a project: create a default portfolio per user from
their current `baseCurrency`, copy snapshots into it, delete the originals. Add
it as `npm run fb:migrate-portfolios`. Bumping the cache to `SCHEMA = 2` makes
every client discard and refetch rather than merge — which is exactly the
behaviour PLAN.md §11 F10 argued for.

---

## 4. Regional categories

`regions` on each category, with `GLOBAL` for things that exist everywhere: cash,
savings, real estate, gold, crypto, direct equity, bonds, credit cards, loans.

Seeds per region:

| Region | Instruments |
|---|---|
| `GLOBAL` | cash, savings, FD/term deposits, direct equity, mutual funds/ETFs, bonds, gold, real estate, crypto, home/car/personal loan, credit card |
| `IN` | EPF, PPF, NPS, ELSS, SSY, RD, Sovereign Gold Bonds |
| `US` | 401(k), Roth/Traditional IRA, HSA, 529, RSU/ESPP, Treasury/I-Bonds |
| `CA` | RRSP, TFSA, RESP, FHSA, LIRA |
| `GB` | ISA, SIPP, Premium Bonds, workplace pension |

**The filter is a bias, not a wall.** A portfolio tagged `IN` shows Indian +
global categories first, with everything else behind "show all" — someone in
Mumbai may well hold a 401(k) from a previous job, and refusing to let them
record it would be worse than a slightly longer list.

Proposals gain a region too, so approving "RRSP" files it under `CA` rather than
showing it to everyone.

---

## 5. Combined net worth across misaligned dates — the hard part

If India was last valued in March and the US in September, what is "net worth today"?

**Rule: each portfolio contributes its most recent snapshot at or before the date
being shown.** It is the best available estimate and it is what anyone does
informally with their own numbers.

What makes it honest is saying so. The headline carries its provenance:

> **CA$341,005** — India as of Mar 2026, US as of Sep 2026

A portfolio whose newest snapshot is well past its own cadence gets flagged
individually, rather than the whole figure being quietly stale.

**Combined growth chart:** take the union of every portfolio's dates; at each date,
sum each portfolio's most recent snapshot at or before it. That is a step function
that jumps whenever any portfolio is updated, which is a truthful picture of when
your knowledge changed. Before a portfolio's first snapshot it contributes zero —
the same explicit rule as the existing category zero-fill.

**Attribution stays per-portfolio.** The contributions / FX / return split compares
two consecutive snapshots; doing that across a combined step function would
attribute one portfolio's update to another's period. So the delta table becomes
per-portfolio, and the combined view shows totals and allocation only. Better a
narrower correct number than a broader misleading one.

---

## 6. What the UI becomes

- **Dashboard** — combined net worth with provenance, allocation across portfolios,
  then a card per portfolio (its own total, its own "as of", its own due nudge).
- **Portfolio view** — today's dashboard, scoped: breakup, growth, delta table.
- **Editor** — unchanged, but scoped to one portfolio, and the category picker is
  biased by its region.
- **Onboarding** — creates a first portfolio, region and currency guessed from
  locale. One portfolio should feel like no portfolios at all: if you only ever
  have one, the concept stays invisible.

---

## 7. Phases

| # | Deliverable |
|---|---|
| 1 | Firestore layout + rules + migration script, behind an unchanged UI |
| 2 | Portfolio CRUD, onboarding creates a default, editor scoped to one |
| 3 | Regional category seeds, `regions` field, biased picker, region on proposals |
| 4 | Per-portfolio views (breakup, growth, delta) |
| 5 | Combined dashboard with provenance and per-portfolio staleness |
| 6 | Demo gains a second portfolio — the pitch is much stronger with one |

All six are done. Phase 1 shipped without user-visible change, which kept the
risky part (restructure + migration) separate from the feature work.

Closed alongside them, from PLAN.md's outstanding list: JSON import, a standalone
category manager, and the recompute-and-warn check on denormalized totals. The
demo also stopped downloading the Firebase SDK — the entry chunk went from 220 kB
gzipped to 61 kB, because a static `import App` in Root and a static
`initAppCheck` import in main were pulling the whole SDK into the entry.

---

## 8. Open questions

- **Q7 Portfolio axis — settled as free-form.** A portfolio is a label plus an
  *optional* region. Region only biases the category picker, so nothing forces a
  folio to be a country: "Retirement" or "Zerodha" work just as well. Costs
  nothing over the region-defined version and forecloses less.
- **Q8 Currency — settled as both.** Combined figures use the profile's display
  currency; each portfolio's own card additionally shows its native figure. An
  Indian folio reading in INR is more legible to its owner than the same number
  in CAD, and the combined view still needs one comparable unit.
- **Q9 Cross-portfolio categories — settled as a separate summary card with a
  toggle, defaulting to merged.** Merged answers "what am I invested in";
  unmerged answers "where is it held". Merged is the more common question, so it
  leads, and keeping this in its own card stops the per-portfolio breakups from
  having to mean two things at once.

*All design questions are closed. What remains is unbuilt work and the operational
items in §7, not decisions.*
