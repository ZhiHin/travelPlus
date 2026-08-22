import { closeDb, initDb, systemDb } from '@travelplus/db'
import { uuidv7, type FeedHealth, type NormalizedRoute } from '@travelplus/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadSnapshot, saveRoutes } from './snapshots.js'

/**
 * Route snapshots against real PostgreSQL.
 *
 * Three claims are only testable here: immutability enforced by grants, absent
 * fields surviving a database round-trip as NULL, and status being recomputed on
 * read rather than read back.
 */

const APP_URL =
  process.env.DATABASE_URL_APP ??
  'postgres://travelplus_app:travelplus_dev_only@127.0.0.1:5433/travelplus'
const MIGRATOR_URL =
  process.env.DATABASE_URL ??
  'postgres://travelplus_migrator:travelplus_dev_only@127.0.0.1:5433/travelplus'

const T0 = new Date('2026-08-21T02:00:00Z')
const user = uuidv7()

const FEED = {
  feedId: 'prasarana-rapid-rail-kl',
  feedVersion: '2026-08-01',
  agency: 'Prasarana',
  licence: 'CC BY 4.0',
  attribution: 'Transit data © Kerajaan Malaysia (data.gov.my), CC BY 4.0. Modified.',
}

const GEOM = {
  type: 'LineString' as const,
  coordinates: [
    [101.6958, 3.1427],
    [101.7137, 3.1588],
  ] as ReadonlyArray<readonly [number, number]>,
}

/** The pilot's real configuration: positions, no trip updates. */
function klFeedHealth(over: Partial<FeedHealth> = {}): FeedHealth {
  return {
    capabilities: { tripUpdates: false, vehiclePositions: true, serviceAlerts: false },
    lastSuccessAt: new Date(T0.getTime() - 15_000),
    freshnessWindowSeconds: 120,
    ...over,
  }
}

function route(over: Partial<NormalizedRoute> = {}): NormalizedRoute {
  return {
    id: uuidv7(),
    provenance: {
      status: 'SCHEDULED',
      retrievedAt: T0,
      routerRegion: 'klang-valley-snap-itest',
      feeds: [FEED],
    },
    totalDurationSeconds: 1140,
    startTime: new Date(T0.getTime() + 300_000),
    endTime: new Date(T0.getTime() + 1_440_000),
    transferCount: 0,
    walkDistanceMeters: 350,
    geometry: GEOM,
    legs: [
      { kind: 'WALK', distanceMeters: 350, durationSeconds: 360, geometry: GEOM },
      {
        kind: 'TRANSIT',
        agency: 'Prasarana',
        mode: 'SUBWAY',
        boardStop: {
          name: 'Pasar Seni',
          coord: [101.6958, 3.1427],
          stopCode: 'KJ14',
          platform: '2',
        },
        alightStop: { name: 'KLCC', coord: [101.7137, 3.1588] },
        intermediateStopCount: 3,
        scheduled: {
          departure: new Date(T0.getTime() + 420_000),
          arrival: new Date(T0.getTime() + 1_140_000),
        },
        geometry: GEOM,
        feedId: FEED.feedId,
        routeShortName: 'KJL',
        headsign: 'Gombak',
      },
    ],
    ...over,
  }
}

const regionId = uuidv7()

beforeAll(async () => {
  initDb({ appUrl: APP_URL, systemUrl: MIGRATOR_URL })
  await systemDb().unsafe(`
    INSERT INTO users (id, email, password_hash)
    VALUES ('${user}', 'snap-${user}@itest.invalid', 'x');

    INSERT INTO routing_regions (id, slug, display_name, otp_router_id, bbox, status, coverage_tier)
    VALUES ('${regionId}', 'klang-valley-snap-itest', 'Klang Valley', 'klang-valley',
            ST_SetSRID(ST_MakeEnvelope(101.3, 2.8, 102.0, 3.4), 4326)::geography, 'ACTIVE', 'T2');
  `)
})

afterAll(async () => {
  await systemDb().unsafe(`
    DELETE FROM route_requests WHERE requested_by = '${user}';
    DELETE FROM users WHERE id = '${user}';
    DELETE FROM routing_regions WHERE id = '${regionId}';
  `)
  await closeDb()
})

function input(over: Record<string, unknown> = {}) {
  return {
    tripId: null,
    origin: { lat: 3.1427, lon: 101.6958 },
    destination: { lat: 3.1588, lon: 101.7137 },
    departAt: new Date(T0.getTime() + 300_000),
    ianaZone: 'Asia/Kuala_Lumpur',
    modes: ['WALK', 'TRANSIT'],
    routingRegionId: regionId,
    ...over,
  }
}

