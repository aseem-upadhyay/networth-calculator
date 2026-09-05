/**
 * Shared domain types. Mirrors the Firestore model in PLAN.md §3.
 *
 * Money is stored as a plain number in the holding's own currency. Conversion
 * to a snapshot's `baseCurrency` always goes through the rates frozen on that
 * snapshot — never through live rates. See PLAN.md §7.
 */

export type CategoryKind = 'asset' | 'liability'

export const CATEGORY_GROUPS = [
  'equity',
  'debt',
  'cash',
  'real-estate',
  'commodity',
  'alternative',
  'liability',
] as const

export type CategoryGroup = (typeof CATEGORY_GROUPS)[number]

/** A category as it appears in the picker, from either the global or private tier. */
export interface Category {
  /** Slug. Doubles as the Firestore document id, which is what makes dedupe structural. */
  id: string
  label: string
  kind: CategoryKind
  group: CategoryGroup
  /**
   * Where this instrument exists. `GLOBAL` for things that exist everywhere
   * (cash, real estate, gold); otherwise ISO country codes — EPF is `['IN']`,
   * RRSP is `['CA']`. Used to order the picker, never to restrict it.
   */
  regions: string[]
  /** Where this came from. Global wins ties when the two tiers are unioned. */
  tier: 'global' | 'custom'
}

export interface Holding {
  categoryId: string
  /** In `currency`, not in the snapshot's base. */
  amount: number
  currency: string
  /** Added since the previous snapshot, in `currency`. Enables the returns split (§8b). */
  contributed: number
  note?: string
}

export interface Totals {
  assets: number
  liabilities: number
  net: number
}

/** Rates as `1 base = rates[code] foreign`, exactly as Frankfurter returns them. */
export type FxRates = Record<string, number>

export interface Snapshot {
  /** YYYY-MM-DD. Also the Firestore document id, so re-saving a date edits it. */
  asOfDate: string
  /** First write. Null only in the local echo before the server resolves it (§6). */
  recordedAt: number | null
  updatedAt: number | null
  baseCurrency: string
  /** Frozen at save time so a past total never moves again. */
  fxRates: FxRates
  /** Actual ECB rate date — differs from asOfDate across weekends and holidays. */
  fxAsOf: string
  fxSource: 'frankfurter' | 'manual'
  note?: string
  holdings: Holding[]
  totals: Totals
}

/**
 * A set of holdings with its own timeline.
 *
 * `region` is optional and only *biases* the category picker — it does not
 * restrict it. A portfolio is free-form: "India" and "Retirement" and "Zerodha"
 * are all valid ways to divide holdings, and someone in Mumbai may well hold a
 * 401(k) from a previous job.
 */
export interface Portfolio {
  id: string
  label: string
  /** ISO 3166 alpha-2, or null for a folio that is not country-shaped. */
  region: string | null
  /** The currency this folio is naturally kept in; stamps its new snapshots. */
  baseCurrency: string
  cadenceMonths: 6 | 12
  order: number
}

export interface Profile {
  handle: string
  email: string
  /**
   * What the user is currently *looking at* — distinct from what a portfolio is
   * *kept in* (`Portfolio.baseCurrency`). One field answered both questions
   * badly; portfolios make the conflation untenable.
   */
  displayCurrency: string
  categoriesCreated: number
  schemaVersion: number
}

export interface CategoryProposal {
  id: string
  label: string
  kind: CategoryKind
  group: CategoryGroup
  proposedBy: string
  proposedByHandle: string
  proposedAt: number | null
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy?: string
  reviewedAt?: number | null
  rejectionReason?: string
}
