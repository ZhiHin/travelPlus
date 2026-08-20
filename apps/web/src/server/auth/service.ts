import {
  OPAQUE_RESET,
  OPAQUE_SIGNUP,
  TOKEN_TTL_SECONDS,
  evaluateSession,
  evaluateToken,
  newSessionExpiries,
  slideExpiry,
  uuidv7,
  validatePassword,
  type OpaqueAuthResponse,
  type PasswordProblem,
} from '@travelplus/domain'
import { systemDb, withUser, type Sql } from '@travelplus/db'
import {
  dummyVerify,
  generateToken,
  hashIdentifier,
  hashPassword,
  hashToken,
  needsRehash,
  verifyPassword,
} from './crypto.js'

/**
 * Authentication services.
 *
 * Two rules shape almost every function here:
 *
 *  1. Sign-up and reset never disclose whether an address is registered — not in
 *     the response body, not in the status code, and not in how long they take.
 *  2. Session lookup runs before any actor exists, so it uses the system
 *     connection rather than an RLS-scoped one. Everything after authentication
 *     goes through `withUser`.
 */

export interface AuthDeps {
  readonly now: () => Date
  readonly secret: string
  /** Delivery is a side effect; injected so tests can assert on it. */
  readonly sendEmail: (to: string, kind: 'verify' | 'reset', token: string) => Promise<void>
}

export interface SignUpInput {
  readonly email: string
  readonly password: string
}

export type SignUpResult =
  | { readonly kind: 'accepted'; readonly response: OpaqueAuthResponse }
  | { readonly kind: 'invalid-password'; readonly problems: PasswordProblem[] }

/**
 * Create an account, or silently do nothing if the address already exists.
 *
 * Both paths return the identical response. Password problems are the one
 * exception and are safe: they concern the password the caller just typed, and
 * are evaluated before the database is consulted at all, so they reveal nothing
 * about whether the account exists.
 */
export async function signUp(deps: AuthDeps, input: SignUpInput): Promise<SignUpResult> {
  const email = normaliseEmail(input.email)

  const problems = validatePassword(input.password, email)
  if (problems.length > 0) return { kind: 'invalid-password', problems }

  const sql = systemDb()
  const existing = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`

  if (existing.length > 0) {
    // Spend comparable work so the timing does not disclose the account, and
    // send nothing — a second "verify your email" would itself be a signal.
    await hashPassword(input.password)
    return { kind: 'accepted', response: OPAQUE_SIGNUP }
  }

  const userId = uuidv7()
  const passwordHash = await hashPassword(input.password)
  const token = generateToken()
  const now = deps.now()

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO users (id, email, password_hash) VALUES (${userId}, ${email}, ${passwordHash})
    `
    await tx`INSERT INTO user_preferences (user_id) VALUES (${userId})`
    // Restrictive privacy defaults come from the column defaults, so a row that
    // simply exists is already in the most private configuration.
    await tx`INSERT INTO user_privacy_settings (user_id) VALUES (${userId})`
    await tx`
      INSERT INTO verification_tokens (id, user_id, purpose, token_hash, expires_at)
      VALUES (${uuidv7()}, ${userId}, 'EMAIL_VERIFY', ${hashToken(token)},
              ${new Date(now.getTime() + TOKEN_TTL_SECONDS.EMAIL_VERIFY * 1000)})
    `
  })

  await deps.sendEmail(email, 'verify', token)
  return { kind: 'accepted', response: OPAQUE_SIGNUP }
}

export interface SignInInput {
  readonly email: string
  readonly password: string
  readonly ip?: string
  readonly userAgent?: string
}

