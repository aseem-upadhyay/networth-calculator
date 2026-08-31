import { SCHEMA } from './cache'
import type { Category, Profile, Snapshot } from './types'

export interface Backup {
  format: 'networth-calculator'
  schemaVersion: number
  exportedAt: string
  profile: Pick<Profile, 'handle' | 'baseCurrency' | 'cadenceMonths'>
  snapshots: Snapshot[]
  /** Denormalized so a backup still reads on its own if a category is renamed. */
  categories: Category[]
}

/**
 * A year of snapshots is irreplaceable by definition — you cannot reconstruct
 * last March's balances. Frozen FX rates travel with each snapshot, so an export
 * reproduces every historical total exactly, with no network and no Firestore.
 */
export function buildBackup(
  profile: Profile, snapshots: Snapshot[], categories: Category[],
): Backup {
  const used = new Set(snapshots.flatMap((s) => s.holdings.map((h) => h.categoryId)))
  return {
    format: 'networth-calculator',
    schemaVersion: SCHEMA,
    exportedAt: new Date().toISOString(),
    profile: {
      handle: profile.handle,
      baseCurrency: profile.baseCurrency,
      cadenceMonths: profile.cadenceMonths,
    },
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
