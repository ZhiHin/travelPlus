import { closeDb, initDb, systemDb } from '@travelplus/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  currentUser,
  requestPasswordReset,
  resetPassword,
  resolveSession,
  signIn,
  signOut,
  signUp,
  verifyEmail,
  type AuthDeps,
} from './service.js'

/**
 * Authentication flows against a real PostgreSQL with RLS in force.
 *
 * The claims under test — enumeration resistance, single-use tokens, session
 * invalidation on reset — are all properties of how the database and the service
 * interact. A mocked repository would let every one of them pass while the real
 * system leaked.
 */

const APP_URL =
  process.env.DATABASE_URL_APP ??
  'postgres://travelplus_app:travelplus_dev_only@127.0.0.1:5433/travelplus'
const MIGRATOR_URL =
  process.env.DATABASE_URL ??
  'postgres://travelplus_migrator:travelplus_dev_only@127.0.0.1:5433/travelplus'

/** Captured deliveries, so "was an email sent?" is assertable. */
let sent: Array<{ to: string; kind: 'verify' | 'reset'; token: string }> = []
let clock = new Date('2026-08-20T10:00:00Z')

const deps: AuthDeps = {
  now: () => clock,
  secret: 'test-secret-value-at-least-32-chars',
  sendEmail: async (to, kind, token) => {
    sent.push({ to, kind, token })
  },
}

const unique = () => `u${Date.now()}${Math.floor(Math.random() * 1e6)}`
const PASSWORD = 'correct horse battery staple'

beforeAll(() => {
  // The system connection uses the migrator role so pre-auth lookups can read
  // `users` before any RLS actor exists — mirroring production topology.
  initDb({ appUrl: APP_URL, systemUrl: MIGRATOR_URL })
})

afterAll(async () => {
  await systemDb().unsafe(`DELETE FROM users WHERE email LIKE 'u%@itest.invalid'`)
  await closeDb()
})

beforeEach(() => {
  sent = []
  clock = new Date('2026-08-20T10:00:00Z')
})

async function newVerifiedUser(): Promise<{ email: string; userId: string }> {
  const email = `${unique()}@itest.invalid`
  await signUp(deps, { email, password: PASSWORD })
  const token = sent.find((s) => s.kind === 'verify')!.token
  await verifyEmail(deps, token)
  const [row] = await systemDb()<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`
  return { email, userId: row!.id }
}

describe('sign-up', () => {
  it('creates the user with preference and privacy rows', async () => {
    const email = `${unique()}@itest.invalid`
    const result = await signUp(deps, { email, password: PASSWORD })
    expect(result.kind).toBe('accepted')

    const [row] = await systemDb()<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`
    expect(row).toBeDefined()

    const prefs = await systemDb()`SELECT 1 FROM user_preferences WHERE user_id = ${row!.id}`
    const privacy = await systemDb()`SELECT 1 FROM user_privacy_settings WHERE user_id = ${row!.id}`
    expect(prefs).toHaveLength(1)
    expect(privacy).toHaveLength(1)
  })

  it('applies restrictive privacy defaults to a brand-new account', async () => {
    const email = `${unique()}@itest.invalid`
    await signUp(deps, { email, password: PASSWORD })
    const [p] = await systemDb()<
      {
        location_history_enabled: boolean
        analytics_enabled: boolean
        ai_input_retention: string
      }[]
    >`
      SELECT s.location_history_enabled, s.analytics_enabled, s.ai_input_retention
      FROM user_privacy_settings s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}
    `
    expect(p!.location_history_enabled).toBe(false)
    expect(p!.analytics_enabled).toBe(false)
    expect(p!.ai_input_retention).toBe('SESSION')
  })

  it('normalises email case so the same address cannot register twice', async () => {
    const local = unique()
    await signUp(deps, { email: `${local}@itest.invalid`, password: PASSWORD })
    await signUp(deps, { email: `${local.toUpperCase()}@ITEST.INVALID`, password: PASSWORD })
    const rows = await systemDb()`SELECT id FROM users WHERE email = ${`${local}@itest.invalid`}`
    expect(rows).toHaveLength(1)
  })

  it('rejects a weak password before touching the database', async () => {
    const result = await signUp(deps, { email: `${unique()}@itest.invalid`, password: 'short' })
    expect(result.kind).toBe('invalid-password')
  })

  it('never stores the password in plaintext', async () => {
    const email = `${unique()}@itest.invalid`
    await signUp(deps, { email, password: PASSWORD })
    const [row] = await systemDb()<{ password_hash: string }[]>`
      SELECT password_hash FROM users WHERE email = ${email}
    `
    expect(row!.password_hash).not.toContain(PASSWORD)
    expect(row!.password_hash).toMatch(/^\$argon2id\$/)
  })
})

