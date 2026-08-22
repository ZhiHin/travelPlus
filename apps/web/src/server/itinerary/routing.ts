import { withUser } from '@travelplus/db'
import { DEFAULT_DAY_CONSTRAINTS, resolveLocal, uuidv7, type FeedRef } from '@travelplus/domain'
import { createOtpClient, type OtpClient, type RouteOutcome } from '@travelplus/routing'
import { saveRoutes } from '../routes/snapshots.js'

/**
 * Route the legs between adjacent items.
 *
 * Called with the boundaries a commit or add reported — never the whole day
 * (BR-I6). For each boundary with two resolved places, ask the router for a
 * departure after the earlier item ends, write an immutable snapshot, and
 * attach it as the later item's inbound leg.
 *
 * Every way this can fail leaves the leg ABSENT, which the ribbon draws as a
 * gap: a place with no coordinates, a router that could not be reached, a
 * journey that does not exist. None of them produces a duration.
 */

export interface RoutedBoundary {
  readonly from: string
  readonly to: string
  readonly outcome: 'routed' | 'no-route' | 'unavailable' | 'unresolved'
  readonly snapshotId: string | null
}

interface Endpoint {
  readonly itemId: string
  readonly lat: number | null
  readonly lon: number | null
  readonly endInstant: Date | null
  readonly startInstant: Date | null
  readonly plannedDurationSeconds: number
}

let cachedClient: { client: OtpClient; region: string; zone: string; feeds: FeedRef[] } | null =
  null

export interface RoutingDeps {
  /** Base URL of the OTP router. The route handler reads it from config once. */
  readonly otpBaseUrl: string
}

async function routerFor(
  deps: RoutingDeps,
  userId: string,
  regionSlug: string,
): Promise<{ client: OtpClient; zone: string; feeds: FeedRef[] } | null> {
  if (cachedClient && cachedClient.region === regionSlug) return cachedClient

  const feeds = await withUser(userId, async (tx) => {
    // Feed metadata is world-readable (GRANT SELECT, no RLS): it is provenance,
    // not user data.
    return tx<
      { agency_name: string; licence: string; attribution: string; notes: string | null }[]
    >`
      SELECT f.agency_name, f.licence, f.attribution, f.notes
      FROM transit_feeds f JOIN routing_regions r ON r.id = f.routing_region_id
      WHERE r.slug = ${regionSlug} AND r.status = 'ACTIVE'
    `
  })
  if (feeds.length === 0) return null

  const feedRefs: FeedRef[] = feeds.map((f) => ({
    // The OTP feedId is recorded in notes as "OTP feedId <id>"; fall back to
    // the agency name so a missing note degrades to a readable label.
    feedId: /OTP feedId (\S+)/.exec(f.notes ?? '')?.[1] ?? f.agency_name,
    feedVersion: 'current',
    agency: f.agency_name,
    licence: f.licence,
    attribution: f.attribution,
  }))

  const client = createOtpClient({
    baseUrl: deps.otpBaseUrl,
    routerRegion: regionSlug,
    routerZone: 'Asia/Kuala_Lumpur',
    feeds: feedRefs,
    // Derived from the catalog, not assumed: the pilot has no TripUpdates feed.
    feedsSupportTripUpdates: false,
    now: () => new Date(),
    newId: uuidv7,
  })
  cachedClient = { client, region: regionSlug, zone: 'Asia/Kuala_Lumpur', feeds: feedRefs }
  return cachedClient
}

/** For tests: forget the cached router so a changed catalog is re-read. */
export function resetRouterCache(): void {
  cachedClient = null
}

function dayStartInstant(localDate: string, zone: string): Date {
  const hh = String(Math.floor(DEFAULT_DAY_CONSTRAINTS.earliestStartSeconds / 3600)).padStart(
    2,
    '0',
  )
  const r = resolveLocal({ date: localDate, time: `${hh}:00`, zone })
  if (r.kind === 'ok') return r.instant
  if (r.kind === 'ambiguous') return r.candidates[0]
  return r.suggested
}

