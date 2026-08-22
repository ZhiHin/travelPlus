import { withUser, type Sql } from '@travelplus/db'
import {
  deriveTransitStatus,
  isTransitLeg,
  uuidv7,
  type DataStatus,
  type FeedHealth,
  type NormalizedRoute,
} from '@travelplus/domain'

/**
 * Route snapshot persistence.
 *
 * Snapshots are written once and never updated (ADR-0006). The application role
 * has no UPDATE or DELETE grant on these tables, so immutability is enforced by
 * the database rather than by everyone remembering.
 *
 * The status a user sees is **derived on read** from `retrieved_at` and current
 * feed health, not read back from the row. A snapshot fetched an hour later can
 * correctly return `STALE` where it once returned `REALTIME`, with no data
 * having changed and no code having run — which is the property R-15 needs.
 */

export interface SaveRouteInput {
  readonly tripId: string | null
  readonly origin: { readonly lat: number; readonly lon: number }
  readonly destination: { readonly lat: number; readonly lon: number }
  readonly departAt?: Date
  readonly arriveBy?: Date
  readonly ianaZone: string
  readonly modes: readonly string[]
  readonly preferences?: Record<string, unknown>
  readonly routingRegionId: string | null
}

export interface SavedRoutes {
  readonly requestId: string
  readonly snapshotIds: readonly string[]
}

/**
 * Persist a routing result.
 *
 * The request and every snapshot are written in one transaction: a snapshot
 * whose request is missing has lost the question it answers, and could not be
 * explained or cached afterwards.
 */
export async function saveRoutes(
  userId: string,
  input: SaveRouteInput,
  routes: readonly NormalizedRoute[],
): Promise<SavedRoutes> {
  if ((input.departAt === undefined) === (input.arriveBy === undefined)) {
    // The database CHECK also enforces this; failing here gives a better message.
    throw new TypeError('Supply exactly one of departAt or arriveBy')
  }

  const requestId = uuidv7()

  return withUser(userId, async (tx) => {
    await tx`
      INSERT INTO route_requests
        (id, trip_id, origin, destination, depart_at, arrive_by, iana_zone, modes,
         preferences, routing_region_id, requested_by)
      VALUES (
        ${requestId}, ${input.tripId},
        ST_SetSRID(ST_MakePoint(${input.origin.lon}, ${input.origin.lat}), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${input.destination.lon}, ${input.destination.lat}), 4326)::geography,
        ${input.departAt ?? null}, ${input.arriveBy ?? null}, ${input.ianaZone},
        ${input.modes as string[]}, ${JSON.stringify(input.preferences ?? {})},
        ${input.routingRegionId}, ${userId}
      )
    `

    const snapshotIds: string[] = []
    for (const route of routes) {
      snapshotIds.push(await insertSnapshot(tx, requestId, route))
    }
    return { requestId, snapshotIds }
  })
}

async function insertSnapshot(tx: Sql, requestId: string, route: NormalizedRoute): Promise<string> {
  const snapshotId = uuidv7()

  await tx`
    INSERT INTO route_snapshots
      (id, route_request_id, status_at_retrieval, total_duration_seconds, start_instant,
       end_instant, transfer_count, walk_distance_meters, geometry, routing_region_id,
       retrieved_at)
    VALUES (
      ${snapshotId}, ${requestId}, ${route.provenance.status},
      ${Math.round(route.totalDurationSeconds)}, ${route.startTime}, ${route.endTime},
      ${route.transferCount}, ${Math.round(route.walkDistanceMeters)},
      ${lineString(route.geometry.coordinates)},
      (SELECT id FROM routing_regions WHERE slug = ${route.provenance.routerRegion}),
      ${route.provenance.retrievedAt}
    )
  `

  for (const [ordinal, leg] of route.legs.entries()) {
    const legId = uuidv7()
    await tx`
      INSERT INTO route_legs
        (id, route_snapshot_id, ordinal, kind, distance_meters, duration_seconds,
         start_instant, end_instant, geometry)
      VALUES (
        ${legId}, ${snapshotId}, ${ordinal}, ${leg.kind},
        ${isTransitLeg(leg) ? 0 : Math.round(leg.distanceMeters)},
        ${isTransitLeg(leg) ? 0 : Math.round(leg.durationSeconds)},
        ${isTransitLeg(leg) ? leg.scheduled.departure : null},
        ${isTransitLeg(leg) ? leg.scheduled.arrival : null},
        ${lineString(leg.geometry.coordinates)}
      )
    `

    if (!isTransitLeg(leg)) continue

    // Every optional column is written as NULL when the feed omitted it. A
    // coalesce to '' here would be the exact failure the schema exists to
    // prevent: an empty platform row reads as "no platform" rather than "we
    // were not told".
    await tx`
      INSERT INTO transit_segments
        (id, route_leg_id, agency, mode, route_short_name, route_long_name, route_colour,
         headsign, board_stop_name, board_stop_code, board_platform, board_coord,
         alight_stop_name, alight_stop_code, alight_platform, alight_coord,
         intermediate_stop_count, scheduled_departure, scheduled_arrival,
         realtime_departure, realtime_arrival, delay_seconds,
         wheelchair_accessible, wheelchair_confidence)
      VALUES (
        ${uuidv7()}, ${legId}, ${leg.agency}, ${leg.mode},
        ${leg.routeShortName ?? null}, ${leg.routeLongName ?? null}, ${leg.routeColor ?? null},
        ${leg.headsign ?? null},
        ${leg.boardStop.name}, ${leg.boardStop.stopCode ?? null}, ${leg.boardStop.platform ?? null},
        ST_SetSRID(ST_MakePoint(${leg.boardStop.coord[0]}, ${leg.boardStop.coord[1]}), 4326)::geography,
        ${leg.alightStop.name}, ${leg.alightStop.stopCode ?? null}, ${leg.alightStop.platform ?? null},
        ST_SetSRID(ST_MakePoint(${leg.alightStop.coord[0]}, ${leg.alightStop.coord[1]}), 4326)::geography,
        ${leg.intermediateStopCount}, ${leg.scheduled.departure}, ${leg.scheduled.arrival},
        ${leg.realtime?.departure ?? null}, ${leg.realtime?.arrival ?? null},
        ${leg.realtime?.delaySeconds ?? null},
        ${leg.accessibility?.wheelchairAccessible ?? null},
        ${leg.accessibility?.confidence ?? null}
      )
    `
  }

  return snapshotId
}

