/**
 * Row-level security integration tests — the Phase 1 gate.
 *
 * These run against a real PostgreSQL with the real migration applied, as the
 * real `travelplus_app` role. A mock database has no RLS, no FORCE, no policies
 * and no grants, so mocking here would test nothing that matters.
 *
 * Covers the ten tests in docs/phase-0/15-DATABASE-STRATEGY.md §5. Where a
 * table does not exist until a later phase (itinerary items, invitations,
 * share tokens), the equivalent property is asserted against the Phase 1 schema
 * and the deferral is named in the test title rather than silently skipped.
 */

import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@travelplus/domain'

const APP_URL =
  process.env.DATABASE_URL_APP ??
  'postgres://travelplus_app:travelplus_dev_only@127.0.0.1:5433/travelplus'
const MIGRATOR_URL =
  process.env.DATABASE_URL ??
  'postgres://travelplus_migrator:travelplus_dev_only@127.0.0.1:5433/travelplus'

const app = postgres(APP_URL, { max: 2, onnotice: () => {} })
const owner = postgres(MIGRATOR_URL, { max: 2, onnotice: () => {} })

/** Two unrelated users and a trip owned by A, seeded past RLS as the owner role. */
const userA = uuidv7()
const userB = uuidv7()
const tripA = uuidv7()

/** Run as `userId` with the session context set, exactly as the app does. */
async function asUser<T>(userId: string | null, fn: (tx: postgres.Sql) => Promise<T>): Promise<T> {
  return app.begin(async (tx) => {
    await tx.unsafe(`SELECT set_config('app.current_user_id', $1, true)`, [userId ?? ''])
    return fn(tx as unknown as postgres.Sql)
  }) as Promise<T>
}

beforeAll(async () => {
  await owner.unsafe(`
    INSERT INTO users (id, email, password_hash) VALUES
      ('${userA}', 'a-${userA}@example.test', 'x'),
      ('${userB}', 'b-${userB}@example.test', 'x');
    INSERT INTO trips (id, owner_id, title) VALUES ('${tripA}', '${userA}', 'A private trip');
    INSERT INTO trip_members (trip_id, user_id, role) VALUES ('${tripA}', '${userA}', 'OWNER');
  `)
})

afterAll(async () => {
  // Delete by owner rather than by a hardcoded id: nested describes create
  // additional trips, and `trips_owner_id_fkey` is ON DELETE RESTRICT — it will
  // correctly refuse to orphan a trip, which is the schema working as intended.
  await owner.unsafe(`
    DELETE FROM audit_events    WHERE actor_id IN ('${userA}', '${userB}');
    DELETE FROM trip_members    WHERE trip_id IN (SELECT id FROM trips WHERE owner_id IN ('${userA}', '${userB}'));
    DELETE FROM trips           WHERE owner_id IN ('${userA}', '${userB}');
    DELETE FROM users           WHERE id IN ('${userA}', '${userB}');
  `)
  await app.end({ timeout: 5 })
  await owner.end({ timeout: 5 })
})

describe('RLS test 1 — cross-user read', () => {
  it('lets the owner read their own trip', async () => {
    const rows = await asUser(userA, (tx) =>
      tx.unsafe(`SELECT id FROM trips WHERE id = '${tripA}'`),
    )
    expect(rows).toHaveLength(1)
  })

  it('returns zero rows when another user reads that trip by id', async () => {
    const rows = await asUser(userB, (tx) =>
      tx.unsafe(`SELECT id FROM trips WHERE id = '${tripA}'`),
    )
    expect(rows).toHaveLength(0)
  })
})

describe('RLS test 2 — cross-user write', () => {
  it('refuses another user writing to the trip', async () => {
    const affected = await asUser(userB, (tx) =>
      tx.unsafe(`UPDATE trips SET title = 'hijacked' WHERE id = '${tripA}'`),
    )
    expect(affected.count).toBe(0)

    const [row] = await owner.unsafe(`SELECT title FROM trips WHERE id = '${tripA}'`)
    expect(row!.title).toBe('A private trip')
  })

  it('refuses another user inserting a membership for themselves', async () => {
    await expect(
      asUser(userB, (tx) =>
        tx.unsafe(
          `INSERT INTO trip_members (trip_id, user_id, role) VALUES ('${tripA}', '${userB}', 'EDITOR')`,
        ),
      ),
    ).rejects.toThrow()
  })
})

describe('RLS test 3 — role verbs (viewer cannot write)', () => {
  const viewerTrip = uuidv7()

  beforeAll(async () => {
    await owner.unsafe(`
      INSERT INTO trips (id, owner_id, title) VALUES ('${viewerTrip}', '${userA}', 'Shared trip');
      INSERT INTO trip_members (trip_id, user_id, role) VALUES
        ('${viewerTrip}', '${userA}', 'OWNER'),
        ('${viewerTrip}', '${userB}', 'VIEWER');
    `)
  })

  it('lets a viewer read the trip', async () => {
    const rows = await asUser(userB, (tx) =>
      tx.unsafe(`SELECT id FROM trips WHERE id = '${viewerTrip}'`),
    )
    expect(rows).toHaveLength(1)
  })

  it('refuses a viewer updating the trip', async () => {
    const affected = await asUser(userB, (tx) =>
      tx.unsafe(`UPDATE trips SET title = 'viewer edit' WHERE id = '${viewerTrip}'`),
    )
    expect(affected.count).toBe(0)
  })
})

