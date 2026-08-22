import { closeDb, initDb, systemDb } from '@travelplus/db'
import { uuidv7, type DayConstraints } from '@travelplus/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTrip } from '../trips/service.js'
import {
  addItem,
  commitMove,
  ensureDays,
  listItems,
  listVersions,
  previewMove,
  removeItem,
  setLocks,
} from './service.js'

const APP_URL =
  process.env.DATABASE_URL_APP ??
  'postgres://travelplus_app:travelplus_dev_only@127.0.0.1:5433/travelplus'
const MIGRATOR_URL =
  process.env.DATABASE_URL ??
  'postgres://travelplus_migrator:travelplus_dev_only@127.0.0.1:5433/travelplus'

const NOW = new Date('2026-08-23T10:00:00Z')
const owner = uuidv7()
const viewer = uuidv7()

const C: DayConstraints = {
  earliestStartSeconds: 8 * 3600,
  latestFinishSeconds: 22 * 3600,
  bufferSeconds: 600,
  minTransferSeconds: 300,
  maxWalkMetersPerLeg: 1000,
  maxWalkMetersPerDay: 6000,
}

beforeAll(async () => {
  initDb({ appUrl: APP_URL, systemUrl: MIGRATOR_URL })
  await systemDb().unsafe(`
    INSERT INTO users (id, email, password_hash) VALUES
      ('${owner}',  'it-${owner}@itest.invalid',  'x'),
      ('${viewer}', 'itv-${viewer}@itest.invalid', 'x');
  `)
})

afterAll(async () => {
  await systemDb().unsafe(`
    DELETE FROM trips WHERE owner_id IN ('${owner}','${viewer}');
    DELETE FROM users WHERE id IN ('${owner}','${viewer}');
  `)
  await closeDb()
})

async function tripWithDays(days = 3) {
  const t = await createTrip(
    owner,
    { title: 'Itinerary trip', startDate: '2026-09-05', endDate: `2026-09-0${4 + days}` },
    NOW,
  )
  if (!t.ok) throw new Error('setup')
  const d = await ensureDays(owner, t.value.id, 'Asia/Kuala_Lumpur')
  if (!d.ok) throw new Error('days')
  return { tripId: t.value.id, days: d.value }
}

async function addN(dayId: string, n: number) {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const r = await addItem(owner, dayId, { kind: 'ACTIVITY', title: `Stop ${i}`, placeId: null })
    if (!r.ok) throw new Error(`add ${i}: ${JSON.stringify(r.error)}`)
    ids.push(r.value.id)
  }
  return ids
}

describe('days', () => {
  it('creates one day per date in the trip range, in order', async () => {
    const { days } = await tripWithDays(3)
    expect(days.map((d) => d.localDate)).toEqual(['2026-09-05', '2026-09-06', '2026-09-07'])
    expect(days.map((d) => d.ordinal)).toEqual([0, 1, 2])
  })

  it('is idempotent', async () => {
    const { tripId, days } = await tripWithDays(2)
    const again = await ensureDays(owner, tripId, 'Asia/Kuala_Lumpur')
    expect(again.ok && again.value.map((d) => d.id)).toEqual(days.map((d) => d.id))
  })

  it('refuses a trip with no dates', async () => {
    const t = await createTrip(owner, { title: 'Undated' }, NOW)
    if (!t.ok) throw new Error('setup')
    const r = await ensureDays(owner, t.value.id, 'UTC')
    expect(r.ok).toBe(false)
  })
})

