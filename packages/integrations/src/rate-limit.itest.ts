import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { acquire, tryAcquire, type BucketConfig } from './rate-limit.js'

/**
 * The rate limiter against a real PostgreSQL.
 *
 * This is the one component whose entire purpose is cross-process correctness,
 * so an in-memory fake would test nothing. The property that matters — two
 * callers competing for the same token and exactly one winning — exists only
 * because of `SELECT ... FOR UPDATE`, and only a real database has that.
 *
 * Getting this wrong means exceeding Nominatim's 1 req/s policy and being
 * IP-blocked, which takes search down for every user (RISKS.md R-03).
 */

const URL =
  process.env.DATABASE_URL ??
  'postgres://travelplus_migrator:travelplus_dev_only@127.0.0.1:5433/travelplus'

/** Two independent pools, standing in for two application processes. */
const dbA = postgres(URL, { max: 5, onnotice: () => {} })
const dbB = postgres(URL, { max: 5, onnotice: () => {} })

const PROVIDER = 'itest-limiter'
const bucket: BucketConfig = { provider: PROVIDER, refillPerSecond: 1, maxTokens: 1 }

const T0 = new Date('2026-08-20T10:00:00Z')
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

beforeEach(async () => {
  await dbA`DELETE FROM provider_rate_limit_state WHERE provider LIKE 'itest-%'`
})

afterAll(async () => {
  await dbA`DELETE FROM provider_rate_limit_state WHERE provider LIKE 'itest-%'`
  await Promise.all([dbA.end({ timeout: 5 }), dbB.end({ timeout: 5 })])
})

describe('single caller', () => {
  it('acquires the first token', async () => {
    expect((await tryAcquire(dbA, bucket, T0)).kind).toBe('acquired')
  })

  it('refuses the second token in the same instant', async () => {
    await tryAcquire(dbA, bucket, T0)
    const second = await tryAcquire(dbA, bucket, T0)
    expect(second.kind).toBe('wait')
    if (second.kind !== 'wait') return
    expect(second.retryAfterMs).toBeGreaterThan(0)
    expect(second.retryAfterMs).toBeLessThanOrEqual(1000)
  })

  it('allows one per second, not more', async () => {
    expect((await tryAcquire(dbA, bucket, T0)).kind).toBe('acquired')
    expect((await tryAcquire(dbA, bucket, at(0.5))).kind).toBe('wait')
    expect((await tryAcquire(dbA, bucket, at(1))).kind).toBe('acquired')
    expect((await tryAcquire(dbA, bucket, at(1.5))).kind).toBe('wait')
    expect((await tryAcquire(dbA, bucket, at(2))).kind).toBe('acquired')
  })

  it('does not accumulate burst beyond maxTokens', async () => {
    // Idle for an hour, then two immediate calls: the second must still wait.
    expect((await tryAcquire(dbA, bucket, at(3600))).kind).toBe('acquired')
    expect((await tryAcquire(dbA, bucket, at(3600))).kind).toBe('wait')
  })

  // Without persisting the refill on the refusal path, every rejected attempt
  // would restart the clock and a busy caller could starve indefinitely.
  it('makes progress even when polled continuously', async () => {
    await tryAcquire(dbA, bucket, T0)
    for (let i = 1; i <= 9; i++) await tryAcquire(dbA, bucket, at(i / 10))
    expect((await tryAcquire(dbA, bucket, at(1.05))).kind).toBe('acquired')
  })
})

/**
 * The reason this table exists rather than a module-level counter.
 */
describe('two processes competing', () => {
  it('lets exactly one of two concurrent callers win', async () => {
    const [a, b] = await Promise.all([tryAcquire(dbA, bucket, T0), tryAcquire(dbB, bucket, T0)])
    const winners = [a, b].filter((r) => r.kind === 'acquired')
    expect(winners).toHaveLength(1)
  })

  it('lets exactly one of ten concurrent callers win', async () => {
    const pools = [dbA, dbB]
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => tryAcquire(pools[i % 2]!, bucket, T0)),
    )
    expect(results.filter((r) => r.kind === 'acquired')).toHaveLength(1)
  })

  it('shares one budget rather than one per process', async () => {
    // Process A spends the token; process B must observe that and wait.
    expect((await tryAcquire(dbA, bucket, T0)).kind).toBe('acquired')
    expect((await tryAcquire(dbB, bucket, T0)).kind).toBe('wait')
  })

  it('never exceeds the policy rate across processes over a window', async () => {
    // Ten seconds of wall time at 1/s must yield at most 11 grants
    // (the initial token plus one per elapsed second).
    let granted = 0
    for (let tenth = 0; tenth <= 100; tenth++) {
      const pool = tenth % 2 === 0 ? dbA : dbB
      const r = await tryAcquire(pool, bucket, at(tenth / 10))
      if (r.kind === 'acquired') granted++
    }
    expect(granted).toBeLessThanOrEqual(11)
    expect(granted).toBeGreaterThanOrEqual(10)
  })
})

describe('acquire with waiting', () => {
  it('returns true immediately when a token is free', async () => {
    const sleep = async () => {}
    expect(await acquire(dbA, bucket, { sleep, now: () => T0, maxWaitMs: 5000 })).toBe(true)
  })

  // The caller renders a "waiting for the geocoder" state rather than an error:
  // queuing is a designed part of search, not a failure (ADR-0011).
  it('returns false rather than throwing when the wait exceeds the bound', async () => {
    await tryAcquire(dbA, bucket, T0)
    let virtualNow = T0.getTime()
    const result = await acquire(dbA, bucket, {
      maxWaitMs: 200,
      now: () => new Date(virtualNow),
      sleep: async (ms) => {
        virtualNow += ms
      },
    })
    expect(result).toBe(false)
  })

  it('waits and then succeeds when the budget replenishes', async () => {
    await tryAcquire(dbA, bucket, T0)
    let virtualNow = T0.getTime()
    const result = await acquire(dbA, bucket, {
      maxWaitMs: 5000,
      now: () => new Date(virtualNow),
      sleep: async (ms) => {
        virtualNow += ms
      },
    })
    expect(result).toBe(true)
  })
})

describe('bucket isolation', () => {
  it('keeps providers independent', async () => {
    const other: BucketConfig = { provider: 'itest-other', refillPerSecond: 1, maxTokens: 1 }
    expect((await tryAcquire(dbA, bucket, T0)).kind).toBe('acquired')
    expect((await tryAcquire(dbA, other, T0)).kind).toBe('acquired')
  })
})

describe('termination guarantees', () => {
  // A deadline alone assumes the clock advances. A frozen clock — a test, a
  // suspended VM, a stepped debugger — would otherwise spin forever, so the
  // attempt cap must terminate the loop on its own terms.
  it('terminates under a frozen clock rather than looping forever', async () => {
    await tryAcquire(dbA, bucket, T0)

    let slept = 0
    const result = await acquire(dbA, bucket, {
      maxWaitMs: 300,
      now: () => T0, // never advances
      sleep: async () => {
        slept++
      },
    })

    expect(result).toBe(false)
    expect(slept).toBeGreaterThan(0)
    expect(slept).toBeLessThan(50) // bounded, not unbounded
  }, 10_000)
})
