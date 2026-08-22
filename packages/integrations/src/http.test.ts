import { describe, expect, it, vi } from 'vitest'
import {
  ProviderTimeoutError,
  ResponseTooLargeError,
  SsrfBlockedError,
  assertSafeUrl,
  isBlockedAddress,
  safeFetch,
} from './http.js'

const ALLOWED = ['nominatim.openstreetmap.org', 'api.open-meteo.com']
const publicIp = async () => [{ address: '93.184.216.34', family: 4 }]

describe('blocked address ranges', () => {
  const blocked: Array<[string, number, string]> = [
    ['127.0.0.1', 4, 'loopback'],
    ['10.0.0.5', 4, 'private class A'],
    ['172.16.0.1', 4, 'private class B'],
    ['172.31.255.254', 4, 'private class B upper bound'],
    ['192.168.1.1', 4, 'private class C'],
    ['169.254.169.254', 4, 'cloud metadata endpoint'],
    ['0.0.0.0', 4, 'this network'],
    ['100.64.0.1', 4, 'carrier-grade NAT'],
    ['224.0.0.1', 4, 'multicast'],
    ['255.255.255.255', 4, 'broadcast'],
    ['::1', 6, 'IPv6 loopback'],
    ['fe80::1', 6, 'IPv6 link-local'],
    ['fd00::1', 6, 'IPv6 unique local'],
    ['::ffff:169.254.169.254', 6, 'IPv4-mapped metadata endpoint'],
    ['::ffff:127.0.0.1', 6, 'IPv4-mapped loopback'],
  ]

  for (const [ip, family, label] of blocked) {
    it(`blocks ${ip} (${label})`, () => {
      expect(isBlockedAddress(ip, family)).toBe(true)
    })
  }

  it('allows ordinary public addresses', () => {
    expect(isBlockedAddress('93.184.216.34', 4)).toBe(false)
    expect(isBlockedAddress('8.8.8.8', 4)).toBe(false)
    expect(isBlockedAddress('2606:2800:220:1::1', 6)).toBe(false)
  })

  it('blocks 172.15 and 172.32 correctly (boundary check)', () => {
    // 172.16-172.31 is private; the neighbours are not.
    expect(isBlockedAddress('172.15.0.1', 4)).toBe(false)
    expect(isBlockedAddress('172.32.0.1', 4)).toBe(false)
  })

  it('blocks anything unparseable rather than guessing', () => {
    expect(isBlockedAddress('not-an-ip', 4)).toBe(true)
    expect(isBlockedAddress('1.2.3', 4)).toBe(true)
    expect(isBlockedAddress('999.1.1.1', 4)).toBe(true)
  })
})

describe('assertSafeUrl', () => {
  it('accepts an allow-listed host resolving publicly', async () => {
    const url = await assertSafeUrl(
      'https://nominatim.openstreetmap.org/search?q=x',
      ALLOWED,
      publicIp,
    )
    expect(url.hostname).toBe('nominatim.openstreetmap.org')
  })

  // The allow-list is the primary control because it fails closed: a new
  // provider cannot be reached by accident merely for being public.
  it('refuses a host that is not allow-listed, even a public one', async () => {
    await expect(assertSafeUrl('https://example.com/', ALLOWED, publicIp)).rejects.toThrow(
      /not on the allow-list/,
    )
  })

  // An allow-listed hostname can still resolve somewhere private — DNS
  // rebinding, a compromised record, or a dev config pointing at localhost.
  it('refuses an allow-listed host that resolves to a private address', async () => {
    const rebind = async () => [{ address: '169.254.169.254', family: 4 }]
    await expect(
      assertSafeUrl('https://nominatim.openstreetmap.org/', ALLOWED, rebind),
    ).rejects.toThrow(/blocked address 169\.254\.169\.254/)
  })

  it('refuses when ANY resolved address is private, not just the first', async () => {
    const mixed = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]
    await expect(assertSafeUrl('https://api.open-meteo.com/', ALLOWED, mixed)).rejects.toThrow(
      SsrfBlockedError,
    )
  })

  it('refuses non-http protocols', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://x/', 'gopher://x/']) {
      await expect(assertSafeUrl(url, ALLOWED, publicIp)).rejects.toThrow(
        /not permitted|allow-list/,
      )
    }
  })

  it('refuses a malformed URL', async () => {
    await expect(assertSafeUrl('http://', ALLOWED, publicIp)).rejects.toThrow(SsrfBlockedError)
  })

  it('refuses a host resolving to nothing', async () => {
    await expect(
      assertSafeUrl('https://api.open-meteo.com/', ALLOWED, async () => []),
    ).rejects.toThrow(/no addresses/)
  })

  it('refuses when resolution fails', async () => {
    const boom = async () => {
      throw new Error('ENOTFOUND')
    }
    await expect(assertSafeUrl('https://api.open-meteo.com/', ALLOWED, boom)).rejects.toThrow(
      /could not resolve/,
    )
  })
})

