import {
  deriveCoverageTier,
  tripCoverageTier,
  uuidv7,
  type CoverageTier,
  type FeedFacts,
} from '@travelplus/domain'
import { systemDb, withUser, type Sql } from '@travelplus/db'

/**
 * Trip services.
 *
 * Every read and write goes through `withUser`, so row-level security applies
 * even if a predicate here is wrong. The service checks produce good errors;
 * RLS produces safety.
 *
 * Two rules shape the shapes below:
 *  - A non-member asking for a real trip gets `not-found`, never `forbidden`.
 *    Distinguishing them lets an attacker enumerate trips by id (R4).
 *  - Coverage tier is derived server-side from the region catalog and is not a
 *    writable field anywhere in this file (BR-TR4).
 */

export interface TripSummary {
  readonly id: string
  readonly title: string
  readonly status: TripStatus
  readonly startDate: string | null
  readonly endDate: string | null
  readonly travelerCount: number
  readonly version: number
  readonly role: TripRole
  readonly coverageTier: CoverageTier
  readonly destinationCount: number
}

export type TripStatus = 'PLANNING' | 'UPCOMING' | 'ACTIVE' | 'PAST' | 'ARCHIVED'
export type TripRole = 'OWNER' | 'EDITOR' | 'VIEWER'

export type TripError =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden'; readonly required: TripRole }
  | { readonly kind: 'conflict'; readonly currentVersion: number }
  | { readonly kind: 'invalid'; readonly problems: readonly string[] }

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: TripError }

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const err = <T>(error: TripError): Result<T> => ({ ok: false, error })

export interface CreateTripInput {
  readonly title: string
  readonly startDate?: string
  readonly endDate?: string
  readonly travelerCount?: number
  readonly destinations?: readonly {
    readonly name: string
    readonly lat: number
    readonly lon: number
    readonly ianaZone?: string
  }[]
}

function validateTrip(input: CreateTripInput): string[] {
  const problems: string[] = []
  const title = input.title?.trim() ?? ''

  if (title.length === 0) problems.push('Give the trip a name.')
  if (title.length > 200) problems.push('Trip name is too long.')

  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    problems.push('The end date must be on or after the start date.')
  }
  if (input.travelerCount !== undefined && input.travelerCount < 1) {
    problems.push('A trip needs at least one traveller.')
  }
  for (const d of input.destinations ?? []) {
    if (!Number.isFinite(d.lat) || d.lat < -90 || d.lat > 90)
      problems.push(`Invalid latitude for ${d.name}.`)
    if (!Number.isFinite(d.lon) || d.lon < -180 || d.lon > 180)
      problems.push(`Invalid longitude for ${d.name}.`)
  }
  return problems
}

/**
 * Create a trip, its owner membership and its destinations in one transaction.
 *
 * All three or none: a trip without an owner row is unreachable by its creator,
 * and the partial unique index would let a later repair create a second owner.
 */
export async function createTrip(
  userId: string,
  input: CreateTripInput,
  now: Date,
): Promise<Result<TripSummary>> {
  const problems = validateTrip(input)
  if (problems.length > 0) return err({ kind: 'invalid', problems })

  const tripId = uuidv7()

  await withUser(userId, async (tx) => {
    await tx`
      INSERT INTO trips (id, owner_id, title, start_date, end_date, traveler_count)
      VALUES (${tripId}, ${userId}, ${input.title.trim()},
              ${input.startDate ?? null}, ${input.endDate ?? null}, ${input.travelerCount ?? 1})
    `
    await tx`
      INSERT INTO trip_members (trip_id, user_id, role) VALUES (${tripId}, ${userId}, 'OWNER')
    `
    await tx`INSERT INTO trip_preferences (trip_id) VALUES (${tripId})`
  })

  for (const [index, d] of (input.destinations ?? []).entries()) {
    await addDestination(userId, tripId, { ...d, ordinal: index }, now)
  }

  const created = await getTrip(userId, tripId, now)
  return created.ok ? created : err({ kind: 'not-found' })
}

