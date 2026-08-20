import { describe, expect, it } from 'vitest'
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  ThrottleStore,
  accountKey,
  checkCsrf,
  clearedSessionCookie,
  csrfCookie,
  ipKey,
  newCsrfToken,
  sessionCookie,
} from './http.js'

const PROD = { secure: true }
const DEV = { secure: false }
const T0 = new Date('2026-08-20T10:00:00Z')
const at = (s: number) => new Date(T0.getTime() + s * 1000)

describe('session cookie', () => {
  const c = sessionCookie('tok', 3600, PROD)

  it('is httpOnly so an XSS cannot exfiltrate the session', () => {
    expect(c.httpOnly).toBe(true)
  })

  // Strict would drop the cookie on an inbound link from an email, so a user
  // clicking a verification link would appear signed out. Lax still blocks the
  // cross-site POST that CSRF needs.
  it('is SameSite=Lax, not Strict', () => {
    expect(c.sameSite).toBe('lax')
  })

  it('is Secure in production and not on plain-HTTP localhost', () => {
    expect(c.secure).toBe(true)
    expect(sessionCookie('tok', 3600, DEV).secure).toBe(false)
  })

  it('is scoped to the whole site', () => {
    expect(c.path).toBe('/')
    expect(c.name).toBe(SESSION_COOKIE)
  })

  it('clears with a zero max-age', () => {
    const cleared = clearedSessionCookie(PROD)
    expect(cleared.maxAge).toBe(0)
    expect(cleared.value).toBe('')
  })
})

describe('csrf cookie', () => {
  it('is readable by script, which is what makes double-submit work', () => {
    // The attacker's site can cause the cookie to be SENT but cannot READ it to
    // set the matching header, so the two cannot be made to agree.
    expect(csrfCookie('tok', PROD).httpOnly).toBe(false)
    expect(csrfCookie('tok', PROD).name).toBe(CSRF_COOKIE)
  })

  it('issues unique high-entropy tokens', () => {
    const tokens = new Set(Array.from({ length: 500 }, newCsrfToken))
    expect(tokens.size).toBe(500)
  })
})

describe('checkCsrf', () => {
  const base = {
    cookieToken: 'abc',
    headerToken: 'abc',
    origin: 'https://travelplus.example',
    allowedOrigins: ['https://travelplus.example'],
  }

  it('lets safe methods through untouched', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(checkCsrf({ ...base, method, cookieToken: undefined, headerToken: undefined })).toBe(
        'ok',
      )
    }
  })

  it('accepts a matching token pair from an allowed origin', () => {
    expect(checkCsrf({ ...base, method: 'POST' })).toBe('ok')
  })

  it('rejects a mismatched pair', () => {
    expect(checkCsrf({ ...base, method: 'POST', headerToken: 'different' })).toBe('mismatch')
  })

  it('rejects a missing cookie or header', () => {
    expect(checkCsrf({ ...base, method: 'POST', cookieToken: undefined })).toBe('missing-cookie')
    expect(checkCsrf({ ...base, method: 'POST', headerToken: undefined })).toBe('missing-header')
  })

  it('rejects a foreign origin even when the tokens match', () => {
    expect(checkCsrf({ ...base, method: 'POST', origin: 'https://evil.example' })).toBe(
      'bad-origin',
    )
  })

  // Non-browser clients legitimately omit Origin. An absent one falls through to
  // the token check; a *wrong* one is always fatal.
  it('allows an absent origin but still requires the token pair', () => {
    expect(checkCsrf({ ...base, method: 'POST', origin: undefined })).toBe('ok')
    expect(checkCsrf({ ...base, method: 'POST', origin: undefined, headerToken: 'nope' })).toBe(
      'mismatch',
    )
  })

  it('applies to every state-changing verb', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(checkCsrf({ ...base, method, headerToken: 'wrong' })).toBe('mismatch')
    }
  })
})

describe('ThrottleStore', () => {
  it('allows the first attempts freely', () => {
    const store = new ThrottleStore()
    for (let i = 0; i < 5; i++) {
      expect(store.check('acct:x', T0)).toBe(0)
      store.recordFailure('acct:x', T0)
    }
    expect(store.check('acct:x', T0)).toBe(0)
  })

  it('imposes a growing wait past the free attempts', () => {
    const store = new ThrottleStore()
    for (let i = 0; i < 8; i++) store.recordFailure('acct:x', T0)
    expect(store.check('acct:x', T0)).toBeGreaterThan(0)
  })

  it('lets the caller through once the wait has elapsed', () => {
    const store = new ThrottleStore()
    for (let i = 0; i < 7; i++) store.recordFailure('acct:x', T0)
    const wait = store.check('acct:x', T0)
    expect(store.check('acct:x', at(wait - 1))).toBeGreaterThan(0)
    expect(store.check('acct:x', at(wait + 1))).toBe(0)
  })

  // A legitimate user who mistyped twice then succeeded must not stay throttled.
  it('clears on success', () => {
    const store = new ThrottleStore()
    for (let i = 0; i < 10; i++) store.recordFailure('acct:x', T0)
    expect(store.check('acct:x', T0)).toBeGreaterThan(0)
    store.clear('acct:x')
    expect(store.check('acct:x', T0)).toBe(0)
  })

  it('tracks keys independently', () => {
    const store = new ThrottleStore()
    for (let i = 0; i < 10; i++) store.recordFailure('acct:x', T0)
    expect(store.check('acct:y', T0)).toBe(0)
  })

  it('sweeps stale records', () => {
    const store = new ThrottleStore()
    store.recordFailure('acct:x', T0)
    expect(store.size).toBe(1)
    store.sweep(at(7200))
    expect(store.size).toBe(0)
  })
})

describe('throttle keys', () => {
  // Per-account alone lets one host spray many accounts; per-IP alone lets a
  // distributed attacker grind one account. Both are tracked.
  it('distinguishes account and ip namespaces', () => {
    expect(accountKey('a@example.com')).toMatch(/^acct:/)
    expect(ipKey('203.0.113.7')).toBe('ip:203.0.113.7')
  })

  it('normalises email case so casing cannot dodge the throttle', () => {
    expect(accountKey('A@Example.COM')).toBe(accountKey('a@example.com'))
  })

  // Otherwise the throttle map is itself a list of registered addresses.
  it('hashes the email rather than storing it', () => {
    expect(accountKey('traveller@example.com')).not.toContain('traveller@example.com')
  })
})
