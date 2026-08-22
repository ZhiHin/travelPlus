import { uuidv7 } from '@travelplus/domain'
import { systemDb, withUser, type Sql } from '@travelplus/db'

/**
 * Place services.
 *
 * Two product rules dominate this file:
 *
 *  1. **No invented attributes.** There is no rating, review, popularity, price
 *     or phone field anywhere here, because those columns do not exist. A field
 *     that cannot be stored cannot be fabricated (BR-T1, PLACE-05).
 *  2. **Duplicate detection before creation.** Saving the same museum twice from
 *     two different searches produces two markers, two itinerary entries and two
 *     sets of notes. Detecting the collision is cheaper than merging later.
 */

export interface PlaceInput {
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly categories?: readonly string[]
  readonly address?: Record<string, string>
  readonly ianaZone?: string
  /** Where this came from. A place with no source is not trustworthy. */
  readonly source: {
    readonly provider: 'OSM' | 'NOMINATIM' | 'WIKIDATA' | 'USER'
    readonly sourceId: string
    readonly sourceUrl?: string
    readonly licence?: string
    readonly attribution?: string
  }
}

export interface Place {
  readonly id: string
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly categories: readonly string[]
  /** `UNKNOWN` never renders as "open" — absence of data is not availability. */
  readonly openingHoursConfidence: 'FEED' | 'PARSED' | 'USER' | 'UNKNOWN'
  readonly sources: readonly PlaceSource[]
}

export interface PlaceSource {
  readonly provider: string
  readonly sourceId: string
  readonly licence: string | null
  readonly attribution: string | null
}

export type PlaceOutcome =
  /** A new record was created. */
  | { readonly kind: 'created'; readonly place: Place }
  /** An existing record matched exactly on provider identity. */
  | { readonly kind: 'existing'; readonly place: Place }
  /** A likely duplicate was found. The caller decides; nothing was written. */
  | {
      readonly kind: 'possible-duplicate'
      readonly candidate: Place
      readonly distanceMeters: number
      readonly nameSimilarity: number
    }

/**
 * Thresholds for the fuzzy duplicate check.
 *
 * Tuned to catch the realistic collision — the same place returned by two
 * searches with slightly different names — without merging genuinely distinct
 * neighbours. Two cafés 40 m apart on the same street are different cafés;
 * "Pasar Seni" and "Pasar Seni LRT Station" at the same coordinates are not.
 */
export const DUPLICATE_RADIUS_METERS = 75
export const DUPLICATE_NAME_SIMILARITY = 0.45

/**
 * Create a place, or report that one already exists.
 *
 * Two guards, in order of confidence:
 *   1. Exact provider identity — `(provider, source_id)` is unique, so this is
 *      certain and returns the existing record silently.
 *   2. Spatial proximity plus trigram name similarity — a heuristic, so it
 *      REPORTS rather than merges. Auto-merging on a guess is how two distinct
 *      places quietly become one and a user's saved note lands on the wrong pin.
 */
export async function upsertPlace(
  userId: string,
  input: PlaceInput,
  opts: { readonly allowDuplicate?: boolean } = {},
): Promise<PlaceOutcome> {
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) {
    throw new RangeError(`Latitude ${input.lat} is out of range`)
  }
  if (!Number.isFinite(input.lon) || input.lon < -180 || input.lon > 180) {
    throw new RangeError(`Longitude ${input.lon} is out of range`)
  }
  const name = input.name.trim()
  if (name.length === 0) throw new RangeError('A place needs a name')

  return withUser(userId, async (tx) => {
    // Guard 1: exact provider identity.
    const [bySource] = await tx<{ place_id: string }[]>`
      SELECT place_id FROM place_sources
      WHERE provider = ${input.source.provider} AND source_id = ${input.source.sourceId}
      LIMIT 1
    `
    if (bySource) {
      return { kind: 'existing' as const, place: await loadPlace(tx, bySource.place_id) }
    }

    // Guard 2: spatial + name heuristic. Reported, never auto-merged.
    if (!opts.allowDuplicate) {
      const [near] = await tx<{ id: string; distance_meters: number; similarity: number }[]>`
        SELECT p.id,
               ST_Distance(p.coord, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography)
                 AS distance_meters,
               similarity(p.canonical_name, ${name}) AS similarity
        FROM places p
        WHERE ST_DWithin(
                p.coord,
                ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography,
                ${DUPLICATE_RADIUS_METERS}
              )
          AND similarity(p.canonical_name, ${name}) >= ${DUPLICATE_NAME_SIMILARITY}
        ORDER BY similarity DESC, distance_meters ASC
        LIMIT 1
      `

      if (near) {
        return {
          kind: 'possible-duplicate' as const,
          candidate: await loadPlace(tx, near.id),
          distanceMeters: Math.round(near.distance_meters),
          nameSimilarity: Number(near.similarity),
        }
      }
    }

    const placeId = uuidv7()
    await tx`
      INSERT INTO places (id, canonical_name, coord, categories, address, iana_zone)
      VALUES (${placeId}, ${name},
              ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography,
              ${input.categories ?? []}, ${JSON.stringify(input.address ?? {})},
              ${input.ianaZone ?? null})
    `
    await tx`
      INSERT INTO place_sources (id, place_id, provider, source_id, source_url, licence, attribution)
      VALUES (${uuidv7()}, ${placeId}, ${input.source.provider}, ${input.source.sourceId},
              ${input.source.sourceUrl ?? null}, ${input.source.licence ?? null},
              ${input.source.attribution ?? null})
    `

    return { kind: 'created' as const, place: await loadPlace(tx, placeId) }
  })
}

