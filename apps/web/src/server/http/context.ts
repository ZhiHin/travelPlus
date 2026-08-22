import { loadEnv } from '@travelplus/config'
import { NextResponse } from 'next/server'
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, checkCsrf } from '../auth/http.js'
import { resolveSession, type AuthDeps } from '../auth/service.js'

/**
 * The request pipeline every route handler runs through.
 *
 * Order matters and is the same on every route (roles doc §4):
 *
 *   resolve session   → 401 if absent or expired
 *   check CSRF        → 403 on any state-changing request that fails
 *   run the service   → which opens a transaction with the RLS actor set
 *
 * Handlers stay thin: parse, authorise, call one service, map the result.
 * Putting this in one place means a new route cannot forget CSRF by omission.
 */

export interface RequestActor {
  readonly userId: string
  readonly sessionId: string
}

export type Guarded =
  | { readonly ok: true; readonly actor: RequestActor }
  | { readonly ok: false; readonly response: NextResponse }

export function authDeps(): AuthDeps {
  const env = loadEnv()
  return {
    now: () => new Date(),
    secret: env.AUTH_SECRET,
    // Delivery lands with the notification worker in a later phase. Failing
    // loudly here beats silently pretending a message was sent.
    sendEmail: async () => {
      throw new Error('Email delivery is not configured yet')
    },
  }
}

/**
 * Resolve the actor and validate CSRF.
 *
 * A missing session is 401 — distinct from 403, because the client should
 * prompt a sign-in rather than tell the user they lack permission.
 */
export async function guard(request: Request): Promise<Guarded> {
  const cookies = parseCookies(request.headers.get('cookie'))

  const actor = await resolveSession(authDeps(), cookies[SESSION_COOKIE])
  if (!actor) {
    return {
      ok: false,
      response: problem(401, 'UNAUTHENTICATED', 'Sign in to continue.'),
    }
  }

  const env = loadEnv()
  const verdict = checkCsrf({
    method: request.method,
    cookieToken: cookies[CSRF_COOKIE],
    headerToken: request.headers.get(CSRF_HEADER) ?? undefined,
    origin: request.headers.get('origin') ?? undefined,
    allowedOrigins: [env.APP_URL],
  })

  if (verdict !== 'ok') {
    return {
      ok: false,
      // The verdict is logged, not returned: telling a caller exactly which
      // check failed helps an attacker tune, and helps a legitimate client not
      // at all.
      response: problem(
        403,
        'CSRF_FAILED',
        'Your request could not be verified. Reload and retry.',
      ),
    }
  }

  return { ok: true, actor: { userId: actor.userId, sessionId: actor.sessionId } }
}

/**
 * The error envelope from the API contract.
 *
 * `code` is stable and machine-readable; `message` is safe to display. No stack
 * traces, no provider payloads, no internals — a correlation id is the only
 * thing that links a user's report to a server log.
 */
export function problem(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  const correlationId = crypto.randomUUID()
  return NextResponse.json(
    { error: { code, message, correlationId, ...(details ? { details } : {}) } },
    { status, headers: { 'x-correlation-id': correlationId } },
  )
}

/** Map a trip-service error to its documented HTTP shape. */
export function mapTripError(error: {
  kind: string
  required?: string
  currentVersion?: number
  problems?: readonly string[]
}): NextResponse {
  switch (error.kind) {
    case 'not-found':
      // Deliberately identical to a trip that never existed. Distinguishing
      // them lets an attacker enumerate trips by id (roles doc R4).
      return problem(404, 'NOT_FOUND', "We couldn't find that.")
    case 'forbidden':
      return problem(
        403,
        'INSUFFICIENT_ROLE',
        'You have view-only access to this trip.',
        error.required ? { required: error.required } : undefined,
      )
    case 'conflict':
      return problem(
        409,
        'VERSION_CONFLICT',
        'Someone else changed this trip. Review the differences.',
        { currentVersion: error.currentVersion },
      )
    case 'invalid':
      return problem(400, 'VALIDATION_FAILED', 'Some fields need attention.', {
        problems: error.problems,
      })
    default:
      return problem(500, 'INTERNAL_ERROR', 'Something went wrong on our side.')
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}
