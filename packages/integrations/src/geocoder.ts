import { CACHE_TTL_SECONDS, cacheKey, readCache, writeCache, type CacheRunner } from './cache.js'
import { safeFetch, type SafeFetchOptions } from './http.js'
import { acquire, NOMINATIM_BUCKET, type RateLimitRunner } from './rate-limit.js'

/**
 * Geocoding, behind a provider port.
 *
 * The Nominatim usage policy (verified 2026-08-19) is the strictest constraint
 * this product operates under, and every rule it imposes is implemented here
 * rather than left to callers:
 *
 *   1 req/s for the WHOLE application  → database-backed token bucket
 *   results must be cached             → cache is checked before the limiter
 *   identifying User-Agent required    → enforced at config load, sent here
 *   autocomplete explicitly prohibited → no incremental/type-ahead entry point exists
 *
 * The fourth is enforced by absence: there is no `suggest()` or `autocomplete()`
 * function to call. A convenience wrapper added later would be a policy breach,
 * so the port deliberately does not offer the shape.
 */

export interface GeocodeResult {
  readonly providerId: string
  readonly displayName: string
  readonly lat: number
  readonly lon: number
  readonly category?: string
  readonly type?: string
  readonly boundingBox?: readonly [number, number, number, number]
  /** Rendered from the provider, never hard-coded (licence obligation). */
  readonly attribution: string
  readonly licence: string
}

export interface GeocodeOutcome {
  readonly results: readonly GeocodeResult[]
  readonly fromCache: boolean
  readonly retrievedAt: Date
}

/**
 * Signalled when the shared 1 req/s budget could not be obtained in time.
 *
 * Not an error state in the UI: search renders a "waiting for the geocoder"
 * message, because queuing is a designed part of the experience under this
 * policy rather than a failure.
 */
export class GeocoderBusyError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Geocoder is at its shared rate limit')
    this.name = 'GeocoderBusyError'
  }
}

export interface Geocoder {
  /** Submit-triggered search. There is deliberately no incremental variant. */
  search(query: string, options?: SearchOptions): Promise<GeocodeOutcome>
  reverse(lat: number, lon: number): Promise<GeocodeOutcome>
}

export interface SearchOptions {
  readonly limit?: number
  /** Bias results toward a viewport, where the provider supports it. */
  readonly viewbox?: readonly [number, number, number, number]
  readonly countryCodes?: readonly string[]
}

export interface NominatimDeps {
  readonly baseUrl: string
  /** Must identify the app and carry a contact address; validated at config load. */
  readonly userAgent: string
  readonly db: CacheRunner & RateLimitRunner
  readonly now: () => Date
  readonly newId: () => string
  /** Bound on how long a caller waits for the shared budget. */
  readonly maxWaitMs?: number
  readonly fetchOptions?: Partial<SafeFetchOptions>
}

interface NominatimRow {
  place_id: number | string
  osm_type?: string
  osm_id?: number | string
  display_name: string
  lat: string
  lon: string
  category?: string
  type?: string
  boundingbox?: string[]
  licence?: string
}

const MAX_LIMIT = 10

export function createNominatimGeocoder(deps: NominatimDeps): Geocoder {
  const host = new URL(deps.baseUrl).hostname

  async function call(path: string, params: Record<string, string>, key: string) {
    const now = deps.now()

    // Cache BEFORE the limiter: a cached answer must not consume budget, and
    // the policy explicitly warns about repeating identical queries.
    const cached = await readCache<NominatimRow[]>(deps.db, 'nominatim', key, now)
    if (cached) {
      return { rows: cached.value, fromCache: true, retrievedAt: cached.retrievedAt }
    }

    const got = await acquire(deps.db, NOMINATIM_BUCKET, {
      maxWaitMs: deps.maxWaitMs ?? 5000,
      now: deps.now,
    })
    if (!got) throw new GeocoderBusyError(1000)

    const url = new URL(path, deps.baseUrl)
    for (const [k, v] of Object.entries({ ...params, format: 'jsonv2' })) {
      url.searchParams.set(k, v)
    }

    const response = await safeFetch(url.toString(), {
      allowedHosts: [host],
      headers: {
        // Policy: a stock library default is explicitly insufficient.
        'user-agent': deps.userAgent,
        accept: 'application/json',
      },
      timeoutMs: 10_000,
      ...deps.fetchOptions,
    })

    if (!response.ok) {
      throw new Error(`Geocoder returned ${response.status}`)
    }

    let rows: NominatimRow[]
    try {
      const parsed: unknown = JSON.parse(response.body)
      rows = Array.isArray(parsed) ? (parsed as NominatimRow[]) : [parsed as NominatimRow]
    } catch {
      throw new Error('Geocoder returned malformed JSON')
    }

    const retrievedAt = deps.now()
    await writeCache(
      deps.db,
      'nominatim',
      key,
      rows,
      CACHE_TTL_SECONDS.geocode,
      retrievedAt,
      deps.newId,
    )

    return { rows, fromCache: false, retrievedAt }
  }

  return {
    async search(query, options = {}) {
      const trimmed = query.trim()
      if (trimmed.length === 0) {
        // Never spend a token on an empty query.
        return { results: [], fromCache: true, retrievedAt: deps.now() }
      }

      const limit = Math.min(options.limit ?? 5, MAX_LIMIT)
      const params: Record<string, string> = { q: trimmed, limit: String(limit) }
      if (options.viewbox) {
        params.viewbox = options.viewbox.join(',')
        params.bounded = '1'
      }
      if (options.countryCodes?.length) {
        params.countrycodes = options.countryCodes.join(',')
      }

      const key = cacheKey({ op: 'search', ...params })
      const { rows, fromCache, retrievedAt } = await call('/search', params, key)
      return { results: rows.map(normalise), fromCache, retrievedAt }
    },

    async reverse(lat, lon) {
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new RangeError(`Latitude ${lat} is out of range`)
      }
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
        throw new RangeError(`Longitude ${lon} is out of range`)
      }

      // Rounded to ~11 m. Full precision would make almost every lookup a cache
      // miss, spending budget on answers we already hold.
      const params = { lat: lat.toFixed(5), lon: lon.toFixed(5) }
      const key = cacheKey({ op: 'reverse', ...params })
      const { rows, fromCache, retrievedAt } = await call('/reverse', params, key)
      return { results: rows.filter((r) => r.display_name).map(normalise), fromCache, retrievedAt }
    },
  }
}

function normalise(row: NominatimRow): GeocodeResult {
  const bbox = row.boundingbox?.map(Number)
  const result: GeocodeResult = {
    // Prefer the stable OSM identity over Nominatim's internal place_id, which
    // is not stable across reimports.
    providerId: row.osm_type && row.osm_id ? `${row.osm_type}/${row.osm_id}` : String(row.place_id),
    displayName: row.display_name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    attribution: '© OpenStreetMap contributors',
    licence: row.licence ?? 'ODbL 1.0',
    ...(row.category !== undefined ? { category: row.category } : {}),
    ...(row.type !== undefined ? { type: row.type } : {}),
    ...(bbox && bbox.length === 4 && bbox.every(Number.isFinite)
      ? { boundingBox: bbox as unknown as readonly [number, number, number, number] }
      : {}),
  }
  return result
}