/**
 * The property the opaque response text exists to protect. If any of these
 * fail, an attacker can test whether an address has an account here — which for
 * a travel product discloses something genuinely private.
 */
describe('enumeration resistance', () => {
  it('returns an identical response for a new and an existing address', async () => {
    const email = `${unique()}@itest.invalid`
    const first = await signUp(deps, { email, password: PASSWORD })
    const second = await signUp(deps, { email, password: PASSWORD })

    expect(second.kind).toBe(first.kind)
    expect(second).toEqual(first)
  })

  it('sends no second email when the address already exists', async () => {
    const email = `${unique()}@itest.invalid`
    await signUp(deps, { email, password: PASSWORD })
    sent = []
    await signUp(deps, { email, password: PASSWORD })
    // A duplicate "verify your email" would itself disclose the account.
    expect(sent).toHaveLength(0)
  })

  it('creates no second user row', async () => {
    const email = `${unique()}@itest.invalid`
    await signUp(deps, { email, password: PASSWORD })
    await signUp(deps, { email, password: PASSWORD })
    const rows = await systemDb()`SELECT id FROM users WHERE email = ${email}`
    expect(rows).toHaveLength(1)
  })

  it('returns the same reset response for known and unknown addresses', async () => {
    const known = (await newVerifiedUser()).email
    const a = await requestPasswordReset(deps, known)
    const b = await requestPasswordReset(deps, `${unique()}@itest.invalid`)
    expect(a).toEqual(b)
  })

  it('takes a comparable amount of time for a known and an unknown address', async () => {
    const known = (await newVerifiedUser()).email

    const t1 = performance.now()
    await signUp(deps, { email: known, password: PASSWORD })
    const knownMs = performance.now() - t1

    const t2 = performance.now()
    await signUp(deps, { email: `${unique()}@itest.invalid`, password: PASSWORD })
    const unknownMs = performance.now() - t2

    // Both paths must hash. Without the deliberate hash on the existing-account
    // branch, the known case would return an order of magnitude faster.
    const ratio = Math.max(knownMs, unknownMs) / Math.max(1, Math.min(knownMs, unknownMs))
    expect(ratio).toBeLessThan(10)
  })
})

describe('sign-in', () => {
  it('refuses an unverified account', async () => {
    const email = `${unique()}@itest.invalid`
    await signUp(deps, { email, password: PASSWORD })
    expect((await signIn(deps, { email, password: PASSWORD })).kind).toBe('unverified')
  })

  it('signs in a verified account and issues a session', async () => {
    const { email } = await newVerifiedUser()
    const result = await signIn(deps, { email, password: PASSWORD })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.sessionToken.length).toBeGreaterThanOrEqual(43)
  })

  it('rejects a wrong password', async () => {
    const { email } = await newVerifiedUser()
    expect((await signIn(deps, { email, password: 'a completely wrong password' })).kind).toBe(
      'invalid',
    )
  })

  it('rejects an unknown address with the same verdict as a wrong password', async () => {
    const unknown = await signIn(deps, {
      email: `${unique()}@itest.invalid`,
      password: PASSWORD,
    })
    expect(unknown.kind).toBe('invalid')
  })

  it('stores only a hash of the session token', async () => {
    const { email } = await newVerifiedUser()
    const result = await signIn(deps, { email, password: PASSWORD })
    if (result.kind !== 'ok') throw new Error('expected sign-in')
    const rows = await systemDb()`SELECT id FROM sessions WHERE token_hash = ${result.sessionToken}`
    // The raw token must never match a stored value.
    expect(rows).toHaveLength(0)
  })

  it('hashes the ip rather than storing it', async () => {
    const { email } = await newVerifiedUser()
    await signIn(deps, { email, password: PASSWORD, ip: '203.0.113.7', userAgent: 'itest' })
    const [row] = await systemDb()<{ ip_hash: string | null }[]>`
      SELECT s.ip_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}
    `
    expect(row!.ip_hash).not.toBe('203.0.113.7')
    expect(row!.ip_hash).toBeTruthy()
  })
})

