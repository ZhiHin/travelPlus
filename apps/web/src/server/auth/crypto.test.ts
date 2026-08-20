import { describe, expect, it } from 'vitest'
import {
  dummyVerify,
  generateToken,
  hashIdentifier,
  hashPassword,
  hashToken,
  needsRehash,
  safeEqual,
  verifyPassword,
} from './crypto.js'

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const h = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(h, 'correct horse battery staple')).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const h = await hashPassword('correct horse battery staple')
    expect(await verifyPassword(h, 'incorrect horse battery staple')).toBe(false)
  })

  it('produces a different hash each time (per-hash salt)', async () => {
    const a = await hashPassword('same password twice')
    const b = await hashPassword('same password twice')
    expect(a).not.toBe(b)
    expect(await verifyPassword(a, 'same password twice')).toBe(true)
    expect(await verifyPassword(b, 'same password twice')).toBe(true)
  })

  it('is Argon2id, not Argon2i or Argon2d', async () => {
    expect(await hashPassword('x'.repeat(20))).toMatch(/^\$argon2id\$/)
  })

  it('never stores the password in the hash', async () => {
    const secret = 'a-very-distinctive-passphrase'
    expect(await hashPassword(secret)).not.toContain(secret)
  })

  // A corrupted row must fail closed rather than crash the route and reveal
  // that this particular account's data is unusual.
  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
    expect(await verifyPassword('', 'anything')).toBe(false)
  })

  it('handles unicode and very long passwords', async () => {
    const pw = '日本語のパスワード🔐' + 'x'.repeat(200)
    const h = await hashPassword(pw)
    expect(await verifyPassword(h, pw)).toBe(true)
  })
})

/**
 * Without a dummy verify, "no such user" returns in microseconds while a real
 * account spends tens of milliseconds in Argon2. That difference is a timing
 * oracle that leaks precisely what the opaque response text exists to hide.
 */
describe('timing-oracle defence', () => {
  it('always reports failure', async () => {
    expect(await dummyVerify('anything')).toBe(false)
  })

  it('spends comparable time to a real verification', async () => {
    const h = await hashPassword('a real user password here')

    async function medianMs(run: () => Promise<unknown>, samples = 5): Promise<number> {
      const timings: number[] = []
      for (let i = 0; i < samples; i++) {
        const start = performance.now()
        await run()
        timings.push(performance.now() - start)
      }
      return timings.sort((a, b) => a - b)[Math.floor(samples / 2)]!
    }

    // Warm both paths first. The first Argon2 call in a process pays JIT and
    // allocation costs that have nothing to do with the property under test —
    // measuring them made this assertion flaky, and a flaky security test is one
    // that eventually gets ignored.
    await verifyPassword(h, 'warmup')
    await dummyVerify('warmup')

    const realMs = await medianMs(() => verifyPassword(h, 'the wrong password entirely'))
    const dummyMs = await medianMs(() => dummyVerify('the wrong password entirely'))

    // Same order of magnitude is the property that matters; exact parity is
    // neither achievable nor required to close the oracle. What must never
    // happen is the dummy path returning ~instantly.
    const ratio = Math.max(realMs, dummyMs) / Math.max(0.5, Math.min(realMs, dummyMs))
    expect(ratio, `real ${realMs.toFixed(1)}ms vs dummy ${dummyMs.toFixed(1)}ms`).toBeLessThan(10)
  })
})

describe('rehash detection', () => {
  it('does not ask to rehash a current hash', async () => {
    expect(needsRehash(await hashPassword('a current password value'))).toBe(false)
  })

  it('asks to rehash weaker parameters', () => {
    expect(needsRehash('$argon2id$v=19$m=4096,t=1,p=1$c2FsdA$aGFzaA')).toBe(true)
  })

  it('asks to rehash anything unparseable', () => {
    expect(needsRehash('bcrypt$something')).toBe(true)
  })
})

describe('opaque tokens', () => {
  it('generates unique, URL-safe, high-entropy tokens', () => {
    const tokens = new Set(Array.from({ length: 2000 }, generateToken))
    expect(tokens.size).toBe(2000)
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/) // base64url: safe in a URL unencoded
      expect(t.length).toBeGreaterThanOrEqual(43) // 256 bits
    }
  })

  it('hashes deterministically so lookup works', () => {
    const t = generateToken()
    expect(hashToken(t)).toBe(hashToken(t))
  })

  it('never lets the stored hash reveal the token', () => {
    const t = generateToken()
    expect(hashToken(t)).not.toContain(t)
  })

  it('produces different hashes for different tokens', () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()))
  })
})

describe('safeEqual', () => {
  it('matches identical strings and rejects different ones', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true)
    expect(safeEqual('abc123', 'abc124')).toBe(false)
  })

  it('rejects differing lengths without throwing', () => {
    expect(safeEqual('short', 'muchlongervalue')).toBe(false)
  })

  it('handles empty strings', () => {
    expect(safeEqual('', '')).toBe(true)
  })
})

describe('identifier hashing', () => {
  it('is stable for the same input and secret', () => {
    expect(hashIdentifier('203.0.113.7', 'secret')).toBe(hashIdentifier('203.0.113.7', 'secret'))
  })

  // An IPv4 space is small enough to enumerate, so an unkeyed digest would be
  // trivially reversible by rainbow table.
  it('differs under a different secret, so digests are not rainbow-tableable', () => {
    expect(hashIdentifier('203.0.113.7', 'secret-a')).not.toBe(
      hashIdentifier('203.0.113.7', 'secret-b'),
    )
  })

  it('never contains the raw value', () => {
    expect(hashIdentifier('203.0.113.7', 'secret')).not.toContain('203.0.113.7')
  })
})
