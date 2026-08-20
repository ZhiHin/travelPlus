import { describe, expect, it } from 'vitest'
import { isUuid, isUuidV7, uuidV7Timestamp, uuidv7 } from './id.js'

describe('uuidv7 format', () => {
  it('produces a well-formed UUID', () => {
    expect(isUuid(uuidv7())).toBe(true)
  })

  it('sets version 7 and the RFC 4122 variant', () => {
    for (let i = 0; i < 200; i++) expect(isUuidV7(uuidv7())).toBe(true)
  })

  it('rejects a timestamp outside the 48-bit range', () => {
    expect(() => uuidv7({ now: -1 })).toThrow(RangeError)
    expect(() => uuidv7({ now: 2 ** 49 })).toThrow(RangeError)
  })
})

describe('ordering — the reason for choosing v7 (ADR-0015)', () => {
  it('sorts lexicographically in creation order', () => {
    const ids = [0, 1, 2, 5, 100, 100_000].map((offset) =>
      uuidv7({ now: 1_760_000_000_000 + offset }),
    )
    expect([...ids].sort()).toEqual(ids)
  })

  it('keeps ordering across a 2^32 millisecond boundary', () => {
    // The timestamp is split at 2^32; a naive bitwise implementation flips sign
    // here and silently produces ids that sort backwards.
    const below = uuidv7({ now: 2 ** 32 - 1 })
    const above = uuidv7({ now: 2 ** 32 + 1 })
    expect(below < above).toBe(true)
  })

  it('orders correctly for real generation over time', () => {
    const a = uuidv7({ now: 1_700_000_000_000 })
    const b = uuidv7({ now: 1_800_000_000_000 })
    const c = uuidv7({ now: 1_900_000_000_000 })
    expect([c, a, b].sort()).toEqual([a, b, c])
  })
})

describe('uniqueness', () => {
  it('does not collide within the same millisecond', () => {
    const fixed = 1_760_000_000_000
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7({ now: fixed })))
    expect(ids.size).toBe(5000)
  })
})

describe('timestamp recovery', () => {
  it('round-trips the embedded creation time', () => {
    const now = 1_760_000_123_456
    expect(uuidV7Timestamp(uuidv7({ now })).getTime()).toBe(now)
  })

  it('refuses a non-v7 uuid', () => {
    expect(() => uuidV7Timestamp('00000000-0000-4000-8000-000000000000')).toThrow(TypeError)
  })
})

describe('determinism under injection', () => {
  it('is fully reproducible when both sources are supplied', () => {
    const fill = (into: Uint8Array) => {
      into.fill(0xab)
      return into
    }
    const a = uuidv7({ now: 1_760_000_000_000, randomBytes: fill })
    const b = uuidv7({ now: 1_760_000_000_000, randomBytes: fill })
    expect(a).toBe(b)
    expect(isUuidV7(a)).toBe(true)
  })
})
