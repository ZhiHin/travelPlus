import { closeDb, initDb, systemDb } from '@travelplus/db'
import { uuidv7 } from '@travelplus/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { upsertPlace } from '../places/service.js'
import { createTrip } from '../trips/service.js'
import { resetRouterCache, routeBoundaries } from './routing.js'
import { addItem, ensureDays, listItems } from './service.js'

/**
 * Leg routing wired end to end: real database, real places, real router.
 *
 * The router-dependent cases skip with a notice when OTP is down, the way
 * `otp.itest` does. The cases that must hold WITHOUT a router — unresolved
 * places, and the guarantee that no leg is ever attached from a failure —
 * always run.
 */

const APP_URL =
  process.env.DATABASE_URL_APP ??
  'postgres://travelplus_app:travelplus_dev_only@127.0.0.1:5433/travelplus'
const MIGRATOR_URL =
  process.env.DATABASE_URL ??
  'postgres://travelplus_migrator:travelplus_dev_only@127.0.0.1:5433/travelplus'
const OTP_BASE_URL = process.env.OTP_BASE_URL ?? 'http://127.0.0.1:8080'

const DEPS = { otpBaseUrl: OTP_BASE_URL }
const NOW = new Date('2026-08-23T10:00:00Z')
const owner = uuidv7()

async function routerReachable(): Promise<boolean> {
  try {
    const r = await fetch(new URL('/otp/gtfs/v1', OTP_BASE_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ feeds { feedId } }' }),
      signal: AbortSignal.timeout(3000),
    })
    return r.ok
  } catch {
    return false
  }
}
const reachable = await routerReachable()
if (!reachable)
  console.warn(`[routing.itest] router not reachable at ${OTP_BASE_URL} — live cases skipped`)

beforeAll(async () => {
  initDb({ appUrl: APP_URL, systemUrl: MIGRATOR_URL })
  resetRouterCache()
  await systemDb().unsafe(`
    INSERT INTO users (id, email, password_hash) VALUES ('${owner}', 'rt-${owner}@itest.invalid', 'x');
  `)
})

afterAll(async () => {
  await systemDb().unsafe(`
    DELETE FROM route_requests WHERE requested_by = '${owner}';
    DELETE FROM trips WHERE owner_id = '${owner}';
    DELETE FROM users WHERE id = '${owner}';
  `)
  await closeDb()
})

async function dayInKl() {
  const t = await createTrip(
    owner,
    { title: 'Routing trip', startDate: '2026-09-07', endDate: '2026-09-07' },
    NOW,
  )
  if (!t.ok) throw new Error('trip')
  const d = await ensureDays(owner, t.value.id, 'Asia/Kuala_Lumpur')
  if (!d.ok) throw new Error('days')
  return d.value[0]!
}

async function place(name: string, lat: number, lon: number) {
  const p = await upsertPlace(
    owner,
    { name, lat, lon, source: { provider: 'USER', sourceId: `rt-${name}-${uuidv7()}` } },
    { allowDuplicate: true },
  )
  if (p.kind === 'possible-duplicate') throw new Error('dup')
  return p.place.id
}

async function item(dayId: string, title: string, placeId: string | null) {
  const r = await addItem(owner, dayId, { kind: 'ACTIVITY', title, placeId })
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value.id
}

describe('routeBoundaries — always', () => {
  it('reports unresolved and attaches nothing when an item has no place', async () => {
    const day = await dayInKl()
    const a = await item(day.id, 'Pasar Seni', await place('Pasar Seni', 3.1427, 101.6958))
    const b = await item(day.id, 'Somewhere', null)

    const out = await routeBoundaries(DEPS, owner, day.id, [{ from: a, to: b }], NOW)
    expect(out).toEqual([{ from: a, to: b, outcome: 'unresolved', snapshotId: null }])

    const list = await listItems(owner, day.id)
    expect(list.ok && list.value.every((i) => i.inboundSnapshotId === null)).toBe(true)
  })

  it('does nothing for an empty boundary list', async () => {
    const day = await dayInKl()
    expect(await routeBoundaries(DEPS, owner, day.id, [], NOW)).toEqual([])
  })

  it('reports unavailable, not no-route, when the region has no active router', async () => {
    // Two resolved places far outside every catalogued region.
    const day = await dayInKl()
    const a = await item(day.id, 'Reykjavik', await place('Reykjavik', 64.1466, -21.9426))
    const b = await item(day.id, 'Akureyri', await place('Akureyri', 65.6835, -18.1262))
    const out = await routeBoundaries(DEPS, owner, day.id, [{ from: a, to: b }], NOW)
    expect(out[0]?.outcome).toBe('unavailable')
    expect(out[0]?.snapshotId).toBeNull()
  })
})

describe.skipIf(!reachable)('routeBoundaries — live Klang Valley router', () => {
  it('routes a leg, writes an immutable snapshot and attaches it as inbound', async () => {
    const day = await dayInKl()
    const a = await item(day.id, 'Pasar Seni', await place('Pasar Seni', 3.1427, 101.6958))
    const b = await item(day.id, 'KLCC', await place('KLCC', 3.1588, 101.7137))

    const out = await routeBoundaries(DEPS, owner, day.id, [{ from: a, to: b }], NOW)
    expect(out[0]?.outcome).toBe('routed')
    expect(out[0]?.snapshotId).toBeTruthy()

    const list = await listItems(owner, day.id)
    if (!list.ok) throw new Error('list')
    const arriving = list.value.find((i) => i.id === b)!
    expect(arriving.inboundSnapshotId).toBe(out[0]!.snapshotId)
    expect(arriving.inbound).not.toBeNull()
    // The pilot cannot claim live (ADR-0022).
    expect(arriving.inbound!.status).toBe('SCHEDULED')
    expect(arriving.inbound!.durationSeconds).toBeGreaterThan(5 * 60)
    expect(arriving.inbound!.durationSeconds).toBeLessThan(90 * 60)

    // The first item has no inbound leg, and was not touched.
    expect(list.value.find((i) => i.id === a)!.inboundSnapshotId).toBeNull()
  })

  it('plans for the trip date in the day zone, not for now', async () => {
    const day = await dayInKl()
    const a = await item(day.id, 'Pasar Seni', await place('Pasar Seni', 3.1427, 101.6958))
    const b = await item(day.id, 'KLCC', await place('KLCC', 3.1588, 101.7137))
    const out = await routeBoundaries(DEPS, owner, day.id, [{ from: a, to: b }], NOW)
    const [row] = await systemDb()<{ start_instant: Date }[]>`
      SELECT start_instant FROM route_snapshots WHERE id = ${out[0]!.snapshotId}
    `
    // 2026-09-07 08:00 Asia/Kuala_Lumpur is 00:00Z. The departure is on that
    // morning, not on 2026-08-23 (NOW) and not at 01:00 local.
    const iso = row!.start_instant.toISOString()
    expect(iso.startsWith('2026-09-07T0')).toBe(true)
  })

  it('leaves the leg absent on no-route rather than inventing one', async () => {
    const day = await dayInKl()
    const a = await item(day.id, 'Pasar Seni', await place('Pasar Seni', 3.1427, 101.6958))
    // Inside the region bbox but on the water: no street to link to.
    const b = await item(day.id, 'Straits', await place('Straits', 3.0, 101.32))
    const out = await routeBoundaries(DEPS, owner, day.id, [{ from: a, to: b }], NOW)
    expect(['no-route', 'unavailable']).toContain(out[0]?.outcome)
    const list = await listItems(owner, day.id)
    expect(list.ok && list.value.find((i) => i.id === b)!.inboundSnapshotId).toBeNull()
  })
})
