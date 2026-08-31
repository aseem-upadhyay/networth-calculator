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

export interface Profile {
  handle: string
  email: string
  baseCurrency: string
  cadenceMonths: 6 | 12
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
