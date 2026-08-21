import { closeDb, initDb, systemDb } from '@travelplus/db'
import { uuidv7 } from '@travelplus/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addDestination,
  archiveTrip,
  createTrip,
  deleteTrip,
  duplicateTrip,
  getTrip,
  listTrips,
  updateTrip,
} from './service.js'

/**
 * Trip services against a real PostgreSQL with RLS in force.
 *
 * The claims worth testing here are all relational: coverage tiers resolved by a
 * PostGIS containment query, optimistic concurrency enforced by a versioned
 * UPDATE, and non-members getting `not-found` rather than `forbidden`. None of
 * those exist in a mocked repository.
 */

const APP_URL =
  process.env.DATABASE_URL_APP ??
  'postgres://travelplus_app:travelplus_dev_only@127.0.0.1:5433/travelplus'
const MIGRATOR_URL =
  process.env.DATABASE_URL ??
  'postgres://travelplus_migrator:travelplus_dev_only@127.0.0.1:5433/travelplus'

const NOW = new Date('2026-08-20T10:00:00Z')

const owner = uuidv7()
const stranger = uuidv7()
const viewer = uuidv7()

/** Klang Valley, roughly. Matches the pilot region seeded below. */
const KL = { name: 'Kuala Lumpur', lat: 3.139, lon: 101.6869, ianaZone: 'Asia/Kuala_Lumpur' }
/** Somewhere with no region installed at all. */
const NOWHERE = { name: 'Bouvet Island', lat: -54.42, lon: 3.36 }

const klRegionId = uuidv7()
const klFeedId = uuidv7()

beforeAll(async () => {
  initDb({ appUrl: APP_URL, systemUrl: MIGRATOR_URL })
  const sql = systemDb()

  await sql.unsafe(`
    INSERT INTO users (id, email, password_hash) VALUES
      ('${owner}',    'owner-${owner}@itest.invalid',    'x'),
      ('${stranger}', 'stranger-${stranger}@itest.invalid', 'x'),
      ('${viewer}',   'viewer-${viewer}@itest.invalid',  'x');
  `)

  // A pilot-shaped region: street graph present, schedules valid, and realtime
  // that publishes vehicle positions but NOT trip updates — data.gov.my's exact
  // configuration.
  await sql.unsafe(`
    INSERT INTO routing_regions (id, slug, display_name, otp_router_id, bbox, status, coverage_tier)
    VALUES ('${klRegionId}', 'klang-valley-itest', 'Klang Valley', 'klang-valley',
            ST_SetSRID(ST_MakeEnvelope(101.3, 2.8, 102.0, 3.4), 4326)::geography,
            'ACTIVE', 'T2');

    INSERT INTO transit_feeds
      (id, routing_region_id, agency_name, feed_url, licence, attribution, licence_verified_at,
       caps_trip_updates, caps_vehicle_positions, caps_service_alerts)
    VALUES ('${klFeedId}', '${klRegionId}', 'Prasarana',
            'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl',
            'ITEST-FIXTURE-LICENCE', 'Data from data.gov.my', now(),
            false, true, false);

    INSERT INTO transit_feed_versions
      (id, transit_feed_id, version_label, service_start, service_end, checksum, last_success_at,
       freshness_window_seconds)
    VALUES ('${uuidv7()}', '${klFeedId}', 'itest-v1', '2026-01-01', '2027-01-01', 'abc',
            '2026-08-20T09:59:45Z', 120);
  `)
})

afterAll(async () => {
  const sql = systemDb()
  await sql.unsafe(`
    DELETE FROM trip_destinations WHERE trip_id IN (SELECT id FROM trips WHERE owner_id IN ('${owner}','${stranger}','${viewer}'));
    DELETE FROM trip_preferences  WHERE trip_id IN (SELECT id FROM trips WHERE owner_id IN ('${owner}','${stranger}','${viewer}'));
    DELETE FROM trip_members      WHERE trip_id IN (SELECT id FROM trips WHERE owner_id IN ('${owner}','${stranger}','${viewer}'));
    DELETE FROM trips             WHERE owner_id IN ('${owner}','${stranger}','${viewer}');
    DELETE FROM users             WHERE id IN ('${owner}','${stranger}','${viewer}');
    DELETE FROM transit_feed_versions WHERE transit_feed_id = '${klFeedId}';
    DELETE FROM transit_feeds     WHERE id = '${klFeedId}';
    DELETE FROM routing_regions   WHERE id = '${klRegionId}';
  `)
  await closeDb()
})

async function newTrip(title = 'Test trip') {
  const result = await createTrip(owner, { title }, NOW)
  if (!result.ok) throw new Error(`setup failed: ${JSON.stringify(result.error)}`)
  return result.value
}