export type SignInResult =
  | { readonly kind: 'ok'; readonly sessionToken: string; readonly userId: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unverified' }

/**
 * Verify credentials and open a session.
 *
 * A missing account still performs an Argon2 verification against a dummy hash,
 * so the "no such user" path costs the same as a wrong password.
 */
export async function signIn(deps: AuthDeps, input: SignInInput): Promise<SignInResult> {
  const email = normaliseEmail(input.email)
  const sql = systemDb()

  const [user] = await sql<{ id: string; password_hash: string; email_verified_at: Date | null }[]>`
    SELECT id, password_hash, email_verified_at FROM users
    WHERE email = ${email} AND deleted_at IS NULL LIMIT 1
  `

  if (!user) {
    await dummyVerify(input.password)
    return { kind: 'invalid' }
  }

  if (!(await verifyPassword(user.password_hash, input.password))) {
    return { kind: 'invalid' }
  }

  if (user.email_verified_at === null) return { kind: 'unverified' }

  // Parameters may have been raised since this hash was written. Upgrade now,
  // while the plaintext is legitimately in hand.
  if (needsRehash(user.password_hash)) {
    const upgraded = await hashPassword(input.password)
    await sql`UPDATE users SET password_hash = ${upgraded} WHERE id = ${user.id}`
  }

  const token = await createSession(deps, user.id, input.ip, input.userAgent)
  return { kind: 'ok', sessionToken: token, userId: user.id }
}

export async function createSession(
  deps: AuthDeps,
  userId: string,
  ip?: string,
  userAgent?: string,
): Promise<string> {
  const token = generateToken()
  const { expiresAt, absoluteExpiry } = newSessionExpiries(deps.now())

  await systemDb()`
    INSERT INTO sessions (id, user_id, token_hash, expires_at, absolute_expiry, ip_hash, user_agent_hash)
    VALUES (${uuidv7()}, ${userId}, ${hashToken(token)}, ${expiresAt}, ${absoluteExpiry},
            ${ip ? hashIdentifier(ip, deps.secret) : null},
            ${userAgent ? hashIdentifier(userAgent, deps.secret) : null})
  `
  return token
}

export interface ResolvedSession {
  readonly userId: string
  readonly sessionId: string
}

/**
 * Resolve a session cookie to an actor.
 *
 * Runs on the system connection because no actor exists yet — this is the call
 * that establishes one. An expired session is deleted rather than left to
 * accumulate.
 */
export async function resolveSession(
  deps: AuthDeps,
  token: string | undefined,
): Promise<ResolvedSession | null> {
  if (!token) return null
  const sql = systemDb()
  const now = deps.now()

  const [row] = await sql<
    { id: string; user_id: string; expires_at: Date; absolute_expiry: Date }[]
  >`
    SELECT id, user_id, expires_at, absolute_expiry FROM sessions
    WHERE token_hash = ${hashToken(token)} LIMIT 1
  `
  if (!row) return null

  const verdict = evaluateSession(
    { expiresAt: row.expires_at, absoluteExpiry: row.absolute_expiry },
    now,
  )
  if (verdict !== 'valid') {
    await sql`DELETE FROM sessions WHERE id = ${row.id}`
    return null
  }

  const slid = slideExpiry({ expiresAt: row.expires_at, absoluteExpiry: row.absolute_expiry }, now)
  await sql`UPDATE sessions SET expires_at = ${slid}, last_seen_at = ${now} WHERE id = ${row.id}`

  return { userId: row.user_id, sessionId: row.id }
}

export async function signOut(sessionId: string): Promise<void> {
  await systemDb()`DELETE FROM sessions WHERE id = ${sessionId}`
}

export type VerifyEmailResult = 'ok' | 'invalid' | 'expired' | 'already-used'

export async function verifyEmail(deps: AuthDeps, token: string): Promise<VerifyEmailResult> {
  const sql = systemDb()
  const [row] = await sql<
    { id: string; user_id: string; expires_at: Date; consumed_at: Date | null }[]
  >`
    SELECT id, user_id, expires_at, consumed_at FROM verification_tokens
    WHERE token_hash = ${hashToken(token)} AND purpose = 'EMAIL_VERIFY' LIMIT 1
  `
  if (!row) return 'invalid'

  const verdict = evaluateToken(
    { expiresAt: row.expires_at, consumedAt: row.consumed_at },
    deps.now(),
  )
  if (verdict !== 'valid') return verdict

  await sql.begin(async (tx) => {
    // `consumed_at IS NULL` in the predicate makes single use atomic: two
    // concurrent redemptions cannot both succeed.
    await tx`
      UPDATE verification_tokens SET consumed_at = ${deps.now()}
      WHERE id = ${row.id} AND consumed_at IS NULL
    `
    await tx`UPDATE users SET email_verified_at = ${deps.now()} WHERE id = ${row.user_id}`
  })
  return 'ok'
}

/** Always returns the same opaque response, whether or not the address exists. */
export async function requestPasswordReset(
  deps: AuthDeps,
  emailInput: string,
): Promise<OpaqueAuthResponse> {
  const email = normaliseEmail(emailInput)
  const sql = systemDb()

  const [user] = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE email = ${email} AND deleted_at IS NULL LIMIT 1
  `

  if (user) {
    const token = generateToken()
    await sql`
      INSERT INTO verification_tokens (id, user_id, purpose, token_hash, expires_at)
      VALUES (${uuidv7()}, ${user.id}, 'PASSWORD_RESET', ${hashToken(token)},
              ${new Date(deps.now().getTime() + TOKEN_TTL_SECONDS.PASSWORD_RESET * 1000)})
    `
    await deps.sendEmail(email, 'reset', token)
  }

  return OPAQUE_RESET
}

export type ResetPasswordResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'invalid' | 'expired' | 'already-used' }
  | { readonly kind: 'invalid-password'; readonly problems: PasswordProblem[] }

export async function resetPassword(
  deps: AuthDeps,
  token: string,
  newPassword: string,
): Promise<ResetPasswordResult> {
  const problems = validatePassword(newPassword)
  if (problems.length > 0) return { kind: 'invalid-password', problems }

  const sql = systemDb()
  const [row] = await sql<
    { id: string; user_id: string; expires_at: Date; consumed_at: Date | null }[]
  >`
    SELECT id, user_id, expires_at, consumed_at FROM verification_tokens
    WHERE token_hash = ${hashToken(token)} AND purpose = 'PASSWORD_RESET' LIMIT 1
  `
  if (!row) return { kind: 'invalid' }

  const verdict = evaluateToken(
    { expiresAt: row.expires_at, consumedAt: row.consumed_at },
    deps.now(),
  )
  if (verdict !== 'valid') return { kind: verdict }

  const hashed = await hashPassword(newPassword)
  await sql.begin(async (tx) => {
    await tx`
      UPDATE verification_tokens SET consumed_at = ${deps.now()}
      WHERE id = ${row.id} AND consumed_at IS NULL
    `
    await tx`UPDATE users SET password_hash = ${hashed} WHERE id = ${row.user_id}`
    // Every existing session dies. A password reset usually means the account
    // may be compromised, so leaving other sessions alive would defeat it.
    await tx`DELETE FROM sessions WHERE user_id = ${row.user_id}`
  })

  return { kind: 'ok' }
}

/** Read the signed-in user's own profile, through RLS. */
export async function currentUser(userId: string): Promise<{ id: string; email: string } | null> {
  return withUser(userId, async (tx: Sql) => {
    const [row] = await tx<{ id: string; email: string }[]>`
      SELECT id, email FROM users WHERE id = ${userId} LIMIT 1
    `
    return row ?? null
  })
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}