describe('items', () => {
  it('appends with gap-free ordinals', async () => {
    const { days } = await tripWithDays(1)
    await addN(days[0]!.id, 3)
    const list = await listItems(owner, days[0]!.id)
    expect(list.ok && list.value.map((i) => i.ordinal)).toEqual([0, 1, 2])
  })

  it('bumps the trip version on every write', async () => {
    const { tripId, days } = await tripWithDays(1)
    const [before] = await systemDb()<
      { version: number }[]
    >`SELECT version FROM trips WHERE id = ${tripId}`
    await addN(days[0]!.id, 1)
    const [after] = await systemDb()<
      { version: number }[]
    >`SELECT version FROM trips WHERE id = ${tripId}`
    expect(after!.version).toBeGreaterThan(before!.version)
  })

  it('refuses a viewer', async () => {
    const { tripId, days } = await tripWithDays(1)
    await systemDb()`INSERT INTO trip_members (trip_id, user_id, role) VALUES (${tripId}, ${viewer}, 'VIEWER')`
    const r = await addItem(viewer, days[0]!.id, { kind: 'ACTIVITY', title: 'Nope' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('forbidden')
  })

  // BR-I3: lock_item implies both others; the CHECK makes the inverse unrepresentable.
  it('normalises lockItem to imply lockTime and lockPlace', async () => {
    const { days } = await tripWithDays(1)
    const [id] = await addN(days[0]!.id, 1)
    const r = await setLocks(owner, id!, { lockItem: true }, 1)
    expect(r.ok && r.value.lockTime && r.value.lockPlace && r.value.lockItem).toBe(true)
  })

  it('refuses a stale version on lock change', async () => {
    const { days } = await tripWithDays(1)
    const [id] = await addN(days[0]!.id, 1)
    await setLocks(owner, id!, { lockTime: true }, 1)
    const stale = await setLocks(owner, id!, { lockTime: false }, 1)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.error.kind).toBe('conflict')
  })

  it('refuses to remove a locked item', async () => {
    const { days } = await tripWithDays(1)
    const [id] = await addN(days[0]!.id, 1)
    const locked = await setLocks(owner, id!, { lockItem: true }, 1)
    if (!locked.ok) throw new Error('lock')
    const r = await removeItem(owner, id!, locked.value.version)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.kind).toBe('locked')
  })

  it('renumbers after removal and reports the affected boundary', async () => {
    const { days } = await tripWithDays(1)
    const ids = await addN(days[0]!.id, 4)
    const r = await removeItem(owner, ids[1]!, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Removing b from a,b,c,d creates one new boundary a->c.
    expect(r.value.affectedBoundaries).toEqual([{ from: ids[0], to: ids[2] }])

    const list = await listItems(owner, days[0]!.id)
    expect(list.ok && list.value.map((i) => i.ordinal)).toEqual([0, 1, 2])
  })
})

/**
 * O3 / BR-I6 / BR-I7: the reorder contract. Preview shows the consequence,
 * touches at most four boundaries, and commit binds to what was previewed.
 */
describe('reorder — preview then commit', () => {
  it('previews without persisting', async () => {
    const { days } = await tripWithDays(1)
    const ids = await addN(days[0]!.id, 4)
    const p = await previewMove(owner, days[0]!.id, ids[3]!, 0, C, NOW)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.order).toEqual([ids[3], ids[0], ids[1], ids[2]])

    // Nothing changed on disk.
    const list = await listItems(owner, days[0]!.id)
    expect(list.ok && list.value.map((i) => i.id)).toEqual(ids)
  })

  it('touches at most four boundaries in a long day', async () => {
    const { days } = await tripWithDays(1)
    const ids = await addN(days[0]!.id, 12)
    const p = await previewMove(owner, days[0]!.id, ids[10]!, 2, C, NOW)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.value.affectedBoundaries.length).toBeLessThanOrEqual(4)
  })

  it('reports unrouted new adjacencies as NO_ROUTE_FOUND, never a guessed time', async () => {
    const { days } = await tripWithDays(1)
    const ids = await addN(days[0]!.id, 3)
    const p = await previewMove(owner, days[0]!.id, ids[2]!, 0, C, NOW)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    // Every boundary is pending (no snapshots exist), so the violations name
    // routing gaps rather than fabricating durations.
    expect(
      p.value.violations.every((v) =>
        ['NO_ROUTE_FOUND', 'UNRESOLVED_PLACE', 'OUTSIDE_USER_HOURS', 'MISSING_MEAL'].includes(
          v.code,
        ),
      ),
    ).toBe(true)
  })

  it('refuses to move a locked item', async () => {
    const { days } = await tripWithDays(1)
    const ids = await addN(days[0]!.id, 3)
    await setLocks(owner, ids[1]!, { lockItem: true }, 1)
    const p = await previewMove(owner, days[0]!.id, ids[1]!, 0, C, NOW)
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error.kind).toBe('locked')
  })

  it('commits the previewed order and writes a version', async () => {
    const { tripId, days } = await tripWithDays(1)
    const ids = await addN(days[0]!.id, 3)
    const p = await previewMove(owner, days[0]!.id, ids[2]!, 0, C, NOW)
    if (!p.ok) throw new Error('preview')

    const c = await commitMove(owner, p.value.previewToken, NOW)
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.value.order).toEqual([ids[2], ids[0], ids[1]])

    const list = await listItems(owner, days[0]!.id)
    expect(list.ok && list.value.map((i) => i.id)).toEqual([ids[2], ids[0], ids[1]])

    const versions = await listVersions(owner, tripId)
    expect(versions.ok && versions.value.length).toBeGreaterThanOrEqual(1)
  })

  it('refuses an expired preview', async () => {
    const { days } = await tripWithDays(1)
    const ids = await addN(days[0]!.id, 2)
    const p = await previewMove(owner, days[0]!.id, ids[1]!, 0, C, NOW)
    if (!p.ok) throw new Error('preview')
    const later = new Date(NOW.getTime() + 10 * 60_000)
    const c = await commitMove(owner, p.value.previewToken, later)
    expect(c.ok).toBe(false)
  })

  // ADR-0019: two editors moving items in the same day cannot silently overwrite.
  it('refuses a commit when another editor changed the day first', async () => {
    const { days } = await tripWithDays(1)
    const ids = await addN(days[0]!.id, 3)
    const p1 = await previewMove(owner, days[0]!.id, ids[2]!, 0, C, NOW)
    const p2 = await previewMove(owner, days[0]!.id, ids[0]!, 2, C, NOW)
    if (!p1.ok || !p2.ok) throw new Error('preview')

    expect((await commitMove(owner, p1.value.previewToken, NOW)).ok).toBe(true)
    const second = await commitMove(owner, p2.value.previewToken, NOW)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.kind).toBe('conflict')
  })

  it('cannot commit the same preview twice', async () => {
    const { days } = await tripWithDays(1)
    const ids = await addN(days[0]!.id, 2)
    const p = await previewMove(owner, days[0]!.id, ids[1]!, 0, C, NOW)
    if (!p.ok) throw new Error('preview')
    expect((await commitMove(owner, p.value.previewToken, NOW)).ok).toBe(true)
    expect((await commitMove(owner, p.value.previewToken, NOW)).ok).toBe(false)
  })
})

describe('versions are append-only', () => {
  it('grants the app role no UPDATE or DELETE on itinerary_versions', async () => {
    const rows = await systemDb()<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'itinerary_versions' AND grantee = 'travelplus_app'
    `
    const p = rows.map((r) => r.privilege_type)
    expect(p).toContain('INSERT')
    expect(p).not.toContain('UPDATE')
    expect(p).not.toContain('DELETE')
  })
})
