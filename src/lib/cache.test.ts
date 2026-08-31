import { describe, expect, it } from 'vitest'
import { mergeCategories, slugify } from './cache'
import type { Category } from './types'

const cat = (id: string, label: string, tier: Category['tier']): Category =>
  ({ id, label, kind: 'asset', group: 'equity', tier })

describe('slugify', () => {
  it('collapses casing and punctuation so near-identical labels collide', () => {
    // This collision IS the dedupe mechanism: same slug means same document id,
    // and Firestore refuses a create when the document already exists.
    expect(slugify('Mutual Funds')).toBe('mutual-funds')
    expect(slugify('mutual funds')).toBe('mutual-funds')
    expect(slugify('MUTUAL  FUNDS!')).toBe('mutual-funds')
    expect(slugify('  Mutual-Funds  ')).toBe('mutual-funds')
  })

  it('strips accents rather than emitting them raw', () => {
    expect(slugify('Épargne')).toBe('epargne')
  })

  it('caps at the 40 chars the rules enforce', () => {
    expect(slugify('a'.repeat(80)).length).toBe(40)
  })
})

describe('mergeCategories', () => {
  it('lets an approved global category shadow the private copy', () => {
    // The whole point of union-by-slug: approval needs no migration, and every
    // historical snapshot referencing that id keeps resolving.
    const merged = mergeCategories(
      [cat('gold', 'Gold', 'global')],
      [cat('gold', 'Gold', 'custom')],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].tier).toBe('global')
  })

  it('keeps private categories that have no global twin', () => {
    const merged = mergeCategories(
      [cat('gold', 'Gold', 'global')],
      [cat('angel-investments', 'Angel Investments', 'custom')],
    )
    expect(merged.map((c) => c.id).sort()).toEqual(['angel-investments', 'gold'])
  })

  it('sorts by label for the picker', () => {
    const merged = mergeCategories(
      [cat('zebra', 'Zebra', 'global'), cat('apple', 'Apple', 'global')], [],
    )
    expect(merged.map((c) => c.label)).toEqual(['Apple', 'Zebra'])
  })
})

describe('optional-field handling', () => {
  // Firestore throws on undefined rather than treating it as absent, so any
  // optional field reaching a write must be dropped, not passed through.
  const strip = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

  it('drops undefined keys but keeps falsy ones', () => {
    expect(strip({ a: 1, b: undefined, c: 0, d: '', e: false, f: null })).toEqual({
      a: 1, c: 0, d: '', e: false, f: null,
    })
  })

  it('leaves a holding without a note writable', () => {
    const holding = { categoryId: 'gold', amount: 5, currency: 'INR', contributed: 0, note: undefined }
    expect(Object.keys(strip(holding))).not.toContain('note')
  })
})
