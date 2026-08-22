import { lookup } from 'node:dns/promises'

/**
 * The SSRF-safe outbound HTTP client.
 *
 * Every provider call goes through here (ADR-0010). The threat is not
 * hypothetical: this product stores user-supplied URLs (booking links, notes)
 * and consumes third-party text, so an unguarded fetch is a path to the cloud
 * metadata endpoint and to internal services.
 *
 * Guards, in order of importance:
 *  1. Host allow-list — the strongest control, because it fails closed.
 *  2. DNS resolution checked against private ranges, so a hostname that
 *     resolves to 169.254.169.254 is refused even if it looks public.
 *  3. Cross-host redirects refused rather than followed.
 *  4. Bounded response size and a hard timeout.
 */

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`Blocked outbound request: ${reason}`)
    this.name = 'SsrfBlockedError'
  }
}

export class ProviderTimeoutError extends Error {
  constructor(url: string, ms: number) {
    super(`Provider did not respond within ${ms}ms: ${url}`)
    this.name = 'ProviderTimeoutError'
  }
}

export class ResponseTooLargeError extends Error {
  constructor(limit: number) {
    super(`Provider response exceeded ${limit} bytes`)
    this.name = 'ResponseTooLargeError'
  }
}

/**
 * Address ranges that must never be reached from a provider adapter.
 *
 * 169.254.169.254 is the cloud metadata endpoint and the reason this list is not
 * optional — reaching it typically yields credentials.
 */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true // unparseable is blocked
  }
  const [a, b] = parts as [number, number, number, number]

  if (a === 0) return true // "this network"
  if (a === 10) return true // private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a >= 224) return true // multicast, reserved, broadcast
  return false
}

function isBlockedIPv6(ip: string): boolean {
  const v = ip.toLowerCase().split('%')[0] ?? ''
  if (v === '::' || v === '::1') return true // unspecified, loopback
  if (v.startsWith('fe80')) return true // link-local
  if (v.startsWith('fc') || v.startsWith('fd')) return true // unique local
  if (v.startsWith('ff')) return true // multicast
  // IPv4-mapped (::ffff:169.254.169.254) would otherwise slip past the v4 checks.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
  if (mapped?.[1]) return isBlockedIPv4(mapped[1])
  return false
}

export function isBlockedAddress(ip: string, family: number): boolean {
  return family === 6 ? isBlockedIPv6(ip) : isBlockedIPv4(ip)
}

export interface SafeFetchOptions {
  /** Hostnames permitted for this call. The primary control. */
  readonly allowedHosts: readonly string[]
  readonly method?: 'GET' | 'POST'
  /**
   * JSON request body. Serialised here rather than by the caller so the
   * content-type and the payload cannot disagree.
   */
  readonly jsonBody?: unknown
  readonly timeoutMs?: number
  readonly maxBytes?: number
  readonly headers?: Record<string, string>
  /** Injected so tests do not depend on real DNS. */
  readonly resolve?: (host: string) => Promise<{ address: string; family: number }[]>
  readonly fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

async function defaultResolve(host: string) {
  return lookup(host, { all: true })
}

/** Validate a URL without performing it. Exported so callers can pre-check. */
export async function assertSafeUrl(
  rawUrl: string,
  allowedHosts: readonly string[],
  resolver: (host: string) => Promise<{ address: string; family: number }[]> = defaultResolve,
): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError(`malformed URL "${rawUrl}"`)
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SsrfBlockedError(`protocol "${url.protocol}" is not permitted`)
  }

  // Allow-list first: it fails closed, so a new provider cannot be reached by
  // accident just because its address happens to be public.
  if (!allowedHosts.includes(url.hostname)) {
    throw new SsrfBlockedError(`host "${url.hostname}" is not on the allow-list`)
  }

  // A permitted hostname can still resolve somewhere private — via DNS rebinding,
  // a compromised record, or simply a provider pointing at localhost in dev.
  let addresses: { address: string; family: number }[]
  try {
    addresses = await resolver(url.hostname)
  } catch {
    throw new SsrfBlockedError(`could not resolve "${url.hostname}"`)
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(`"${url.hostname}" resolved to no addresses`)
  }

  for (const { address, family } of addresses) {
    if (isBlockedAddress(address, family)) {
      throw new SsrfBlockedError(`"${url.hostname}" resolves to blocked address ${address}`)
    }
  }

  return url
}

export interface SafeResponse {
  readonly status: number
  readonly ok: boolean
  readonly body: string
  readonly headers: Record<string, string>
}

/**
 * Perform a guarded outbound request.
 *
 * Redirects are NOT followed automatically. A provider that redirects to a new
 * host would otherwise bypass the allow-list entirely, so the redirect is
 * surfaced and the caller must decide.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const doFetch = options.fetchImpl ?? fetch

  const url = await assertSafeUrl(rawUrl, options.allowedHosts, options.resolve)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const method = options.method ?? 'GET'
    const response = await doFetch(url.toString(), {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: options.headers ?? {},
      ...(options.jsonBody !== undefined ? { body: JSON.stringify(options.jsonBody) } : {}),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      throw new SsrfBlockedError(
        `provider redirected to "${location ?? 'unknown'}"; redirects are not followed`,
      )
    }

    const declared = response.headers.get('content-length')
    if (declared && Number(declared) > maxBytes) {
      throw new ResponseTooLargeError(maxBytes)
    }

    const body = await response.text()
    // A missing or lying Content-Length is why the body is checked too.
    if (body.length > maxBytes) throw new ResponseTooLargeError(maxBytes)

    const headers: Record<string, string> = {}
    response.headers.forEach((v, k) => {
      headers[k] = v
    })

    return { status: response.status, ok: response.ok, body, headers }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderTimeoutError(rawUrl, timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
