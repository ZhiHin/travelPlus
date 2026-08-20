import { describe, expect, it, vi } from 'vitest'
import { createNominatimGeocoder, GeocoderBusyError, type Geocoder } from './geocoder.js'

/**
 * Policy compliance, asserted.
 *
 * Every test here maps to a rule in the Nominatim usage policy verified on
 * 2026-08-19. Breaching any of them risks an IP block, which takes search down
 * for every user (RISKS.md R-03) — so these are not style checks.
 */

const NOMINATIM_ROW = {
  place_id: 12345,
  osm_type: 'node',
  osm_id: 987,
  display_name: 'Pasar Seni, Kuala Lumpur, Malaysia',
  lat: '3.1427',
  lon: '101.6958',
  category: 'railway',
  type: 'station',
  boundingbox: ['3.1420', '3.1435', '101.6950', '101.6965'],
  licence: 'Data © OpenStreetMap contributors, ODbL 1.0',
}

/** Records what actually reached the database and the network. */
function harness(options: { cacheHit?: boolean; tokensAvailable?: boolean } = {}) {
  const queries: string[] = []
  const fetches: string[] = []

  const db = {
    unsafe: vi.fn(async (query: string, _params?: unknown[]) => {
      queries.push(query.trim().split('\n')[0]!.trim())

      if (query.includes('SELECT response')) {
        return options.cacheHit
          ? [{ response: [NOMINATIM_ROW], retrieved_at: new Date('2026-08-20T09:00:00Z') }]
          : []
      }
      if (query.includes('FOR UPDATE')) {
        return [
          {
            tokens: options.tokensAvailable === false ? 0 : 1,
            refill_per_sec: 1,
            max_tokens: 1,
            last_refill_at: new Date('2026-08-20T10:00:00Z'),
          },
        ]
      }
      return []
    }),
    begin: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
  }

  const fetchImpl = vi.fn(async (url: string) => {
    fetches.push(url)
    return new Response(JSON.stringify([NOMINATIM_ROW]), { status: 200 })
  }) as unknown as typeof fetch

  // An advancing clock, so a caller that waits for budget actually reaches its
  // deadline rather than depending on the attempt cap to bail it out.
  let clockMs = new Date('2026-08-20T10:00:00Z').getTime()
  const now = () => {
    clockMs += 1
    return new Date(clockMs)
  }

  const geocoder: Geocoder = createNominatimGeocoder({
    baseUrl: 'https://nominatim.openstreetmap.org',
    userAgent: 'TravelPlus/0.1 (contact: dev@travelplus.example)',
    db: db as never,
    now,
    newId: () => '0192f3a0-8c1e-7000-8000-000000000001',
    maxWaitMs: 20,
    fetchOptions: {
      fetchImpl,
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    },
  })

  return { geocoder, queries, fetches, fetchImpl, db }
}

describe('policy: the port offers no autocomplete', () => {
  // The policy states plainly: "you must not implement such a service on the
  // client side using the API". Enforced by absence — there is no method to
  // call, so a convenience wrapper cannot be added without a visible change.
  it('exposes only search and reverse', () => {
    const { geocoder } = harness()
    expect(Object.keys(geocoder).sort()).toEqual(['reverse', 'search'])
  })

  it('has no suggest, autocomplete or typeahead entry point', () => {
    const { geocoder } = harness()
    for (const forbidden of ['suggest', 'autocomplete', 'typeahead', 'complete']) {
      expect(geocoder).not.toHaveProperty(forbidden)
    }
  })
})

describe('policy: results must be cached', () => {
  it('serves a cache hit without touching the network', async () => {
    const { geocoder, fetchImpl } = harness({ cacheHit: true })
    const outcome = await geocoder.search('pasar seni')

    expect(outcome.fromCache).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(outcome.results).toHaveLength(1)
  })

  // The policy warns that clients repeatedly sending the same query may be
  // classified as faulty and blocked, so a cached answer must not spend budget.
  it('does not consume a rate-limit token on a cache hit', async () => {
    const { geocoder, queries } = harness({ cacheHit: true })
    await geocoder.search('pasar seni')
    expect(queries.some((q) => q.includes('FOR UPDATE'))).toBe(false)
  })

  it('checks the cache before the limiter on a miss', async () => {
    const { geocoder, queries } = harness({ cacheHit: false })
    await geocoder.search('pasar seni')

    const cacheAt = queries.findIndex((q) => q.includes('SELECT response'))
    const limiterAt = queries.findIndex((q) => q.includes('INSERT INTO provider_rate_limit_state'))
    expect(cacheAt).toBeGreaterThanOrEqual(0)
    expect(cacheAt).toBeLessThan(limiterAt)
  })

  it('writes the response to the cache after a miss', async () => {
    const { geocoder, queries } = harness({ cacheHit: false })
    await geocoder.search('pasar seni')
    expect(queries.some((q) => q.includes('INSERT INTO provider_cache_entries'))).toBe(true)
  })

  it('never spends a token on an empty query', async () => {
    const { geocoder, queries, fetchImpl } = harness()
    const outcome = await geocoder.search('   ')
    expect(outcome.results).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(queries).toHaveLength(0)
  })
})

