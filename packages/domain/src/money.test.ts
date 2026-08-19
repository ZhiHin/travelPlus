import { describe, expect, it } from 'vitest'
import {
  add,
  formatMoney,
  minorUnitExponent,
  money,
  splitByWeights,
  splitEvenly,
  subtract,
  sum,
} from './money.js'

describe('money construction', () => {
  it('rejects non-integer minor units', () => {
    expect(() => money(10.5, 'MYR')).toThrow(TypeError)
  })

  it('rejects malformed currency codes', () => {
    expect(() => money(100, 'myr')).toThrow(TypeError)
    expect(() => money(100, 'RINGGIT')).toThrow(TypeError)
  })

  it('knows currencies with non-standard minor units', () => {
    expect(minorUnitExponent('JPY')).toBe(0)
    expect(minorUnitExponent('KWD')).toBe(3)
    expect(minorUnitExponent('MYR')).toBe(2)
    expect(minorUnitExponent('myr')).toBe(2)
  })
})

describe('arithmetic', () => {
  it('adds and subtracts within one currency', () => {
    expect(add(money(1050, 'MYR'), money(275, 'MYR')).minorUnits).toBe(1325)
    expect(subtract(money(1050, 'MYR'), money(275, 'MYR')).minorUnits).toBe(775)
  })

  // BR-M2 — an implicit cross-currency sum is how a budget silently becomes fiction.
  it('refuses to combine different currencies', () => {
    expect(() => add(money(100, 'MYR'), money(100, 'USD'))).toThrow(/without an explicit conversion/)
  })

  it('sums an empty list to zero', () => {
    expect(sum([], 'MYR').minorUnits).toBe(0)
  })

  it('avoids binary floating-point error that would lose a cent', () => {
    // 0.1 + 0.2 !== 0.3 in float. In minor units it is simply 10 + 20 === 30.
    expect(add(money(10, 'USD'), money(20, 'USD')).minorUnits).toBe(30)
  })
})

describe('splitEvenly — BR-M5 and BR-M6', () => {
  it('distributes the remainder rather than dropping it', () => {
    const shares = splitEvenly(money(1000, 'USD'), 3)
    expect(shares.map((s) => s.minorUnits)).toEqual([334, 333, 333])
  })

  it('sums exactly to the total', () => {
    const total = money(1000, 'USD')
    const shares = splitEvenly(total, 3)
    expect(sum(shares, 'USD').minorUnits).toBe(total.minorUnits)
  })

  it('handles an exact division', () => {
    expect(splitEvenly(money(900, 'USD'), 3).map((s) => s.minorUnits)).toEqual([300, 300, 300])
  })

  it('handles a single share and a zero total', () => {
    expect(splitEvenly(money(777, 'MYR'), 1).map((s) => s.minorUnits)).toEqual([777])
    expect(splitEvenly(money(0, 'MYR'), 4).map((s) => s.minorUnits)).toEqual([0, 0, 0, 0])
  })

  it('splits a refund without losing a unit', () => {
    const total = money(-1000, 'USD')
    const shares = splitEvenly(total, 3)
    expect(shares.map((s) => s.minorUnits)).toEqual([-334, -333, -333])
    expect(sum(shares, 'USD').minorUnits).toBe(-1000)
  })

  it('rejects invalid part counts', () => {
    expect(() => splitEvenly(money(100, 'USD'), 0)).toThrow(RangeError)
    expect(() => splitEvenly(money(100, 'USD'), 2.5)).toThrow(RangeError)
  })

  // Property test: no split, of any amount into any part count, may create or
  // destroy a minor unit. This is the invariant BR-M5 actually asserts.
  it('conserves every minor unit across a wide input space', () => {
    for (let amount = 0; amount <= 500; amount += 7) {
      for (let parts = 1; parts <= 13; parts++) {
        const total = money(amount, 'MYR')
        const shares = splitEvenly(total, parts)
        expect(shares).toHaveLength(parts)
        expect(sum(shares, 'MYR').minorUnits).toBe(amount)
        // Shares differ by at most one minor unit — nobody overpays noticeably.
        const units = shares.map((s) => s.minorUnits)
        expect(Math.max(...units) - Math.min(...units)).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('splitByWeights', () => {
  it('apportions by weight and conserves the total', () => {
    const shares = splitByWeights(money(1000, 'USD'), [2, 1, 1])
    expect(sum(shares, 'USD').minorUnits).toBe(1000)
    expect(shares[0]!.minorUnits).toBe(500)
  })

  it('gives leftover units to the largest remainders, deterministically', () => {
    const a = splitByWeights(money(100, 'USD'), [1, 1, 1])
    const b = splitByWeights(money(100, 'USD'), [1, 1, 1])
    expect(a.map((s) => s.minorUnits)).toEqual(b.map((s) => s.minorUnits))
    expect(sum(a, 'USD').minorUnits).toBe(100)
  })

  it('supports a zero weight for a traveller who owes nothing', () => {
    const shares = splitByWeights(money(900, 'MYR'), [1, 1, 0])
    expect(shares[2]!.minorUnits).toBe(0)
    expect(sum(shares, 'MYR').minorUnits).toBe(900)
  })

  it('rejects empty, negative or all-zero weights', () => {
    expect(() => splitByWeights(money(100, 'USD'), [])).toThrow(RangeError)
    expect(() => splitByWeights(money(100, 'USD'), [-1, 2])).toThrow(RangeError)
    expect(() => splitByWeights(money(100, 'USD'), [0, 0])).toThrow(RangeError)
  })

  it('conserves units across many weight combinations', () => {
    const weightSets = [[1, 2, 3], [5, 5], [1, 1, 1, 1, 1, 1, 7], [3, 1], [2, 2, 2, 1]]
    for (const weights of weightSets) {
      for (let amount = 0; amount <= 300; amount += 11) {
        const shares = splitByWeights(money(amount, 'MYR'), weights)
        expect(sum(shares, 'MYR').minorUnits).toBe(amount)
      }
    }
  })
})

describe('formatMoney', () => {
  it('respects the currency minor unit', () => {
    expect(formatMoney(money(123456, 'JPY'), 'en-US')).toContain('123,456')
    expect(formatMoney(money(1050, 'USD'), 'en-US')).toBe('$10.50')
  })
})