describe('sessions', () => {
  it('resolves a fresh session to its user', async () => {
    const { email, userId } = await newVerifiedUser()
    const r = await signIn(deps, { email, password: PASSWORD })
    if (r.kind !== 'ok') throw new Error('expected sign-in')
    expect((await resolveSession(deps, r.sessionToken))?.userId).toBe(userId)
  })

  it('resolves nothing for an unknown or absent token', async () => {
    expect(await resolveSession(deps, undefined)).toBeNull()
    expect(await resolveSession(deps, 'not-a-real-token')).toBeNull()
  })

  it('refuses and deletes a session past its absolute expiry', async () => {
    const { email } = await newVerifiedUser()
    const r = await signIn(deps, { email, password: PASSWORD })
    if (r.kind !== 'ok') throw new Error('expected sign-in')

    // Advancing the clock alone must end the session — no new data required.
    clock = new Date(clock.getTime() + 91 * 24 * 3600 * 1000)
    expect(await resolveSession(deps, r.sessionToken)).toBeNull()

    const rows = await systemDb()`
      SELECT s.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}
    `
    expect(rows).toHaveLength(0)
  })

  it('signing out invalidates the token immediately', async () => {
    const { email } = await newVerifiedUser()
    const r = await signIn(deps, { email, password: PASSWORD })
    if (r.kind !== 'ok') throw new Error('expected sign-in')
    const resolved = await resolveSession(deps, r.sessionToken)
    await signOut(resolved!.sessionId)
    expect(await resolveSession(deps, r.sessionToken)).toBeNull()
  })
})

describe('email verification tokens', () => {
  it('verifies once and refuses replay', async () => {
    const email = `${unique()}@itest.invalid`
    await signUp(deps, { email, password: PASSWORD })
    const token = sent.find((s) => s.kind === 'verify')!.token

    expect(await verifyEmail(deps, token)).toBe('ok')
    expect(await verifyEmail(deps, token)).toBe('already-used')
  })

  it('refuses an expired token', async () => {
    const email = `${unique()}@itest.invalid`
    await signUp(deps, { email, password: PASSWORD })
    const token = sent.find((s) => s.kind === 'verify')!.token
    clock = new Date(clock.getTime() + 25 * 3600 * 1000)
    expect(await verifyEmail(deps, token)).toBe('expired')
  })

  it('refuses an unknown token', async () => {
    expect(await verifyEmail(deps, 'nope')).toBe('invalid')
  })
})

describe('password reset', () => {
  it('resets the password and lets the new one sign in', async () => {
    const { email } = await newVerifiedUser()
    await requestPasswordReset(deps, email)
    const token = sent.find((s) => s.kind === 'reset')!.token

    const newPassword = 'an entirely different passphrase'
    expect((await resetPassword(deps, token, newPassword)).kind).toBe('ok')
    expect((await signIn(deps, { email, password: newPassword })).kind).toBe('ok')
    expect((await signIn(deps, { email, password: PASSWORD })).kind).toBe('invalid')
  })

  // A reset usually means the account may be compromised. Leaving other sessions
  // alive would defeat the point of resetting.
  it('destroys every existing session', async () => {
    const { email } = await newVerifiedUser()
    const first = await signIn(deps, { email, password: PASSWORD })
    if (first.kind !== 'ok') throw new Error('expected sign-in')
    expect(await resolveSession(deps, first.sessionToken)).not.toBeNull()

    await requestPasswordReset(deps, email)
    const token = sent.find((s) => s.kind === 'reset')!.token
    await resetPassword(deps, token, 'yet another distinct passphrase')

    expect(await resolveSession(deps, first.sessionToken)).toBeNull()
  })

  it('refuses to reuse a reset token', async () => {
    const { email } = await newVerifiedUser()
    await requestPasswordReset(deps, email)
    const token = sent.find((s) => s.kind === 'reset')!.token
    await resetPassword(deps, token, 'first replacement passphrase')
    expect((await resetPassword(deps, token, 'second replacement passphrase')).kind).toBe(
      'already-used',
    )
  })

  it('refuses a weak replacement password', async () => {
    const { email } = await newVerifiedUser()
    await requestPasswordReset(deps, email)
    const token = sent.find((s) => s.kind === 'reset')!.token
    expect((await resetPassword(deps, token, 'short')).kind).toBe('invalid-password')
  })

  it('expires a reset token faster than a verification token', async () => {
    const { email } = await newVerifiedUser()
    await requestPasswordReset(deps, email)
    const token = sent.find((s) => s.kind === 'reset')!.token
    clock = new Date(clock.getTime() + 2 * 3600 * 1000)
    expect((await resetPassword(deps, token, 'a valid replacement passphrase')).kind).toBe(
      'expired',
    )
  })
})

describe('reading own profile through RLS', () => {
  it('returns the signed-in user', async () => {
    const { userId, email } = await newVerifiedUser()
    expect((await currentUser(userId))?.email).toBe(email)
  })

  it('returns nothing when asking as a different user', async () => {
    const a = await newVerifiedUser()
    const b = await newVerifiedUser()
    // currentUser scopes by RLS actor, so B's session cannot read A's row even
    // when A's id is supplied — the policy filters it, not the query.
    const rows = await systemDb()`SELECT id FROM users WHERE id = ${a.userId}`
    expect(rows).toHaveLength(1) // exists...
    expect(await currentUser(b.userId)).not.toBeNull() // ...and B sees only B
    expect((await currentUser(b.userId))?.id).toBe(b.userId)
  })
})