describe('policy: identifying User-Agent', () => {
  it('sends the configured contact-bearing user agent', async () => {
    const { geocoder, fetchImpl } = harness()
    await geocoder.search('pasar seni')

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit
    const ua = (init.headers as Record<string, string>)['user-agent']
    expect(ua).toContain('TravelPlus')
    expect(ua).toMatch(/@|https?:\/\//) // carries a contact
  })
})

describe('rate limiting', () => {
  it('raises GeocoderBusyError rather than exceeding the shared budget', async () => {
    const { geocoder, fetchImpl } = harness({ tokensAvailable: false })
    await expect(geocoder.search('pasar seni')).rejects.toThrow(GeocoderBusyError)
    // The point: no request went out.
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('result normalisation', () => {
  it('prefers the stable OSM identity over the internal place_id', async () => {
    const { geocoder } = harness()
    const { results } = await geocoder.search('pasar seni')
    // place_id is not stable across Nominatim reimports; osm_type/osm_id is.
    expect(results[0]!.providerId).toBe('node/987')
  })

  it('carries attribution and licence from the response', async () => {
    const { geocoder } = harness()
    const { results } = await geocoder.search('pasar seni')
    expect(results[0]!.attribution).toBe('© OpenStreetMap contributors')
    expect(results[0]!.licence).toContain('ODbL')
  })

  it('parses coordinates as numbers', async () => {
    const { geocoder } = harness()
    const { results } = await geocoder.search('pasar seni')
    expect(results[0]!.lat).toBeCloseTo(3.1427, 4)
    expect(results[0]!.lon).toBeCloseTo(101.6958, 4)
  })

  it('caps the requested limit', async () => {
    const { geocoder, fetchImpl } = harness()
    await geocoder.search('kuala lumpur', { limit: 500 })
    const url = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(new URL(url).searchParams.get('limit')).toBe('10')
  })
})

describe('reverse geocoding', () => {
  it('rejects out-of-range coordinates before spending anything', async () => {
    const { geocoder, queries } = harness()
    await expect(geocoder.reverse(91, 0)).rejects.toThrow(RangeError)
    await expect(geocoder.reverse(0, 181)).rejects.toThrow(RangeError)
    expect(queries).toHaveLength(0)
  })

  // Full float precision would make nearly every lookup a cache miss, spending
  // budget re-asking for answers already held.
  it('rounds coordinates so nearby lookups share a cache entry', async () => {
    const { geocoder, fetchImpl } = harness()
    await geocoder.reverse(3.14271234, 101.69581234)
    const url = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
    expect(new URL(url).searchParams.get('lat')).toBe('3.14271')
  })
})

describe('failure handling', () => {
  it('rejects a non-200 response', async () => {
    const { db } = harness()
    const failing = createNominatimGeocoder({
      baseUrl: 'https://nominatim.openstreetmap.org',
      userAgent: 'TravelPlus/0.1 (contact: dev@travelplus.example)',
      db: db as never,
      now: () => new Date('2026-08-20T10:00:00Z'),
      newId: () => 'id',
      fetchOptions: {
        fetchImpl: (async () => new Response('rate limited', { status: 429 })) as typeof fetch,
        resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      },
    })
    await expect(failing.search('x')).rejects.toThrow(/returned 429/)
  })

  it('rejects malformed JSON rather than returning junk', async () => {
    const { db } = harness()
    const broken = createNominatimGeocoder({
      baseUrl: 'https://nominatim.openstreetmap.org',
      userAgent: 'TravelPlus/0.1 (contact: dev@travelplus.example)',
      db: db as never,
      now: () => new Date('2026-08-20T10:00:00Z'),
      newId: () => 'id',
      fetchOptions: {
        fetchImpl: (async () =>
          new Response('<html>error</html>', { status: 200 })) as typeof fetch,
        resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      },
    })
    await expect(broken.search('x')).rejects.toThrow(/malformed JSON/)
  })
})
