import { SCHEMA } from './cache'
import type { Category, Portfolio, Profile, Snapshot } from './types'

export interface Backup {
  format: 'networth-calculator'
  schemaVersion: number
  exportedAt: string
  profile: Pick<Profile, 'handle' | 'displayCurrency'>
  portfolios: Portfolio[]
  /** portfolioId -> that folio's own timeline. */
  snapshots: Record<string, Snapshot[]>
  /** Denormalized so a backup still reads on its own if a category is renamed. */
  categories: Category[]
}

/**
 * A year of snapshots is irreplaceable by definition — you cannot reconstruct
 * last March's balances. Frozen FX rates travel with each snapshot, so an export
 * reproduces every historical total exactly, with no network and no Firestore.
 */
export function buildBackup(
  profile: Profile,
  portfolios: Portfolio[],
  snapshots: Record<string, Snapshot[]>,
  categories: Category[],
): Backup {
  const used = new Set(
    Object.values(snapshots).flat().flatMap((s) => s.holdings.map((h) => h.categoryId)),
  )
  return {
    format: 'networth-calculator',
    schemaVersion: SCHEMA,
    exportedAt: new Date().toISOString(),
    profile: { handle: profile.handle, displayCurrency: profile.displayCurrency },
    portfolios,
    snapshots,
    categories: categories.filter((c) => used.has(c.id)),
  }
}

export function downloadBackup(backup: Backup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `networth-${backup.exportedAt.slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Months until the next update is due, negative once overdue. */
export function monthsUntilDue(lastAsOfDate: string, cadenceMonths: number): number {
  const last = new Date(`${lastAsOfDate}T00:00:00Z`)
  const due = new Date(last)
  due.setUTCMonth(due.getUTCMonth() + cadenceMonths)
  return (due.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.44)
}

export interface ImportPlan {
  portfolios: { id: string; label: string; snapshots: number; isNew: boolean }[]
  /** Dates already present that the file would overwrite. */
  conflicts: { portfolio: string; asOfDate: string }[]
  totalSnapshots: number
}

export class InvalidBackupError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'InvalidBackupError'
  }
}

/**
 * Parse and validate a backup file.
 *
 * Deliberately strict: this is the destructive half of export, and a malformed
 * or foreign file that got half-applied would be worse than one rejected
 * outright. Nothing is written until a plan has been shown and confirmed.
 */
export function parseBackup(text: string): Backup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new InvalidBackupError('That is not a JSON file.')
  }

  const b = raw as Partial<Backup>
  if (b.format !== 'networth-calculator') {
    throw new InvalidBackupError('That file was not exported from this app.')
  }
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > SCHEMA) {
    throw new InvalidBackupError(
      `That file uses schema v${b.schemaVersion}, newer than this app understands (v${SCHEMA}).`,
    )
  }
  if (!Array.isArray(b.portfolios) || typeof b.snapshots !== 'object' || !b.snapshots) {
    throw new InvalidBackupError('The file is missing its portfolios or snapshots.')
  }
  return b as Backup
}

/** What importing would do, computed before anything is written. */
export function planImport(
  backup: Backup,
  existing: { id: string }[],
  existingSnapshots: Record<string, { asOfDate: string }[]>,
): ImportPlan {
  const have = new Set(existing.map((p) => p.id))
  const conflicts: ImportPlan['conflicts'] = []
  let total = 0

  const portfolios = backup.portfolios.map((p) => {
    const incoming = backup.snapshots[p.id] ?? []
    total += incoming.length
    const currentDates = new Set((existingSnapshots[p.id] ?? []).map((s) => s.asOfDate))
    for (const s of incoming) {
      if (currentDates.has(s.asOfDate)) conflicts.push({ portfolio: p.label, asOfDate: s.asOfDate })
    }
    return { id: p.id, label: p.label, snapshots: incoming.length, isNew: !have.has(p.id) }
  })

  return { portfolios, conflicts, totalSnapshots: total }
}