export async function getTrip(
  userId: string,
  tripId: string,
  now: Date,
): Promise<Result<TripSummary>> {
  return withUser(userId, async (tx) => {
    const [row] = await tx<
      {
        id: string
        title: string
        status: TripStatus
        start_date: Date | null
        end_date: Date | null
        traveler_count: number
        version: number
        role: TripRole
      }[]
    >`
      SELECT t.id, t.title, t.status, t.start_date, t.end_date, t.traveler_count, t.version,
             m.role
      FROM trips t
      JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ${userId}
      WHERE t.id = ${tripId} AND t.deleted_at IS NULL
    `

    // RLS would also hide a non-member's trip, but returning `not-found` here
    // keeps the service and the database saying the same thing.
    if (!row) return err<TripSummary>({ kind: 'not-found' })

    const tiers = await destinationTiers(tx, tripId, now)

    return ok<TripSummary>({
      id: row.id,
      title: row.title,
      status: row.status,
      startDate: row.start_date ? toIsoDate(row.start_date) : null,
      endDate: row.end_date ? toIsoDate(row.end_date) : null,
      travelerCount: row.traveler_count,
      version: row.version,
      role: row.role,
      coverageTier: tripCoverageTier(tiers),
      destinationCount: tiers.length,
    })
  })
}

export async function listTrips(
  userId: string,
  now: Date,
  filter?: { readonly status?: TripStatus },
): Promise<TripSummary[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx<
      {
        id: string
        title: string
        status: TripStatus
        start_date: Date | null
        end_date: Date | null
        traveler_count: number
        version: number
        role: TripRole
      }[]
    >`
      SELECT t.id, t.title, t.status, t.start_date, t.end_date, t.traveler_count, t.version, m.role
      FROM trips t
      JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ${userId}
      WHERE t.deleted_at IS NULL
        ${filter?.status ? tx`AND t.status = ${filter.status}` : tx``}
      ORDER BY t.start_date NULLS LAST, t.created_at DESC
    `

    const summaries: TripSummary[] = []
    for (const row of rows) {
      const tiers = await destinationTiers(tx, row.id, now)
      summaries.push({
        id: row.id,
        title: row.title,
        status: row.status,
        startDate: row.start_date ? toIsoDate(row.start_date) : null,
        endDate: row.end_date ? toIsoDate(row.end_date) : null,
        travelerCount: row.traveler_count,
        version: row.version,
        role: row.role,
        coverageTier: tripCoverageTier(tiers),
        destinationCount: tiers.length,
      })
    }
    return summaries
  })
}

export interface UpdateTripInput {
  readonly title?: string
  readonly startDate?: string | null
  readonly endDate?: string | null
  readonly travelerCount?: number
  readonly status?: TripStatus
  /** The version the caller read. A mismatch is a conflict, not an overwrite. */
  readonly version: number
}

export async function updateTrip(
  userId: string,
  tripId: string,
  input: UpdateTripInput,
  now: Date,
): Promise<Result<TripSummary>> {
  const current = await getTrip(userId, tripId, now)
  if (!current.ok) return current

  // Only the owner may change trip settings (roles table, §2).
  if (current.value.role !== 'OWNER') return err({ kind: 'forbidden', required: 'OWNER' })

  if (input.version !== current.value.version) {
    return err({ kind: 'conflict', currentVersion: current.value.version })
  }

  const nextStart = input.startDate !== undefined ? input.startDate : current.value.startDate
  const nextEnd = input.endDate !== undefined ? input.endDate : current.value.endDate
  if (nextStart && nextEnd && nextEnd < nextStart) {
    return err({ kind: 'invalid', problems: ['The end date must be on or after the start date.'] })
  }

  const updated = await withUser(userId, async (tx) => {
    const rows = await tx`
      UPDATE trips SET
        title = ${input.title?.trim() ?? current.value.title},
        start_date = ${nextStart},
        end_date = ${nextEnd},
        traveler_count = ${input.travelerCount ?? current.value.travelerCount},
        status = ${input.status ?? current.value.status},
        version = version + 1,
        updated_at = ${now}
      WHERE id = ${tripId} AND version = ${input.version}
      RETURNING id
    `
    return rows.length > 0
  })

  // A zero-row update means another writer won the race between our read and
  // our write.
  if (!updated) {
    const latest = await getTrip(userId, tripId, now)
    return err({
      kind: 'conflict',
      currentVersion: latest.ok ? latest.value.version : current.value.version,
    })
  }

  return getTrip(userId, tripId, now)
}

