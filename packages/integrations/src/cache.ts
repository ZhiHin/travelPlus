/**
 * Provider response cache.
 *
 * Caching is a compliance requirement, not an optimisation. The Nominatim policy
 * states results *must* be cached and warns that clients repeatedly sending the
 * same query may be classified as faulty and blocked. So a cache miss is the
 * only path that spends a rate-limit token.
 *
 * Shared across processes for the same reason the rate limiter is: two containers
 * with separate in-memory caches would each re-ask the provider the same question.
 */

export interface CacheRunner {
  unsafe(query: string, params?: unknown[]): Promise<unknown>
}

export interface CacheEntry<T> {
  readonly value: T
  readonly retrievedAt: Date
}

interface CacheRow {
  response: unknown
  retrieved_at: Date
}

/**
 * Read a cached response, if one is present and unexpired.
 *
 * Expiry is evaluated in SQL rather than in application code so a stale row is
 * never returned by a process whose clock has drifted.
 */
export async function readCache<T>(
  db: CacheRunner,
  provider: string,
  key: string,
  now: Date,
): Promise<CacheEntry<T> | null> {
  const rows = (await db.unsafe(
    `SELECT response, retrieved_at FROM provider_cache_entries
     WHERE provider = $1 AND cache_key = $2 AND expires_at > $3`,
    [provider, key, now],
  )) as CacheRow[]

  const row = rows[0]
  if (!row) return null

  // Best-effort hit counting: a lost increment under concurrency is acceptable,
  // a failed read because of it is not.
  await db
    .unsafe(
      `UPDATE provider_cache_entries SET hit_count = hit_count + 1
       WHERE provider = $1 AND cache_key = $2`,
      [provider, key],
    )
    .catch(() => undefined)

  return { value: row.response as T, retrievedAt: row.retrieved_at }
}

/**
 * Store a response.
 *
 * Upsert rather than insert: a refreshed answer replaces the old one, and two
 * processes racing to cache the same miss both succeed.
 */
export async function writeCache(
  db: CacheRunner,
  provider: string,
  key: string,
  value: unknown,
  ttlSeconds: number,
  now: Date,
  newId: () => string,
): Promise<void> {
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
  await db.unsafe(
    `INSERT INTO provider_cache_entries (id, provider, cache_key, response, retrieved_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider, cache_key) DO UPDATE
       SET response = EXCLUDED.response,
           retrieved_at = EXCLUDED.retrieved_at,
           expires_at = EXCLUDED.expires_at`,
    [newId(), provider, key, JSON.stringify(value), now, expiresAt],
  )
}

/** Delete expired rows. Run on a schedule; retention is a policy obligation. */
export async function sweepCache(db: CacheRunner, now: Date): Promise<void> {
  await db.unsafe(`DELETE FROM provider_cache_entries WHERE expires_at <= $1`, [now])
}

/**
 * TTLs reflecting how fast each provider's data actually changes, not one
 * uniform number. A geocoding result for a street address is stable for months;
 * a weather forecast is worthless within the hour.
 */
export const CACHE_TTL_SECONDS = {
  /** Addresses and place names change rarely, and long caching directly reduces load. */
  geocode: 60 * 60 * 24 * 30,
  reverseGeocode: 60 * 60 * 24 * 30,
  /** Advisory only, and stale weather is worse than no weather. */
  weather: 60 * 60 * 3,
  /** Descriptions and images are effectively static. */
  placeContent: 60 * 60 * 24 * 7,
} as const

/**
 * Build a stable cache key.
 *
 * Sorted parameters, so `?q=x&limit=5` and `?limit=5&q=x` are one entry rather
 * than two — an unstable key silently defeats the cache and, with it, the
 * policy compliance that depends on it.
 */
export function cacheKey(parts: Record<string, string | number | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v).trim().toLowerCase()}`)
    .join('&')
}
