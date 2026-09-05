import type { Category } from './types'

/**
 * Does this category belong in a portfolio for `region`?
 *
 * Used to *order* the picker, never to restrict it — a category failing this is
 * demoted to an "other jurisdictions" group, not hidden. Someone in Mumbai may
 * hold a 401(k) from a previous job.
 */
export function inRegion(c: Category, region: string | null): boolean {
  return !region || c.regions.includes('GLOBAL') || c.regions.includes(region)
}

/** Split a catalog into the region's own instruments and everything else. */
export function partitionByRegion(
  categories: Category[], region: string | null,
): { relevant: Category[]; elsewhere: Category[] } {
  return {
    relevant: categories.filter((c) => inRegion(c, region)),
    elsewhere: categories.filter((c) => !inRegion(c, region)),
  }
}