describe('saving a route', () => {
  it('writes the request and its snapshots in one transaction', async () => {
    const saved = await saveRoutes(user, input(), [route()])
    expect(saved.snapshotIds).toHaveLength(1)

    const [req] = await systemDb()`SELECT id FROM route_requests WHERE id = ${saved.requestId}`
    expect(req).toBeDefined()
  })

  it('persists legs in order with their transit segment', async () => {
    const saved = await saveRoutes(user, input(), [route()])
    const legs = await systemDb()<{ ordinal: number; kind: string }[]>`
      SELECT ordinal, kind FROM route_legs
      WHERE route_snapshot_id = ${saved.snapshotIds[0]!} ORDER BY ordinal
    `
    expect(legs.map((l) => l.kind)).toEqual(['WALK', 'TRANSIT'])

    const [segment] = await systemDb()<{ route_short_name: string; agency: string }[]>`
      SELECT s.route_short_name, s.agency FROM transit_segments s
      JOIN route_legs l ON l.id = s.route_leg_id
      WHERE l.route_snapshot_id = ${saved.snapshotIds[0]!}
    `
    expect(segment!.route_short_name).toBe('KJL')
    expect(segment!.agency).toBe('Prasarana')
  })

  it('refuses a request that is neither depart-at nor arrive-by', async () => {
    await expect(
      saveRoutes(user, input({ departAt: undefined }) as never, [route()]),
    ).rejects.toThrow(/exactly one/)
  })

  it('refuses a request that is both', async () => {
    await expect(
      saveRoutes(user, input({ arriveBy: new Date(T0) }) as never, [route()]),
    ).rejects.toThrow(/exactly one/)
  })
})

/**
 * The nullability of every descriptive column is the schema-level expression of
 * the product's central claim. A coalesce to '' anywhere in the write path would
 * turn "we were not told" into a rendered empty row reading "no platform".
 */
describe('absent fields survive as NULL, not as empty strings', () => {
  it('stores NULL for fields the feed omitted', async () => {
    const bare = route()
    const transit = { ...(bare.legs[1] as never) } as Record<string, unknown>
    delete transit.routeShortName
    delete transit.headsign
    ;(transit.boardStop as Record<string, unknown>) = {
      name: 'Pasar Seni',
      coord: [101.6958, 3.1427],
    }

    const saved = await saveRoutes(user, input(), [
      { ...bare, legs: [bare.legs[0]!, transit as never] },
    ])

    const [segment] = await systemDb()<
      {
        route_short_name: string | null
        headsign: string | null
        board_platform: string | null
        board_stop_code: string | null
      }[]
    >`
      SELECT s.route_short_name, s.headsign, s.board_platform, s.board_stop_code
      FROM transit_segments s JOIN route_legs l ON l.id = s.route_leg_id
      WHERE l.route_snapshot_id = ${saved.snapshotIds[0]!}
    `
    expect(segment!.route_short_name).toBeNull()
    expect(segment!.headsign).toBeNull()
    expect(segment!.board_platform).toBeNull()
    expect(segment!.board_stop_code).toBeNull()
  })

  it('stores the values that WERE supplied', async () => {
    const saved = await saveRoutes(user, input(), [route()])
    const [segment] = await systemDb()<{ board_platform: string | null }[]>`
      SELECT s.board_platform FROM transit_segments s
      JOIN route_legs l ON l.id = s.route_leg_id
      WHERE l.route_snapshot_id = ${saved.snapshotIds[0]!}
    `
    expect(segment!.board_platform).toBe('2')
  })

  it('leaves realtime columns NULL for the positions-only pilot', async () => {
    const saved = await saveRoutes(user, input(), [route()])
    const [segment] = await systemDb()<
      { realtime_departure: Date | null; delay_seconds: number | null }[]
    >`
      SELECT s.realtime_departure, s.delay_seconds FROM transit_segments s
      JOIN route_legs l ON l.id = s.route_leg_id
      WHERE l.route_snapshot_id = ${saved.snapshotIds[0]!}
    `
    expect(segment!.realtime_departure).toBeNull()
    expect(segment!.delay_seconds).toBeNull()
  })
})

/**
 * Immutability is a grant, not a convention. If the app role could UPDATE a
 * snapshot, the record of what a traveller was actually shown could be rewritten
 * after the fact.
 */