async function loadPlace(tx: Sql, placeId: string): Promise<Place> {
  const [row] = await tx<
    {
      id: string
      canonical_name: string
      lat: number
      lon: number
      categories: string[]
      opening_hours_confidence: Place['openingHoursConfidence']
    }[]
  >`
    SELECT id, canonical_name, categories, opening_hours_confidence,
           ST_Y(coord::geometry) AS lat, ST_X(coord::geometry) AS lon
    FROM places WHERE id = ${placeId}
  `
  if (!row) throw new Error(`Place ${placeId} not found`)

  const sources = await tx<
    { provider: string; source_id: string; licence: string | null; attribution: string | null }[]
  >`
    SELECT provider, source_id, licence, attribution FROM place_sources WHERE place_id = ${placeId}
  `

  return {
    id: row.id,
    name: row.canonical_name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    categories: row.categories,
    openingHoursConfidence: row.opening_hours_confidence,
    sources: sources.map((s) => ({
      provider: s.provider,
      sourceId: s.source_id,
      licence: s.licence,
      attribution: s.attribution,
    })),
  }
}

// ---------------------------------------------------------------------------
// Saved places
// ---------------------------------------------------------------------------

export type SaveOutcome =
  | { readonly kind: 'saved'; readonly savedPlaceId: string }
  | { readonly kind: 'already-saved' }
  | { readonly kind: 'forbidden' }

/**
 * Save a place to a trip.
 *
 * `(user_id, trip_id, place_id)` is unique, so saving twice is idempotent rather
 * than an error — a double tap on a slow connection should not produce two pins.
 */
export async function savePlaceToTrip(
  userId: string,
  tripId: string,
  placeId: string,
  note?: string,
): Promise<SaveOutcome> {
  return withUser(userId, async (tx) => {
    const [membership] = await tx<{ role: string }[]>`
      SELECT role FROM trip_members WHERE trip_id = ${tripId} AND user_id = ${userId}
    `
    if (!membership || membership.role === 'VIEWER') return { kind: 'forbidden' as const }

    const savedId = uuidv7()
    const rows = await tx`
      INSERT INTO saved_places (id, user_id, trip_id, place_id, note)
      VALUES (${savedId}, ${userId}, ${tripId}, ${placeId}, ${note ?? null})
      ON CONFLICT (user_id, trip_id, place_id) DO NOTHING
      RETURNING id
    `
    return rows.length > 0
      ? { kind: 'saved' as const, savedPlaceId: savedId }
      : { kind: 'already-saved' as const }
  })
}

export async function listSavedPlaces(userId: string, tripId: string): Promise<Place[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx<{ place_id: string }[]>`
      SELECT place_id FROM saved_places WHERE trip_id = ${tripId} ORDER BY created_at
    `
    const places: Place[] = []
    for (const r of rows) places.push(await loadPlace(tx, r.place_id))
    return places
  })
}

/**
 * Find places near a point.
 *
 * Uses the system connection: `places` is shared reference data, and a GiST
 * index on `coord` makes this a bounded index scan rather than a table sweep.
 */
export async function placesNear(
  lon: number,
  lat: number,
  radiusMeters: number,
  limit = 20,
): Promise<{ id: string; name: string; distanceMeters: number }[]> {
  const sql = systemDb()
  const rows = await sql<{ id: string; canonical_name: string; distance_meters: number }[]>`
    SELECT id, canonical_name,
           ST_Distance(coord, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography)
             AS distance_meters
    FROM places
    WHERE ST_DWithin(coord, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${radiusMeters})
    ORDER BY distance_meters
    LIMIT ${limit}
  `
  return rows.map((r) => ({
    id: r.id,
    name: r.canonical_name,
    distanceMeters: Math.round(r.distance_meters),
  }))
}