describe('creating a trip', () => {
  it('creates the trip, an owner membership and a preferences row atomically', async () => {
    const trip = await newTrip('Lisbon in spring')
    expect(trip.title).toBe('Lisbon in spring')
    expect(trip.role).toBe('OWNER')
    expect(trip.version).toBe(1)

    const members = await systemDb()`SELECT role FROM trip_members WHERE trip_id = ${trip.id}`
    expect(members).toHaveLength(1)

    const prefs = await systemDb()`SELECT 1 FROM trip_preferences WHERE trip_id = ${trip.id}`
    expect(prefs).toHaveLength(1)
  })

  it('rejects an empty title', async () => {
    const result = await createTrip(owner, { title: '   ' }, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('invalid')
  })

  it('rejects an end date before the start date', async () => {
    const result = await createTrip(
      owner,
      { title: 'Backwards', startDate: '2026-05-10', endDate: '2026-05-01' },
      NOW,
    )
    expect(result.ok).toBe(false)
  })

  it('rejects out-of-range coordinates', async () => {
    const result = await createTrip(
      owner,
      { title: 'Bad coords', destinations: [{ name: 'X', lat: 91, lon: 0 }] },
      NOW,
    )
    expect(result.ok).toBe(false)
  })
})

/**
 * The honesty rule, resolved against a real PostGIS containment query rather
 * than a lookup table.
 */
describe('coverage tier resolution', () => {
  it('derives T2 for the pilot region — schedules but no trip updates', async () => {
    const trip = await newTrip('KL trip')
    const added = await addDestination(owner, trip.id, KL, NOW)
    expect(added.ok).toBe(true)
    if (!added.ok) return

    // The feed publishes vehicle positions and is 15 seconds fresh, but carries
    // no predictions — so it must never reach T3 (ADR-0022).
    expect(added.value.coverageTier).toBe('T2')
  })

  it('derives T0 where no region is installed', async () => {
    const trip = await newTrip('Nowhere trip')
    const added = await addDestination(owner, trip.id, NOWHERE, NOW)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.value.coverageTier).toBe('T0')
  })

  it('stores the tier server-side on the destination row', async () => {
    const trip = await newTrip('Stored tier')
    await addDestination(owner, trip.id, KL, NOW)
    const [row] = await systemDb()<{ coverage_tier: string }[]>`
      SELECT coverage_tier FROM trip_destinations WHERE trip_id = ${trip.id}
    `
    expect(row!.coverage_tier).toBe('T2')
  })

  // A traveller told "scheduled transit" would expect it everywhere on the trip.
  it('reports the WORST destination tier for the trip', async () => {
    const trip = await newTrip('Mixed coverage')
    await addDestination(owner, trip.id, KL, NOW)
    await addDestination(owner, trip.id, NOWHERE, NOW)

    const fetched = await getTrip(owner, trip.id, NOW)
    expect(fetched.ok).toBe(true)
    if (!fetched.ok) return
    expect(fetched.value.coverageTier).toBe('T0')
    expect(fetched.value.destinationCount).toBe(2)
  })
})

/**
 * Distinguishing "exists but forbidden" from "does not exist" lets an attacker
 * enumerate trips by id. Both must look identical.
 */
