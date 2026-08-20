import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_POLICY,
  DEFAULT_THROTTLE,
  OPAQUE_RESET,
  OPAQUE_SIGNUP,
  PASSWORD_MIN_LENGTH,
  TOKEN_TTL_SECONDS,
  evaluateSession,
  evaluateToken,
  isThrottled,
  newSessionExpiries,
  retryAfterSeconds,
  slideExpiry,
  validatePassword,
} from './auth.js'

const T0 = new Date('2026-08-20T10:00:00Z')
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

describe('session lifetimes', () => {
  it('is valid inside both windows', () => {
    const s = newSessionExpiries(T0)
    expect(evaluateSession(s, at(60))).toBe('valid')
  })

  it('expires on idle', () => {
    const s = newSessionExpiries(T0)
    expect(evaluateSession(s, at(DEFAULT_SESSION_POLICY.idleSeconds + 1))).toBe('idle-expired')
  })

  // A session refreshed daily forever would never end, turning one stolen cookie
  // into permanent access. The absolute ceiling is what prevents that.
  it('expires absolutely even when activity kept sliding the idle clock', () => {
    const s = {
      expiresAt: at(DEFAULT_SESSION_POLICY.absoluteSeconds + 10_000),
      absoluteExpiry: at(DEFAULT_SESSION_POLICY.absoluteSeconds),
    }
    expect(evaluateSession(s, at(DEFAULT_SESSION_POLICY.absoluteSeconds + 1))).toBe(
      'absolute-expired',
    )
  })

  it('reports absolute expiry in preference to idle when both have passed', () => {
    const s = { expiresAt: at(10), absoluteExpiry: at(20) }
    expect(evaluateSession(s, at(30))).toBe('absolute-expired')
  })

  it('treats the exact expiry instant as expired, not valid', () => {
    const s = { expiresAt: at(10), absoluteExpiry: at(100) }
    expect(evaluateSession(s, at(10))).toBe('idle-expired')
  })
})

describe('sliding expiry', () => {
  it('extends the idle window on activity', () => {
    const s = newSessionExpiries(T0)
    const slid = slideExpiry(s, at(3600))
    expect(slid.getTime()).toBeGreaterThan(s.expiresAt.getTime())
  })

  it('never slides past the absolute ceiling', () => {
    const s = {
      expiresAt: at(100),
      absoluteExpiry: at(200),
    }
    expect(slideExpiry(s, at(150)).getTime()).toBe(s.absoluteExpiry.getTime())
  })
})

describe('throttling', () => {
  it('imposes no delay within the free attempts', () => {
    for (let i = 0; i <= DEFAULT_THROTTLE.freeAttempts; i++) {
      expect(retryAfterSeconds(i)).toBe(0)
    }
  })

  it('grows exponentially past the free attempts', () => {
    expect(retryAfterSeconds(6)).toBe(2)
    expect(retryAfterSeconds(7)).toBe(4)
    expect(retryAfterSeconds(8)).toBe(8)
    expect(retryAfterSeconds(9)).toBe(16)
  })

  // Unbounded growth would let a handful of failed attempts lock a real user out
  // for years, which is a denial of service against the victim, not the attacker.
  it('caps the delay', () => {
    expect(retryAfterSeconds(100)).toBe(DEFAULT_THROTTLE.maxDelaySeconds)
    expect(retryAfterSeconds(1000)).toBe(DEFAULT_THROTTLE.maxDelaySeconds)
  })

  it('is throttled inside the window and free once it passes', () => {
    expect(isThrottled(8, T0, at(3))).toBe(true)
    expect(isThrottled(8, T0, at(9))).toBe(false)
  })

  it('is never throttled with no prior attempt recorded', () => {
    expect(isThrottled(50, null, T0)).toBe(false)
  })
})

describe('single-use tokens', () => {
  it('accepts an unused token inside its window', () => {
    expect(evaluateToken({ expiresAt: at(60), consumedAt: null }, T0)).toBe('valid')
  })

  it('rejects an expired token', () => {
    expect(evaluateToken({ expiresAt: at(-1), consumedAt: null }, T0)).toBe('expired')
  })

  // Reporting a consumed-then-expired token as merely "expired" would hide a
  // replay attempt from the audit trail.
  it('reports replay in preference to expiry', () => {
    expect(evaluateToken({ expiresAt: at(-100), consumedAt: at(-200) }, T0)).toBe('already-used')
  })

  it('gives password reset a shorter life than email verification', () => {
    // A reset link grants account takeover; a verify link does not.
    expect(TOKEN_TTL_SECONDS.PASSWORD_RESET).toBeLessThan(TOKEN_TTL_SECONDS.EMAIL_VERIFY)
  })
})

describe('password rules', () => {
  it('accepts a long passphrase with no symbols', () => {
    expect(validatePassword('correct horse battery staple')).toEqual([])
  })

  it('rejects anything under the minimum length', () => {
    const problems = validatePassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))
    expect(problems.map((p) => p.code)).toContain('TOO_SHORT')
  })

  it('rejects an unbounded body, which is a DoS vector even though argon2 hashes it', () => {
    expect(validatePassword('a'.repeat(1000)).map((p) => p.code)).toContain('TOO_LONG')
  })

  it('rejects obvious choices', () => {
    expect(validatePassword('password123').map((p) => p.code)).toContain('TOO_COMMON')
  })

  it('rejects a password containing the email local part', () => {
    const problems = validatePassword('traveller-secret-99', 'traveller@example.com')
    expect(problems.map((p) => p.code)).toContain('CONTAINS_EMAIL')
  })

  it('ignores a very short email local part to avoid false positives', () => {
    // "an" appearing inside a passphrase should not disqualify it.
    expect(validatePassword('an elephant walked past', 'an@example.com')).toEqual([])
  })

  // Composition rules push people toward Password1! — predictable to an attacker
  // and hard for a human. Length plus a deny-list is the better trade.
  it('does not require symbols, digits or mixed case', () => {
    expect(validatePassword('thequickbrownfoxjumps')).toEqual([])
  })
})

describe('enumeration resistance', () => {
  it('offers no field capable of disclosing whether an account exists', () => {
    for (const r of [OPAQUE_SIGNUP, OPAQUE_RESET]) {
      expect(Object.keys(r).sort()).toEqual(['message', 'ok'])
      expect(r.ok).toBe(true)
    }
  })

  it('phrases the reset message conditionally', () => {
    expect(OPAQUE_RESET.message.toLowerCase()).toContain('if that email has an account')
  })

  it('never says the address is taken or unknown', () => {
    for (const r of [OPAQUE_SIGNUP, OPAQUE_RESET]) {
      expect(r.message.toLowerCase()).not.toMatch(/already (registered|exists|taken)/)
      expect(r.message.toLowerCase()).not.toMatch(/no account|not found|unknown/)
    }
  })
})