describe('snapshots are immutable', () => {
  it('has no UPDATE or DELETE grant for the app role', async () => {
    const rows = await systemDb()<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'route_snapshots' AND grantee = 'travelplus_app'
    `
    const privileges = rows.map((r) => r.privilege_type)
    expect(privileges).toContain('SELECT')
    expect(privileges).toContain('INSERT')
    expect(privileges).not.toContain('UPDATE')
    expect(privileges).not.toContain('DELETE')
  })

  it('has no updated_at column, so there is nowhere to record a mutation', async () => {
    const rows = await systemDb()<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'route_snapshots'
    `
    expect(rows.map((r) => r.column_name)).not.toContain('updated_at')
  })

  it('applies the same rule to transit segments', async () => {
    const rows = await systemDb()<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'transit_segments' AND grantee = 'travelplus_app'
    `
    expect(rows.map((r) => r.privilege_type)).not.toContain('UPDATE')
  })
})

/**
 * R-15. The badge must change with no new data arriving, so status is recomputed
 * from feed health on every read rather than read back from the row.
 */
describe('status is derived on read, not stored', () => {
  it('reports SCHEDULED for the pilot however fresh the feed is', async () => {
    const saved = await saveRoutes(user, input(), [route()])
    const loaded = await loadSnapshot(user, saved.snapshotIds[0]!, klFeedHealth(), T0)
    expect(loaded?.status).toBe('SCHEDULED')
  })

  it('reports REALTIME only when a feed publishes TripUpdates and is fresh', async () => {
    const saved = await saveRoutes(user, input(), [route()])
    const live: FeedHealth = {
      capabilities: { tripUpdates: true, vehiclePositions: true, serviceAlerts: true },
      lastSuccessAt: new Date(T0.getTime() - 15_000),
      freshnessWindowSeconds: 120,
    }
    const loaded = await loadSnapshot(user, saved.snapshotIds[0]!, live, T0)
    expect(loaded?.status).toBe('REALTIME')
  })

  // The property that matters: advancing the clock alone flips the badge.
  it('flips REALTIME to STALE by advancing time, with no new data', async () => {
    const saved = await saveRoutes(user, input(), [route()])
    const live: FeedHealth = {
      capabilities: { tripUpdates: true, vehiclePositions: true, serviceAlerts: true },
      lastSuccessAt: new Date(T0.getTime() - 15_000),
      freshnessWindowSeconds: 120,
    }

    expect((await loadSnapshot(user, saved.snapshotIds[0]!, live, T0))?.status).toBe('REALTIME')

    const later = new Date(T0.getTime() + 600_000)
    expect((await loadSnapshot(user, saved.snapshotIds[0]!, live, later))?.status).toBe('STALE')
  })

  it('reports an age alongside the status', async () => {
    const saved = await saveRoutes(user, input(), [route()])
    const later = new Date(T0.getTime() + 3_600_000)
    const loaded = await loadSnapshot(user, saved.snapshotIds[0]!, klFeedHealth(), later)
    expect(loaded?.ageSeconds).toBeCloseTo(3600, 0)
  })

  it('returns null for a snapshot that does not exist', async () => {
    expect(await loadSnapshot(user, uuidv7(), klFeedHealth(), T0)).toBeNull()
  })
})

describe('loading preserves absence', () => {
  it('omits routeShortName when the stored column is NULL', async () => {
    const bare = route()
    const transit = { ...(bare.legs[1] as never) } as Record<string, unknown>
    delete transit.routeShortName
    delete transit.headsign

    const saved = await saveRoutes(user, input(), [
      { ...bare, legs: [bare.legs[0]!, transit as never] },
    ])
    const loaded = await loadSnapshot(user, saved.snapshotIds[0]!, klFeedHealth(), T0)
    const transitLeg = loaded!.legs.find((l) => l.kind === 'TRANSIT')

    expect(transitLeg?.transit?.routeShortName).toBeUndefined()
    expect(transitLeg?.transit?.headsign).toBeUndefined()
    // What WAS supplied still comes back.
    expect(transitLeg?.transit?.agency).toBe('Prasarana')
  })

  it('never surfaces a realtime departure for the pilot', async () => {
    const saved = await saveRoutes(user, input(), [route()])
    const loaded = await loadSnapshot(user, saved.snapshotIds[0]!, klFeedHealth(), T0)
    const transitLeg = loaded!.legs.find((l) => l.kind === 'TRANSIT')
    expect(transitLeg?.transit?.realtimeDeparture).toBeUndefined()
  })
})