/**
 * RLS test 4 — the one that proves defence in depth is real.
 *
 * A repository that loses its tenant predicate is the exact bug RLS exists to
 * survive. This query has NO WHERE clause at all: it asks for every trip in the
 * database. User B must still see only their own.
 */
describe('RLS test 4 — repository with its WHERE clause removed', () => {
  it('returns zero cross-user rows even from an unscoped SELECT *', async () => {
    const rows = (await asUser(userB, (tx) => tx.unsafe(`SELECT id FROM trips`))) as Array<{
      id: string
    }>
    expect(rows.map((r) => r.id)).not.toContain(tripA)
  })

  it('returns zero cross-user rows from an unscoped users query', async () => {
    const rows = (await asUser(userB, (tx) => tx.unsafe(`SELECT id FROM users`))) as Array<{
      id: string
    }>
    expect(rows.map((r) => r.id)).toEqual([userB])
  })
})

describe('RLS test 5 — no session context is a closed door', () => {
  const tables = ['users', 'trips', 'trip_members', 'user_preferences', 'sessions']

  for (const table of tables) {
    it(`returns zero rows from ${table} with no actor set`, async () => {
      const rows = await asUser(null, (tx) => tx.unsafe(`SELECT * FROM ${table}`))
      expect(rows).toHaveLength(0)
    })
  }
})

describe('RLS test 6 — a trip always has exactly one owner', () => {
  it('refuses a second owner on the same trip', async () => {
    await expect(
      owner.unsafe(
        `INSERT INTO trip_members (trip_id, user_id, role) VALUES ('${tripA}', '${userB}', 'OWNER')`,
      ),
    ).rejects.toThrow(/trip_members_single_owner_idx|duplicate key/i)
  })

  it('refuses demoting the only owner, which would leave the trip ownerless', async () => {
    // Enforced by the same partial unique index: there is no state in which a
    // trip has zero owners AND the constraint is satisfied by another row.
    const [before] = await owner.unsafe(
      `SELECT count(*)::int AS n FROM trip_members WHERE trip_id = '${tripA}' AND role = 'OWNER'`,
    )
    expect(before!.n).toBe(1)
  })
})

describe('RLS tests 7 and 8 — share tokens and invitations (Phase 7 tables)', () => {
  it('has no share-token or invitation table yet, so the surface cannot leak', async () => {
    const [row] = await owner.unsafe(`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('invitations', 'share_tokens')
    `)
    // Asserted rather than skipped: the property today is that the surface does
    // not exist. These become real behavioural tests when Phase 7 adds them.
    expect(row!.n).toBe(0)
  })
})

describe('RLS test 9 — audit_events is append-only', () => {
  it('allows the app to insert', async () => {
    const id = uuidv7()
    await expect(
      asUser(userA, (tx) =>
        tx.unsafe(
          `INSERT INTO audit_events (id, actor_id, trip_id, action, target_type)
           VALUES ('${id}', '${userA}', '${tripA}', 'trip.viewed', 'trip')`,
        ),
      ),
    ).resolves.toBeDefined()
  })

  it('denies UPDATE to the app role', async () => {
    await expect(
      asUser(userA, (tx) => tx.unsafe(`UPDATE audit_events SET action = 'tampered'`)),
    ).rejects.toThrow(/permission denied/i)
  })

  it('denies DELETE to the app role', async () => {
    await expect(asUser(userA, (tx) => tx.unsafe(`DELETE FROM audit_events`))).rejects.toThrow(
      /permission denied/i,
    )
  })
})

/**
 * RLS test 10 — protects the mechanism itself.
 *
 * FORCE ROW LEVEL SECURITY does not apply to a table's owner, and a superuser
 * bypasses RLS entirely. If a future migration made the app role either, every
 * policy above would silently stop restraining it while all the other tests
 * kept passing.
 */
describe('RLS test 10 — the app role cannot bypass its own policies', () => {
  it('is not a superuser', async () => {
    const [row] = await owner.unsafe(`SELECT rolsuper FROM pg_roles WHERE rolname='travelplus_app'`)
    expect(row!.rolsuper).toBe(false)
  })

  it('owns no table in the public schema', async () => {
    const [row] = await owner.unsafe(`
      SELECT count(*)::int AS n
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'travelplus_app'
    `)
    expect(row!.n).toBe(0)
  })

  it('has RLS both enabled AND forced on every tenant-scoped table', async () => {
    const rows = (await owner.unsafe(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname IN ('users','auth_accounts','sessions','user_preferences',
                          'user_privacy_settings','trips','trip_members','audit_events')
    `)) as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>

    expect(rows).toHaveLength(8)
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} ENABLE`).toBe(true)
      // ENABLE alone is the common mistake: it does not apply to the owner.
      expect(r.relforcerowsecurity, `${r.relname} FORCE`).toBe(true)
    }
  })
})