export async function archiveTrip(
  userId: string,
  tripId: string,
  now: Date,
): Promise<Result<void>> {
  const current = await getTrip(userId, tripId, now)
  if (!current.ok) return current as Result<void>
  if (current.value.role !== 'OWNER') return err({ kind: 'forbidden', required: 'OWNER' })

  await withUser(userId, async (tx) => {
    await tx`
      UPDATE trips SET status = 'ARCHIVED', version = version + 1, updated_at = ${now}
      WHERE id = ${tripId}
    `
  })
  return ok(undefined)
}

/** Soft delete, so the trip stays restorable for its retention window. */
export async function deleteTrip(userId: string, tripId: string, now: Date): Promise<Result<void>> {
  const current = await getTrip(userId, tripId, now)
  if (!current.ok) return current as Result<void>
  if (current.value.role !== 'OWNER') return err({ kind: 'forbidden', required: 'OWNER' })

  await withUser(userId, async (tx) => {
    await tx`UPDATE trips SET deleted_at = ${now} WHERE id = ${tripId}`
  })
  return ok(undefined)
}

/**
 * Duplicate a trip.
 *
 * Copies structure, destinations and preferences. Deliberately does NOT copy
 * route snapshots or bookings (BR-TR5): a route is an answer about specific
 * dates, and a booking is a real-world commitment that does not clone.
 */
export async function duplicateTrip(
  userId: string,
  tripId: string,
  now: Date,
): Promise<Result<TripSummary>> {
  const source = await getTrip(userId, tripId, now)
  if (!source.ok) return source

  const newTripId = uuidv7()

  await withUser(userId, async (tx) => {
    await tx`
      INSERT INTO trips (id, owner_id, title, start_date, end_date, traveler_count, tags, notes)
      SELECT ${newTripId}, ${userId}, title || ' (copy)', start_date, end_date, traveler_count, tags, notes
      FROM trips WHERE id = ${tripId}
    `
    await tx`INSERT INTO trip_members (trip_id, user_id, role) VALUES (${newTripId}, ${userId}, 'OWNER')`

    await tx`
      INSERT INTO trip_destinations
        (id, trip_id, name, centroid, iana_zone, arrive_date, depart_date, ordinal,
         routing_region_id, coverage_tier)
      SELECT gen_random_uuid(), ${newTripId}, name, centroid, iana_zone, arrive_date, depart_date,
             ordinal, routing_region_id, coverage_tier
      FROM trip_destinations WHERE trip_id = ${tripId}
    `

    await tx`
      INSERT INTO trip_preferences
      SELECT ${newTripId}, interests, dislikes, pace, budget_amount, budget_currency,
             preferred_modes, avoided_modes, max_walk_meters_per_leg, max_walk_meters_per_day,
             min_transfer_seconds, earliest_start, latest_finish, meal_windows, dietary,
             accessibility, indoor_outdoor_balance, travelling_with, nightlife, sustainability,
             buffer_minutes, weather_tolerance, ${now}
      FROM trip_preferences WHERE trip_id = ${tripId}
    `
  })

  return getTrip(userId, newTripId, now)
}

// ---------------------------------------------------------------------------
// Destinations and coverage
// ---------------------------------------------------------------------------