describe('a non-member cannot tell a real trip from a missing one', () => {
  it('returns not-found for a stranger asking about a real trip', async () => {
    const trip = await newTrip('Private')
    const result = await getTrip(stranger, trip.id, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('not-found')
  })

  it('returns the same shape for a trip id that never existed', async () => {
    const real = await getTrip(stranger, (await newTrip('Private 2')).id, NOW)
    const fake = await getTrip(stranger, uuidv7(), NOW)
    expect(real.ok).toBe(false)
    expect(fake.ok).toBe(false)
    if (real.ok || fake.ok) return
    expect(real.error).toEqual(fake.error)
  })

  it('excludes other users trips from the list', async () => {
    await newTrip('Owner only')
    const strangerTrips = await listTrips(stranger, NOW)
    expect(strangerTrips.every((t) => t.title !== 'Owner only')).toBe(true)
  })
})

describe('role enforcement', () => {
  it('refuses a viewer adding a destination', async () => {
    const trip = await newTrip('Shared')
    await systemDb()`
      INSERT INTO trip_members (trip_id, user_id, role) VALUES (${trip.id}, ${viewer}, 'VIEWER')
    `
    const result = await addDestination(viewer, trip.id, KL, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('forbidden')
  })

  it('refuses a viewer updating trip settings', async () => {
    const trip = await newTrip('Shared settings')
    await systemDb()`
      INSERT INTO trip_members (trip_id, user_id, role) VALUES (${trip.id}, ${viewer}, 'VIEWER')
    `
    const result = await updateTrip(viewer, trip.id, { title: 'Hijacked', version: 1 }, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('forbidden')
  })

  it('lets a viewer read the trip', async () => {
    const trip = await newTrip('Readable')
    await systemDb()`
      INSERT INTO trip_members (trip_id, user_id, role) VALUES (${trip.id}, ${viewer}, 'VIEWER')
    `
    const result = await getTrip(viewer, trip.id, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.role).toBe('VIEWER')
  })
})

describe('optimistic concurrency', () => {
  it('updates and bumps the version', async () => {
    const trip = await newTrip('Original')
    const updated = await updateTrip(
      owner,
      trip.id,
      { title: 'Renamed', version: trip.version },
      NOW,
    )
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.value.title).toBe('Renamed')
    expect(updated.value.version).toBe(trip.version + 1)
  })

  // Two collaborators editing the same trip must not silently overwrite one
  // another; the loser gets a conflict carrying the current version.
  it('rejects a write based on a stale version', async () => {
    const trip = await newTrip('Contended')
    await updateTrip(owner, trip.id, { title: 'First writer', version: trip.version }, NOW)

    const second = await updateTrip(
      owner,
      trip.id,
      { title: 'Second writer', version: trip.version },
      NOW,
    )
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.error.kind).toBe('conflict')
    if (second.error.kind !== 'conflict') return
    expect(second.error.currentVersion).toBe(trip.version + 1)
  })

  it('leaves the first writer’s value intact after a rejected second write', async () => {
    const trip = await newTrip('Protected')
    await updateTrip(owner, trip.id, { title: 'Kept', version: trip.version }, NOW)
    await updateTrip(owner, trip.id, { title: 'Discarded', version: trip.version }, NOW)

    const fetched = await getTrip(owner, trip.id, NOW)
    expect(fetched.ok).toBe(true)
    if (!fetched.ok) return
    expect(fetched.value.title).toBe('Kept')
  })

  it('rejects an update that would invert the date range', async () => {
    const trip = await createTrip(
      owner,
      { title: 'Dates', startDate: '2026-05-01', endDate: '2026-05-10' },
      NOW,
    )
    if (!trip.ok) throw new Error('setup')
    const result = await updateTrip(
      owner,
      trip.value.id,
      { endDate: '2026-04-01', version: trip.value.version },
      NOW,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('invalid')
  })
})

describe('archive and delete', () => {
  it('archives without removing the trip', async () => {
    const trip = await newTrip('To archive')
    expect((await archiveTrip(owner, trip.id, NOW)).ok).toBe(true)
    const fetched = await getTrip(owner, trip.id, NOW)
    expect(fetched.ok).toBe(true)
    if (!fetched.ok) return
    expect(fetched.value.status).toBe('ARCHIVED')
  })

  it('soft-deletes so the row survives for its retention window', async () => {
    const trip = await newTrip('To delete')
    expect((await deleteTrip(owner, trip.id, NOW)).ok).toBe(true)

    expect((await getTrip(owner, trip.id, NOW)).ok).toBe(false)

    const [row] = await systemDb()<{ deleted_at: Date | null }[]>`
      SELECT deleted_at FROM trips WHERE id = ${trip.id}
    `
    expect(row!.deleted_at).not.toBeNull()
  })

  it('excludes deleted trips from the list', async () => {
    const trip = await newTrip('Deleted from list')
    await deleteTrip(owner, trip.id, NOW)
    const trips = await listTrips(owner, NOW)
    expect(trips.every((t) => t.id !== trip.id)).toBe(true)
  })
})

/**
 * BR-TR5. A route is an answer about specific dates and a booking is a
 * real-world commitment; neither clones meaningfully.
 */
describe('duplicating a trip', () => {
  it('copies structure, destinations and preferences', async () => {
    const trip = await newTrip('Original trip')
    await addDestination(owner, trip.id, KL, NOW)

    const copy = await duplicateTrip(owner, trip.id, NOW)
    expect(copy.ok).toBe(true)
    if (!copy.ok) return

    expect(copy.value.id).not.toBe(trip.id)
    expect(copy.value.title).toBe('Original trip (copy)')
    expect(copy.value.destinationCount).toBe(1)
    expect(copy.value.role).toBe('OWNER')

    const prefs = await systemDb()`SELECT 1 FROM trip_preferences WHERE trip_id = ${copy.value.id}`
    expect(prefs).toHaveLength(1)
  })

  it('starts the copy at version 1, independent of the original', async () => {
    const trip = await newTrip('Versioned original')
    await updateTrip(owner, trip.id, { title: 'Bumped', version: 1 }, NOW)

    const copy = await duplicateTrip(owner, trip.id, NOW)
    expect(copy.ok).toBe(true)
    if (!copy.ok) return
    expect(copy.value.version).toBe(1)
  })

  it('refuses to duplicate a trip the caller cannot see', async () => {
    const trip = await newTrip('Not yours')
    const result = await duplicateTrip(stranger, trip.id, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('not-found')
  })
})