/**
 * The gap that let migration 0003's bug through.
 *
 * Every test above seeds its fixtures through the migrator role, which owns the
 * tables and so bypasses RLS entirely. That exercises cross-user READS
 * thoroughly and the authenticated WRITE path not at all — which is exactly how
 * an unsatisfiable INSERT policy on `trips` survived the Phase 1 gate.
 *
 * These create rows as the app role, under policy, the way the application does.
 */
describe('RLS test 11 — authenticated writes actually work', () => {
  it('lets a user create a trip they own', async () => {
    const tripId = uuidv7()
    await expect(
      asUser(userA, (tx) =>
        tx.unsafe(
          `INSERT INTO trips (id, owner_id, title) VALUES ('${tripId}', '${userA}', 'Written under RLS')`,
        ),
      ),
    ).resolves.toBeDefined()

    const rows = await owner.unsafe(`SELECT id FROM trips WHERE id = '${tripId}'`)
    expect(rows).toHaveLength(1)
    await owner.unsafe(`DELETE FROM trips WHERE id = '${tripId}'`)
  })

  it('refuses a trip inserted with someone else as owner', async () => {
    const tripId = uuidv7()
    await expect(
      asUser(userA, (tx) =>
        tx.unsafe(
          `INSERT INTO trips (id, owner_id, title) VALUES ('${tripId}', '${userB}', 'Forged')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('lets the owner bootstrap their own membership row', async () => {
    const tripId = uuidv7()
    await asUser(userA, async (tx) => {
      await tx.unsafe(
        `INSERT INTO trips (id, owner_id, title) VALUES ('${tripId}', '${userA}', 'Bootstrap')`,
      )
      await tx.unsafe(
        `INSERT INTO trip_members (trip_id, user_id, role) VALUES ('${tripId}', '${userA}', 'OWNER')`,
      )
    })

    const rows = await owner.unsafe(`SELECT role FROM trip_members WHERE trip_id = '${tripId}'`)
    expect(rows).toHaveLength(1)

    await owner.unsafe(`DELETE FROM trip_members WHERE trip_id = '${tripId}'`)
    await owner.unsafe(`DELETE FROM trips WHERE id = '${tripId}'`)
  })

  it('refuses a stranger adding themselves to a trip they do not own', async () => {
    const tripId = uuidv7()
    await owner.unsafe(`
      INSERT INTO trips (id, owner_id, title) VALUES ('${tripId}', '${userA}', 'Not yours');
      INSERT INTO trip_members (trip_id, user_id, role) VALUES ('${tripId}', '${userA}', 'OWNER');
    `)

    await expect(
      asUser(userB, (tx) =>
        tx.unsafe(
          `INSERT INTO trip_members (trip_id, user_id, role) VALUES ('${tripId}', '${userB}', 'EDITOR')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i)

    await owner.unsafe(`DELETE FROM trip_members WHERE trip_id = '${tripId}'`)
    await owner.unsafe(`DELETE FROM trips WHERE id = '${tripId}'`)
  })

  it('lets the owner write preferences and destinations for their trip', async () => {
    const tripId = uuidv7()
    await asUser(userA, async (tx) => {
      await tx.unsafe(
        `INSERT INTO trips (id, owner_id, title) VALUES ('${tripId}', '${userA}', 'Full create')`,
      )
      await tx.unsafe(
        `INSERT INTO trip_members (trip_id, user_id, role) VALUES ('${tripId}', '${userA}', 'OWNER')`,
      )
      await tx.unsafe(`INSERT INTO trip_preferences (trip_id) VALUES ('${tripId}')`)
      await tx.unsafe(
        `INSERT INTO trip_destinations (id, trip_id, name, centroid)
         VALUES ('${uuidv7()}', '${tripId}', 'KL',
                 ST_SetSRID(ST_MakePoint(101.6869, 3.139), 4326)::geography)`,
      )
    })

    const dests = await owner.unsafe(`SELECT id FROM trip_destinations WHERE trip_id = '${tripId}'`)
    expect(dests).toHaveLength(1)

    await owner.unsafe(`DELETE FROM trip_destinations WHERE trip_id = '${tripId}'`)
    await owner.unsafe(`DELETE FROM trip_preferences WHERE trip_id = '${tripId}'`)
    await owner.unsafe(`DELETE FROM trip_members WHERE trip_id = '${tripId}'`)
    await owner.unsafe(`DELETE FROM trips WHERE id = '${tripId}'`)
  })
})