export interface AddDestinationInput {
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly ianaZone?: string
  readonly ordinal?: number
}

/**
 * Add a destination, resolving its coverage tier from the region catalog.
 *
 * The tier is computed here and written server-side. There is no code path
 * through which a client can set it (BR-TR4), so the UI cannot claim coverage
 * that does not exist.
 */
export async function addDestination(
  userId: string,
  tripId: string,
  input: AddDestinationInput,
  now: Date,
): Promise<Result<{ id: string; coverageTier: CoverageTier }>> {
  const access = await getTrip(userId, tripId, now)
  if (!access.ok) return access as Result<{ id: string; coverageTier: CoverageTier }>
  if (access.value.role === 'VIEWER') return err({ kind: 'forbidden', required: 'EDITOR' })

  const destinationId = uuidv7()
  const region = await resolveRegion(input.lon, input.lat, now)
  const tier = deriveCoverageTier(region, now)

  await withUser(userId, async (tx) => {
    await tx`
      INSERT INTO trip_destinations
        (id, trip_id, name, centroid, iana_zone, ordinal, routing_region_id, coverage_tier)
      VALUES (${destinationId}, ${tripId}, ${input.name},
              ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography,
              ${input.ianaZone ?? 'UTC'}, ${input.ordinal ?? 0},
              ${region?.id ?? null}, ${tier})
    `
  })

  return ok({ id: destinationId, coverageTier: tier })
}

interface RegionRow {
  id: string
  has_street_graph: boolean
  feeds: FeedFacts[]
}

/**
 * Find the routing region containing a point, and gather its feed facts.
 *
 * Uses the system connection: the region catalog is shared operational data, not
 * tenant data, and a user must be able to learn "there is no coverage here"
 * without being a member of anything.
 */
async function resolveRegion(
  lon: number,
  lat: number,
  now: Date,
): Promise<(RegionRow & { hasStreetGraph: boolean }) | null> {
  const sql = systemDb()

  const [region] = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM routing_regions
    WHERE status = 'ACTIVE'
      AND ST_Intersects(bbox, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography)
    LIMIT 1
  `
  if (!region) return null

  const feedRows = await sql<
    {
      caps_trip_updates: boolean
      caps_vehicle_positions: boolean
      caps_service_alerts: boolean
      service_start: Date | null
      service_end: Date | null
      last_success_at: Date | null
      freshness_window_seconds: number
    }[]
  >`
    SELECT f.caps_trip_updates, f.caps_vehicle_positions, f.caps_service_alerts,
           v.service_start, v.service_end, v.last_success_at, v.freshness_window_seconds
    FROM transit_feeds f
    LEFT JOIN LATERAL (
      SELECT * FROM transit_feed_versions v
      WHERE v.transit_feed_id = f.id ORDER BY v.ingested_at DESC LIMIT 1
    ) v ON true
    WHERE f.routing_region_id = ${region.id}
  `

  const feeds: FeedFacts[] = feedRows.map((r) => ({
    capabilities: {
      tripUpdates: r.caps_trip_updates,
      vehiclePositions: r.caps_vehicle_positions,
      serviceAlerts: r.caps_service_alerts,
    },
    serviceDatesCover:
      r.service_start !== null &&
      r.service_end !== null &&
      r.service_start <= now &&
      r.service_end >= now,
    lastSuccessAt: r.last_success_at,
    freshnessWindowSeconds: r.freshness_window_seconds ?? 120,
  }))

  return { id: region.id, has_street_graph: true, hasStreetGraph: true, feeds }
}

async function destinationTiers(tx: Sql, tripId: string, _now: Date): Promise<CoverageTier[]> {
  const rows = await tx<{ coverage_tier: CoverageTier }[]>`
    SELECT coverage_tier FROM trip_destinations WHERE trip_id = ${tripId} ORDER BY ordinal
  `
  return rows.map((r) => r.coverage_tier)
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