describe('safeFetch', () => {
  const ok = (body: string, headers: Record<string, string> = {}) =>
    vi.fn(async () => new Response(body, { status: 200, headers })) as unknown as typeof fetch

  it('returns the body on success', async () => {
    const res = await safeFetch('https://api.open-meteo.com/v1/forecast', {
      allowedHosts: ALLOWED,
      resolve: publicIp,
      fetchImpl: ok('{"ok":true}'),
    })
    expect(res.ok).toBe(true)
    expect(res.body).toBe('{"ok":true}')
  })

  // A provider redirecting to a new host would otherwise bypass the allow-list
  // entirely, so the redirect is surfaced rather than followed.
  it('refuses to follow a redirect', async () => {
    const redirect = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }),
    ) as unknown as typeof fetch

    await expect(
      safeFetch('https://api.open-meteo.com/', {
        allowedHosts: ALLOWED,
        resolve: publicIp,
        fetchImpl: redirect,
      }),
    ).rejects.toThrow(/redirects are not followed/)
  })

  it('rejects an over-large declared Content-Length', async () => {
    await expect(
      safeFetch('https://api.open-meteo.com/', {
        allowedHosts: ALLOWED,
        resolve: publicIp,
        maxBytes: 100,
        fetchImpl: ok('x', { 'content-length': '999999' }),
      }),
    ).rejects.toThrow(ResponseTooLargeError)
  })

  // A missing or dishonest Content-Length is why the body length is checked too.
  it('rejects an over-large body even when Content-Length lied', async () => {
    await expect(
      safeFetch('https://api.open-meteo.com/', {
        allowedHosts: ALLOWED,
        resolve: publicIp,
        maxBytes: 10,
        fetchImpl: ok('x'.repeat(500)),
      }),
    ).rejects.toThrow(ResponseTooLargeError)
  })

  it('times out a slow provider', async () => {
    const slow = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            reject(e)
          })
        }),
    ) as unknown as typeof fetch

    await expect(
      safeFetch('https://api.open-meteo.com/', {
        allowedHosts: ALLOWED,
        resolve: publicIp,
        timeoutMs: 30,
        fetchImpl: slow,
      }),
    ).rejects.toThrow(ProviderTimeoutError)
  })

  it('passes identifying headers through', async () => {
    const spy = ok('{}')
    await safeFetch('https://nominatim.openstreetmap.org/search', {
      allowedHosts: ALLOWED,
      resolve: publicIp,
      fetchImpl: spy,
      headers: { 'user-agent': 'TravelPlus/0.1 (contact: dev@example.com)' },
    })
    const init = (spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>)['user-agent']).toContain('TravelPlus')
  })

  it('never reaches the network when the host is not allow-listed', async () => {
    const spy = ok('{}')
    await expect(
      safeFetch('https://evil.test/', { allowedHosts: ALLOWED, resolve: publicIp, fetchImpl: spy }),
    ).rejects.toThrow(SsrfBlockedError)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('allowPrivateAddresses — first-party services only', () => {
  const loopback = async () => [{ address: '127.0.0.1', family: 4 }]

  it('is off by default: loopback is blocked', async () => {
    await expect(assertSafeUrl('http://otp.internal/', ['otp.internal'], loopback)).rejects.toThrow(
      SsrfBlockedError,
    )
  })

  it('permits loopback when explicitly opted in', async () => {
    const url = await assertSafeUrl('http://otp.internal/', ['otp.internal'], loopback, true)
    expect(url.hostname).toBe('otp.internal')
  })

  // The opt-in relaxes the address check, never the allow-list.
  it('still refuses a host that is not allow-listed', async () => {
    await expect(
      assertSafeUrl('http://evil.internal/', ['otp.internal'], loopback, true),
    ).rejects.toThrow(SsrfBlockedError)
  })
})
