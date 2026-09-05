import { describe, expect, it } from 'vitest'
import { convertBetween, MissingRateError } from './money'

// 1 INR = x foreign, exactly as Frankfurter returns for base=INR.
const inrTable = { USD: 0.01134, CAD: 0.01571, EUR: 0.00906 }

describe('convertBetween', () => {
  it('converts out of the table base without a second lookup', () => {
    // The bug this exists to prevent: a table never contains its own base, so
    // treating CAD as the base and looking up rates['INR'] throws.
    expect(convertBetween(1_000_000, 'INR', 'CAD', inrTable, 'INR')).toBeCloseTo(15_710, 2)
  })

  it('converts into the table base', () => {
    expect(convertBetween(100, 'USD', 'INR', inrTable, 'INR')).toBeCloseTo(8818.34, 1)
  })

  it('converts between two non-base currencies via the base', () => {
    // 100 USD -> 8818.34 INR -> CAD
    expect(convertBetween(100, 'USD', 'CAD', inrTable, 'INR')).toBeCloseTo(138.53, 1)
  })

  it('is identity when the currencies match', () => {
    expect(convertBetween(42, 'CAD', 'CAD', inrTable, 'INR')).toBe(42)
    expect(convertBetween(42, 'INR', 'INR', inrTable, 'INR')).toBe(42)
  })

  it('round-trips', () => {
    const there = convertBetween(250_000, 'INR', 'CAD', inrTable, 'INR')
    expect(convertBetween(there, 'CAD', 'INR', inrTable, 'INR')).toBeCloseTo(250_000, 6)
  })

  it('throws for a currency the table does not carry', () => {
    expect(() => convertBetween(10, 'INR', 'BGN', inrTable, 'INR')).toThrow(MissingRateError)
    expect(() => convertBetween(10, 'BGN', 'INR', inrTable, 'INR')).toThrow(MissingRateError)
  })
})
