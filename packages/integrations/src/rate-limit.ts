/**
 * Cross-process rate limiting.
 *
 * The Nominatim usage policy caps the WHOLE APPLICATION at one request per
 * second — not one per process, not one per user. A per-process token bucket
 * therefore breaches the policy the moment a second container starts, and the
 * consequence is being IP-blocked, which takes search down for everyone
 * (ADR-0011, RISKS.md R-03).
 *
 * So the budget lives in a single database row per provider, and every caller
 * competes for it under `SELECT ... FOR UPDATE`. That is slower than an
 * in-memory counter, and it is the only version that is actually correct.
 */

export interface RateLimitRunner {
  begin<T>(fn: (tx: RateLimitTx) => Promise<T>): Promise<T>
}

export interface RateLimitTx {
  unsafe(query: string, params?: unknown[]): Promise<unknown>
}

export interface BucketConfig {
  readonly provider: string
  /** Sustained rate. Nominatim's policy maximum is 1. */
  readonly refillPerSecond: number
  /** Burst allowance. Keep at 1 for a provider that means "no more than 1/s". */
  readonly maxTokens: number
}

export type Acquisition =
  | { readonly kind: 'acquired' }
  /** No budget now; retry after this long. */
  | { readonly kind: 'wait'; readonly retryAfterMs: number }

interface StateRow {
  tokens: string | number
  refill_per_sec: string | number
  max_tokens: string | number
  last_refill_at: Date
}

/**
 * Try to take one token.
 *
 * The read, the refill computation and the write all happen inside one
 * transaction holding a row lock, so two processes cannot both observe the same
 * token and both spend it.
 */
export async function tryAcquire(
  db: RateLimitRunner,
  config: BucketConfig,
  now: Date,
): Promise<Acquisition> {
  return db.begin(async (tx) => {
    // Create the row on first use. ON CONFLICT DO NOTHING keeps this safe when
    // several processes start simultaneously.
    await tx.unsafe(
      `INSERT INTO provider_rate_limit_state (provider, tokens, max_tokens, refill_per_sec, last_refill_at)
       VALUES ($1, $2, $2, $3, $4)
       ON CONFLICT (provider) DO NOTHING`,
      [config.provider, config.maxTokens, config.refillPerSecond, now],
    )

    // FOR UPDATE is what serialises competing callers. Without it this is just
    // a slower in-memory limiter with extra steps.
    const rows = (await tx.unsafe(
      `SELECT tokens, refill_per_sec, max_tokens, last_refill_at
       FROM provider_rate_limit_state WHERE provider = $1 FOR UPDATE`,
      [config.provider],
    )) as StateRow[]

    const row = rows[0]
    if (!row) return { kind: 'wait', retryAfterMs: 1000 }

    const elapsedSeconds = Math.max(0, (now.getTime() - row.last_refill_at.getTime()) / 1000)
    const refillRate = Number(row.refill_per_sec)
    const maxTokens = Number(row.max_tokens)

    const replenished = Math.min(maxTokens, Number(row.tokens) + elapsedSeconds * refillRate)

    if (replenished >= 1) {
      await tx.unsafe(
        `UPDATE provider_rate_limit_state SET tokens = $2, last_refill_at = $3 WHERE provider = $1`,
        [config.provider, replenished - 1, now],
      )
      return { kind: 'acquired' }
    }

    // Persist the refill even when refusing, so the clock does not restart on
    // every rejected attempt and starve a waiting caller indefinitely.
    await tx.unsafe(
      `UPDATE provider_rate_limit_state SET tokens = $2, last_refill_at = $3 WHERE provider = $1`,
      [config.provider, replenished, now],
    )

    const deficit = 1 - replenished
    return { kind: 'wait', retryAfterMs: Math.ceil((deficit / refillRate) * 1000) }
  })
}

export interface AcquireOptions {
  /** Give up rather than queue forever behind a busy provider. */
  readonly maxWaitMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => Date
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Wait for a token, up to a bound.
 *
 * Returns false rather than throwing when the wait would exceed the bound: the
 * caller renders a "waiting for the geocoder" state, which is a designed part of
 * the search experience rather than an error (ADR-0011).
 */
export async function acquire(
  db: RateLimitRunner,
  config: BucketConfig,
  options: AcquireOptions = {},
): Promise<boolean> {
  const maxWaitMs = options.maxWaitMs ?? 5000
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => new Date())

  const deadline = now().getTime() + maxWaitMs

  // A deadline alone is not enough to guarantee termination: it assumes the
  // clock advances. An injected or frozen clock — a test, a suspended VM, a
  // stepped debugger — would spin here forever. The attempt cap makes the loop
  // terminate on its own terms rather than on the environment's good behaviour.
  const maxAttempts = Math.max(2, Math.ceil(maxWaitMs / 50) + 1)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await tryAcquire(db, config, now())
    if (result.kind === 'acquired') return true

    const remaining = deadline - now().getTime()
    if (remaining <= 0) return false

    await sleep(Math.min(result.retryAfterMs, remaining))
  }

  return false
}

/** The Nominatim bucket, at the policy maximum. Do not raise. */
export const NOMINATIM_BUCKET: BucketConfig = {
  provider: 'nominatim',
  refillPerSecond: 1,
  maxTokens: 1,
}

/**
 * data.gov.my — 4 requests per minute, verified 2026-08-21.
 *
 * The limit is shared across EVERY endpoint on the portal: Data Catalogue,
 * OpenDOSM, Weather, GTFS Static and GTFS Realtime all draw on the same budget,
 * and exceeding it returns 429.
 *
 * That is the binding constraint on the Kuala Lumpur pilot's realtime design.
 * The vehicle-position feeds refresh every 30 seconds, but polling four KL
 * agencies at that cadence would need 8 requests/minute — double what the portal
 * allows. So realtime polling must be staggered across agencies rather than run
 * per-feed, and one shared bucket is what makes that enforceable rather than
 * aspirational.
 *
 * A burst of 4 is allowed because the limit is expressed per minute, not per
 * second: refusing a second request within the same second would be stricter
 * than the policy requires.
 */
export const DATA_GOV_MY_BUCKET: BucketConfig = {
  provider: 'data.gov.my',
  refillPerSecond: 4 / 60,
  maxTokens: 4,
}
