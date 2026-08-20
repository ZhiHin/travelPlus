import { describe, expect, it, vi } from 'vitest'
import { withUser, withoutUser, type QueryRunner, type TransactionalDb } from './session.js'

/** Records every statement so we can assert what the session actually did. */
function fakeDb() {
  const calls: Array<{ sql: string; params?: unknown[] }> = []
  const tx: QueryRunner = {
    unsafe: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push(params === undefined ? { sql } : { sql, params })
      return undefined
    }),
  }
  const db: TransactionalDb = { begin: async (fn) => fn(tx) }
  return { db, tx, calls }
}

const USER = '0192f3a0-8c1e-7000-8000-000000000001'

describe('withUser', () => {
  it('sets the session context before running the callback', async () => {
    const { db, calls } = fakeDb()
    await withUser(db, USER, async () => {
      expect(calls).toHaveLength(1)
      expect(calls[0]!.sql).toContain('app.current_user_id')
      return 'done'
    })
  })

  it('binds the user id as a parameter rather than interpolating it', async () => {
    const { db, calls } = fakeDb()
    await withUser(db, USER, async () => undefined)
    expect(calls[0]!.params).toEqual([USER])
    expect(calls[0]!.sql).not.toContain(USER)
  })

  // The `true` third argument makes the setting transaction-local. Without it the
  // value survives on a pooled connection and the next request inherits another
  // user's identity — a cross-user exposure, not a tidiness problem.
  it('scopes the setting to the transaction, not the session', async () => {
    const { db, calls } = fakeDb()
    await withUser(db, USER, async () => undefined)
    expect(calls[0]!.sql).toMatch(/set_config\(\s*'app\.current_user_id'\s*,\s*\$1\s*,\s*true\s*\)/)
  })

  it('returns the callback result', async () => {
    const { db } = fakeDb()
    await expect(withUser(db, USER, async () => 42)).resolves.toBe(42)
  })

  it('propagates errors so the transaction rolls back', async () => {
    const { db } = fakeDb()
    await expect(
      withUser(db, USER, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })

  it('rejects a non-uuid actor rather than opening an empty session', async () => {
    const { db, calls } = fakeDb()
    await expect(withUser(db, 'admin', async () => undefined)).rejects.toThrow(TypeError)
    expect(calls).toHaveLength(0)
  })

  it('rejects an injection-shaped actor', async () => {
    const { db } = fakeDb()
    await expect(withUser(db, "' OR '1'='1", async () => undefined)).rejects.toThrow(TypeError)
  })
})

describe('withoutUser', () => {
  it('clears the context so every policy evaluates false', async () => {
    const { db, calls } = fakeDb()
    await withoutUser(db, async () => undefined)
    expect(calls[0]!.sql).toContain("set_config('app.current_user_id', ''")
    expect(calls[0]!.sql).toContain('true')
  })
})
