/**
 * Authentication policy — pure decisions, no crypto and no I/O.
 *
 * Hashing, token generation and storage live in adapters. What lives here is
 * every rule that decides *whether* something is allowed, so those rules can be
 * tested exhaustively without a database or a password hasher, and so they
 * cannot quietly differ between the web app and the worker.
 */

/** Session lifetimes. Two clocks, because they answer different questions. */
export interface SessionPolicy {
  /** Sliding: how long without activity before the session dies. */
  readonly idleSeconds: number
  /** Hard ceiling: how long since sign-in, regardless of activity. */
  readonly absoluteSeconds: number
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  idleSeconds: 60 * 60 * 24 * 14, // 14 days
  absoluteSeconds: 60 * 60 * 24 * 90, // 90 days
}

export interface SessionRecord {
  readonly expiresAt: Date
  readonly absoluteExpiry: Date
}

export type SessionVerdict = 'valid' | 'idle-expired' | 'absolute-expired'

/**
 * Both clocks are checked, and the absolute one wins.
 *
 * A session refreshed every day forever would otherwise never end, which turns a
 * single stolen cookie into permanent access.
 */
export function evaluateSession(session: SessionRecord, now: Date): SessionVerdict {
  if (now >= session.absoluteExpiry) return 'absolute-expired'
  if (now >= session.expiresAt) return 'idle-expired'
  return 'valid'
}

/** New idle expiry after activity, never exceeding the absolute ceiling. */
export function slideExpiry(
  session: SessionRecord,
  now: Date,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
): Date {
  const slid = new Date(now.getTime() + policy.idleSeconds * 1000)
  return slid > session.absoluteExpiry ? session.absoluteExpiry : slid
}

export function newSessionExpiries(
  now: Date,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
): SessionRecord {
  return {
    expiresAt: new Date(now.getTime() + policy.idleSeconds * 1000),
    absoluteExpiry: new Date(now.getTime() + policy.absoluteSeconds * 1000),
  }
}

// ---------------------------------------------------------------------------
// Throttling
// ---------------------------------------------------------------------------

export interface ThrottlePolicy {
  /** Attempts allowed before any delay is imposed. */
  readonly freeAttempts: number
  readonly baseDelaySeconds: number
  readonly maxDelaySeconds: number
}

export const DEFAULT_THROTTLE: ThrottlePolicy = {
  freeAttempts: 5,
  baseDelaySeconds: 2,
  maxDelaySeconds: 900, // 15 minutes
}

/**
 * Seconds a client must wait before the next attempt.
 *
 * Exponential with a ceiling: fast enough that a real person mistyping twice
 * notices nothing, slow enough that online guessing stops being viable. The
 * ceiling matters — unbounded growth would let one failed attempt lock a real
 * user out for years.
 */
export function retryAfterSeconds(
  failedAttempts: number,
  policy: ThrottlePolicy = DEFAULT_THROTTLE,
): number {
  if (failedAttempts <= policy.freeAttempts) return 0
  const over = failedAttempts - policy.freeAttempts
  const delay = policy.baseDelaySeconds * 2 ** (over - 1)
  return Math.min(delay, policy.maxDelaySeconds)
}

export function isThrottled(
  failedAttempts: number,
  lastAttemptAt: Date | null,
  now: Date,
  policy: ThrottlePolicy = DEFAULT_THROTTLE,
): boolean {
  const wait = retryAfterSeconds(failedAttempts, policy)
  if (wait === 0 || lastAttemptAt === null) return false
  return now.getTime() - lastAttemptAt.getTime() < wait * 1000
}

// ---------------------------------------------------------------------------
// Single-use, expiring tokens
// ---------------------------------------------------------------------------

export interface TokenRecord {
  readonly expiresAt: Date
  readonly consumedAt: Date | null
}

export type TokenVerdict = 'valid' | 'expired' | 'already-used'

/**
 * `already-used` is checked before `expired`.
 *
 * A consumed token that later expires is still a replay attempt, and reporting
 * it as merely expired would hide that from the audit trail.
 */
export function evaluateToken(token: TokenRecord, now: Date): TokenVerdict {
  if (token.consumedAt !== null) return 'already-used'
  if (now >= token.expiresAt) return 'expired'
  return 'valid'
}

export const TOKEN_TTL_SECONDS = {
  EMAIL_VERIFY: 60 * 60 * 24, // 24 hours
  PASSWORD_RESET: 60 * 60, // 1 hour — shorter, it grants account takeover
} as const

// ---------------------------------------------------------------------------
// Password rules
// ---------------------------------------------------------------------------

export interface PasswordProblem {
  readonly code: 'TOO_SHORT' | 'TOO_LONG' | 'TOO_COMMON' | 'CONTAINS_EMAIL'
  readonly message: string
}

export const PASSWORD_MIN_LENGTH = 12
/** Argon2 hashes the input, but an unbounded body is still a DoS vector. */
export const PASSWORD_MAX_LENGTH = 256

/**
 * A small, blatant deny-list. Not a substitute for a breach-corpus check — that
 * belongs in an adapter with real data — but it catches the worst choices
 * without a network call.
 */
const OBVIOUS = new Set([
  'password',
  'password123',
  'passw0rd',
  '123456789012',
  'qwertyuiop',
  'letmein12345',
  'travelplus',
  'iloveyou1234',
])

/**
 * Length first, and no composition rules.
 *
 * Mandatory symbol-and-digit rules push people toward `Password1!` — predictable
 * to an attacker and hard for a human. Length plus a deny-list is the better
 * trade, and matches current guidance.
 */
export function validatePassword(password: string, email?: string): PasswordProblem[] {
  const problems: PasswordProblem[] = []

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push({
      code: 'TOO_SHORT',
      message: `Use at least ${PASSWORD_MIN_LENGTH} characters. Length matters more than symbols.`,
    })
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push({ code: 'TOO_LONG', message: `Use at most ${PASSWORD_MAX_LENGTH} characters.` })
  }
  if (OBVIOUS.has(password.toLowerCase())) {
    problems.push({ code: 'TOO_COMMON', message: 'That password is too easy to guess.' })
  }
  if (email) {
    const local = email.split('@')[0]?.toLowerCase()
    if (local && local.length >= 3 && password.toLowerCase().includes(local)) {
      problems.push({
        code: 'CONTAINS_EMAIL',
        message: 'Avoid using your email address in your password.',
      })
    }
  }

  return problems
}

// ---------------------------------------------------------------------------
// Enumeration resistance
// ---------------------------------------------------------------------------

/**
 * The single response shape for sign-up and password-reset requests.
 *
 * Returned identically whether or not the address exists. A caller that cannot
 * express "this email is already registered" cannot leak it, which is why this
 * is a type rather than a convention (threat model §3, Spoofing).
 */
export interface OpaqueAuthResponse {
  readonly ok: true
  readonly message: string
}

export const OPAQUE_SIGNUP: OpaqueAuthResponse = {
  ok: true,
  message: 'Check your email to finish setting up your account.',
}

export const OPAQUE_RESET: OpaqueAuthResponse = {
  ok: true,
  message: 'If that email has an account, a reset link is on its way.',
}