export interface LoadedSnapshot {
  readonly id: string
  /** Recomputed now, not read from the row. */
  readonly status: DataStatus
  readonly retrievedAt: Date
  readonly ageSeconds: number
  readonly totalDurationSeconds: number
  readonly transferCount: number
  readonly legs: readonly LoadedLeg[]
}

export interface LoadedLeg {
  readonly kind: string
  readonly ordinal: number
  readonly transit?: {
    readonly agency: string
    readonly mode: string
    readonly routeShortName?: string
    readonly headsign?: string
    readonly boardStopName: string
    readonly boardPlatform?: string
    readonly alightStopName: string
    readonly scheduledDeparture: Date
    readonly realtimeDeparture?: Date
  }
}

/**
 * Load a snapshot, deriving its status at read time.
 *
 * `feedHealth` is supplied by the caller rather than joined here, so the same
 * snapshot can be evaluated against a `Clock` in tests and against live feed
 * health in production — which is what makes the `REALTIME → STALE` transition
 * assertable without waiting for a feed to go quiet.
 */
export async function loadSnapshot(
  userId: string,
  snapshotId: string,
  feedHealth: FeedHealth,
  now: Date,
): Promise<LoadedSnapshot | null> {
  return withUser(userId, async (tx) => {
    const [snapshot] = await tx<
      {
        id: string
        retrieved_at: Date
        total_duration_seconds: number
        transfer_count: number
      }[]
    >`
      SELECT id, retrieved_at, total_duration_seconds, transfer_count
      FROM route_snapshots WHERE id = ${snapshotId}
    `
    if (!snapshot) return null

    const legRows = await tx<{ id: string; ordinal: number; kind: string }[]>`
      SELECT id, ordinal, kind FROM route_legs
      WHERE route_snapshot_id = ${snapshotId} ORDER BY ordinal
    `

    const legs: LoadedLeg[] = []
    for (const row of legRows) {
      if (row.kind !== 'TRANSIT') {
        legs.push({ kind: row.kind, ordinal: row.ordinal })
        continue
      }

      const [segment] = await tx<
        {
          agency: string
          mode: string
          route_short_name: string | null
          headsign: string | null
          board_stop_name: string
          board_platform: string | null
          alight_stop_name: string
          scheduled_departure: Date
          realtime_departure: Date | null
        }[]
      >`
        SELECT agency, mode, route_short_name, headsign, board_stop_name, board_platform,
               alight_stop_name, scheduled_departure, realtime_departure
        FROM transit_segments WHERE route_leg_id = ${row.id}
      `

      legs.push({
        kind: row.kind,
        ordinal: row.ordinal,
        ...(segment
          ? {
              transit: {
                agency: segment.agency,
                mode: segment.mode,
                boardStopName: segment.board_stop_name,
                alightStopName: segment.alight_stop_name,
                scheduledDeparture: segment.scheduled_departure,
                // NULL stays undefined. The UI omits the row rather than
                // rendering an empty one that reads as a fact.
                ...(segment.route_short_name !== null
                  ? { routeShortName: segment.route_short_name }
                  : {}),
                ...(segment.headsign !== null ? { headsign: segment.headsign } : {}),
                ...(segment.board_platform !== null
                  ? { boardPlatform: segment.board_platform }
                  : {}),
                ...(segment.realtime_departure !== null
                  ? { realtimeDeparture: segment.realtime_departure }
                  : {}),
              },
            }
          : {}),
      })
    }

    // The whole point: computed now, from feed health, not read back.
    const status = deriveTransitStatus(feedHealth, now)

    return {
      id: snapshot.id,
      status,
      retrievedAt: snapshot.retrieved_at,
      ageSeconds: Math.max(0, (now.getTime() - snapshot.retrieved_at.getTime()) / 1000),
      totalDurationSeconds: snapshot.total_duration_seconds,
      transferCount: snapshot.transfer_count,
      legs,
    }
  })
}

/** PostGIS LineString WKT, or null for an empty geometry. */
function lineString(coordinates: readonly (readonly [number, number])[]): string | null {
  if (coordinates.length < 2) return null
  const points = coordinates.map(([lon, lat]) => `${lon} ${lat}`).join(',')
  return `SRID=4326;LINESTRING(${points})`
}
