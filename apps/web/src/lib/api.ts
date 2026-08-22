/**
 * The browser's one way of talking to `/api/v1`.
 *
 * Every state-changing call carries the CSRF token from the double-submit
 * cookie; putting that in one function means a new screen cannot forget it.
 * Errors come back as the contract's envelope, never as a thrown string, so a
 * screen can show `message` and branch on `code` without parsing.
 */

export interface ApiProblem {
  readonly code: string
  readonly message: string
  readonly correlationId?: string
  readonly details?: Record<string, unknown>
}

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly error: ApiProblem }

const CSRF_COOKIE = 'tp_csrf'
const CSRF_HEADER = 'x-csrf-token'

function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined
  for (const part of document.cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === CSRF_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET') {
    const token = csrfToken()
    if (token) headers[CSRF_HEADER] = token
  }

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'NETWORK', message: "We couldn't reach the server. Check your connection." },
    }
  }

  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!response.ok) {
    const envelope = (json as { error?: ApiProblem } | null)?.error
    return {
      ok: false,
      status: response.status,
      error: envelope ?? { code: 'UNKNOWN', message: 'Something went wrong on our side.' },
    }
  }
  return { ok: true, value: json as T }
}