export async function routeBoundaries(
  deps: RoutingDeps,
  userId: string,
  dayId: string,
  boundaries: readonly { from: string; to: string }[],
  now: Date,
): Promise<RoutedBoundary[]> {
  if (boundaries.length === 0) return []

  const ctx = await withUser(userId, async (tx) => {
    const [day] = await tx<
      {
        trip_id: string
        local_date: Date
        iana_zone: string
        region_slug: string | null
        region_id: string | null
      }[]
    >`
      SELECT d.trip_id, d.local_date, d.iana_zone,
             region.slug AS region_slug, region.id AS region_id
      FROM trip_days d
      LEFT JOIN LATERAL (
              SELECT r.slug, r.id FROM routing_regions r
              WHERE r.status = 'ACTIVE'
                AND EXISTS (
                  SELECT 1 FROM itinerary_items i JOIN places p ON p.id = i.place_id
                  WHERE i.trip_day_id = d.id AND i.deleted_at IS NULL
                    AND ST_Covers(r.bbox, p.coord)
                )
              ORDER BY r.created_at LIMIT 1) AS region ON true
      WHERE d.id = ${dayId}
    `
    if (!day) return null

    const ids = [...new Set(boundaries.flatMap((b) => [b.from, b.to]))]
    const rows = await tx<
      {
        id: string
        lat: number | null
        lon: number | null
        start_instant: Date | null
        end_instant: Date | null
        planned_duration_seconds: number
      }[]
    >`
      SELECT i.id,
             ST_Y(p.coord::geometry)::float8 AS lat,
             ST_X(p.coord::geometry)::float8 AS lon,
             i.start_instant, i.end_instant, i.planned_duration_seconds
      FROM itinerary_items i LEFT JOIN places p ON p.id = i.place_id
      WHERE i.id = ANY(${ids}) AND i.deleted_at IS NULL
    `
    const endpoints = new Map<string, Endpoint>(
      rows.map((r) => [
        r.id,
        {
          itemId: r.id,
          lat: r.lat,
          lon: r.lon,
          startInstant: r.start_instant,
          endInstant: r.end_instant,
          plannedDurationSeconds: r.planned_duration_seconds,
        },
      ]),
    )
    return {
      tripId: day.trip_id,
      localDate: day.local_date.toISOString().slice(0, 10),
      zone: day.iana_zone,
      regionSlug: day.region_slug,
      regionId: day.region_id,
      endpoints,
    }
  })
  if (!ctx) return boundaries.map((b) => ({ ...b, outcome: 'unresolved', snapshotId: null }))

  const router = ctx.regionSlug ? await routerFor(deps, userId, ctx.regionSlug) : null
  const results: RoutedBoundary[] = []

  for (const b of boundaries) {
    const from = ctx.endpoints.get(b.from)
    const to = ctx.endpoints.get(b.to)
    if (!from || !to || from.lat == null || from.lon == null || to.lat == null || to.lon == null) {
      results.push({ ...b, outcome: 'unresolved', snapshotId: null })
      continue
    }
    if (!router) {
      results.push({ ...b, outcome: 'unavailable', snapshotId: null })
      continue
    }

    // Depart when the earlier item ends; if it has no time yet, when the day
    // starts. Never "now": the plan is for the trip's date, not today's.
    const departAt =
      from.endInstant ??
      (from.startInstant
        ? new Date(from.startInstant.getTime() + from.plannedDurationSeconds * 1000)
        : dayStartInstant(ctx.localDate, ctx.zone))

    const outcome: RouteOutcome = await router.client.plan({
      from: { lat: from.lat, lon: from.lon },
      to: { lat: to.lat, lon: to.lon },
      departAt,
      numItineraries: 1,
    })

    if (outcome.kind !== 'routes' || outcome.routes.length === 0) {
      results.push({
        ...b,
        outcome: outcome.kind === 'no-route' ? 'no-route' : 'unavailable',
        snapshotId: null,
      })
      continue
    }

    const saved = await saveRoutes(
      userId,
      {
        tripId: ctx.tripId,
        origin: { lat: from.lat, lon: from.lon },
        destination: { lat: to.lat, lon: to.lon },
        departAt,
        ianaZone: ctx.zone,
        modes: ['WALK', 'TRANSIT'],
        routingRegionId: ctx.regionId,
      },
      outcome.routes.slice(0, 1),
    )
    const snapshotId = saved.snapshotIds[0] ?? null

    await withUser(userId, async (tx) => {
      await tx`
        UPDATE itinerary_items
        SET inbound_route_snapshot_id = ${snapshotId}, updated_at = ${now}
        WHERE id = ${b.to} AND deleted_at IS NULL
      `
    })
    results.push({ ...b, outcome: 'routed', snapshotId })
  }

  return results
}
