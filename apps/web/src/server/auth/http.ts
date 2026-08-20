import { retryAfterSeconds, type ThrottlePolicy } from '@travelplus/domain'
import { generateToken, hashToken, safeEqual } from './crypto.js'

/**
 * HTTP-layer authentication concerns: cookies, CSRF and throttling.
 *
 * Separated from `service.ts` so the flows can be tested without inventing
 * requests, and so the cookie attributes live in exactly one place — a
 * `SameSite` or `httpOnly` that drifts on one route is a real vulnerability
 * and an easy one to miss in review.
 */

export const SESSION_COOKIE = 'tp_session'
export const CSRF_COOKIE = 'tp_csrf'
export const CSRF_HEADER = 'x-csrf-token'

export interface CookieAttributes {
  readonly name: string
  readonly value: string
  readonly httpOnly: boolean
  readonly sameSite: 'lax' | 'strict' | 'none'
  readonly secure: boolean
  readonly path: string
  readonly maxAge: number
}

export interface CookieOptions {
  /** `Secure` is dropped on plain-HTTP localhost, where it would prevent the cookie working. */
  readonly secure: boolean
}

/**
 * The session cookie.
 *
 * `httpOnly` so script cannot read it — an XSS then cannot exfiltrate the
 * session. `SameSite=Lax` rather than `Strict`: Strict would drop the cookie on
 * an inbound link from an email, so a user clicking a verification link would
 * appear signed out. Lax still blocks the cross-site POST that CSRF needs.
 */
export function sessionCookie(
  token: string,
  maxAgeSeconds: number,
  opts: CookieOptions,
): CookieAttributes {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

export function clearedSessionCookie(opts: CookieOptions): CookieAttributes {
  return { ...sessionCookie('', 0, opts), maxAge: 0 }
}

/**
 * The CSRF cookie is deliberately readable by script.
 *
 * That is the double-submit pattern: the page reads this value and echoes it in
 * a header. An attacker's site can cause a request to be *sent* with the
 * cookie, but the same-origin policy stops them from *reading* it to set the
 * header, so the two cannot be made to match.
 */
export function csrfCookie(token: string, opts: CookieOptions): CookieAttributes {
  return {
    name: CSRF_COOKIE,
    value: token,
    httpOnly: false,
    sameSite: 'lax',
    secure: opts.secure,
    path: '/',
    maxAge: 60 * 60 * 12,
  }
}

export function newCsrfToken(): string {
  return generateToken()
}

export type CsrfVerdict = 'ok' | 'missing-cookie' | 'missing-header' | 'mismatch' | 'bad-origin'

export interface CsrfInput {
  readonly method: string
  readonly cookieToken: string | undefined
  readonly headerToken: string | undefined
  readonly origin: string | undefined
  readonly allowedOrigins: readonly string[]
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Validate a state-changing request.
 *
 * Two independent checks, because either alone has a gap: origin headers can be
 * absent on some legitimate clients, and double-submit alone is weakened if an
 * attacker can write cookies via a subdomain. Requiring both closes each other's
 * hole.
 */
export function checkCsrf(input: CsrfInput): CsrfVerdict {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return 'ok'

  // An absent Origin is allowed (non-browser clients omit it); a *wrong* one
  // never is.
  if (input.origin !== undefined && !input.allowedOrigins.includes(input.origin)) {
    return 'bad-origin'
  }

  if (!input.cookieToken) return 'missing-cookie'
  if (!input.headerToken) return 'missing-header'

  return safeEqual(input.cookieToken, input.headerToken) ? 'ok' : 'mismatch'
}

// ---------------------------------------------------------------------------
// Throttling
// ---------------------------------------------------------------------------

export interface AttemptRecord {
  failures: number
  lastAttemptAt: Date
}

/**
 * In-memory attempt tracking.
 *
 * Sufficient for a single-process development stack and honest about it: a
 * multi-instance deployment needs the same database-backed approach used for the
 * geocoder limiter, because a per-process counter lets an attacker multiply
 * their budget by the number of instances. Recorded as a Phase 8 task.
 */
export class ThrottleStore {
  private readonly attempts = new Map<string, AttemptRecord>()

  constructor(private readonly policy?: ThrottlePolicy) {}

  /** Seconds the caller must wait, or 0 if they may proceed. */
  check(key: string, now: Date): number {
    const record = this.attempts.get(key)
    if (!record) return 0

    const wait = retryAfterSeconds(record.failures, this.policy)
    if (wait === 0) return 0

    const elapsed = (now.getTime() - record.lastAttemptAt.getTime()) / 1000
    return elapsed >= wait ? 0 : Math.ceil(wait - elapsed)
  }

  recordFailure(key: string, now: Date): void {
    const record = this.attempts.get(key)
    this.attempts.set(key, {
      failures: (record?.failures ?? 0) + 1,
      lastAttemptAt: now,
    })
  }

  /** Clear on success, so a legitimate user is not punished for earlier typos. */
  clear(key: string): void {
    this.attempts.delete(key)
  }

  /** Drop records that are no longer throttling anything. */
  sweep(now: Date, maxAgeSeconds = 3600): void {
    for (const [key, record] of this.attempts) {
      if ((now.getTime() - record.lastAttemptAt.getTime()) / 1000 > maxAgeSeconds) {
        this.attempts.delete(key)
      }
    }
  }

  get size(): number {
    return this.attempts.size
  }
}

/**
 * Throttle keys.
 *
 * Both are tracked: per-account alone lets one attacker spray many accounts from
 * one host, and per-IP alone lets a distributed attacker grind one account. The
 * email is hashed so the throttle map is not itself a list of registered users.
 */
export function accountKey(email: string): string {
  return `acct:${hashToken(email.trim().toLowerCase())}`
}

export function ipKey(ip: string): string {
  return `ip:${ip}`
}
