import { closeDb, initDb, systemDb } from '@travelplus/db'
import { uuidv7 } from '@travelplus/domain'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DUPLICATE_RADIUS_METERS,
  listSavedPlaces,
  placesNear,
  savePlaceToTrip,
  upsertPlace,
  type PlaceInput,
} from './service.js'
import { createTrip } from '../trips/service.js'

/**
 * Places against a real PostGIS.
 *
 * Duplicate detection is the point of this suite, and it depends on two things
 * a mock cannot provide: `ST_DWithin` over a geography column with a GiST index,
 * and `similarity()` from pg_trgm. Testing it against fakes would test the fake.
 */

const APP_URL =
  process.env.DATABASE_URL_APP ??
  'postgres://travelplus_app:travelplus_dev_only@127.0.0.1:5433/travelplus'
const MIGRATOR_URL =
  process.env.DATABASE_URL ??
  'postgres://travelplus_migrator:travelplus_dev_only@127.0.0.1:5433/travelplus'

const NOW = new Date('2026-08-20T10:00:00Z')
const user = uuidv7()
const viewer = uuidv7()

/** Pasar Seni LRT station, Kuala Lumpur. */
const PASAR_SENI = { lat: 3.1427, lon: 101.6958 }
/** ~35 m away — inside the duplicate radius. */
const NEXT_DOOR = { lat: 3.14301, lon: 101.6958 }
/** ~500 m away — comfortably outside it. */
const FAR = { lat: 3.1472, lon: 101.6958 }

/**
 * Each fixture lands at its own coordinate by default.
 *
 * Without this, every ITEST place sits on the same point and the shared "ITEST "
 * prefix pushes trigram similarity over the threshold — so unrelated tests start
 * flagging each other as duplicates. That is the detector working correctly and
 * the fixtures being wrong. Tests that need a collision pin the coordinate
 * explicitly.
 */
let fixtureIndex = 0
function place(over: Partial<PlaceInput> = {}): PlaceInput {
  fixtureIndex += 1
  // ~0.01 degrees latitude is roughly 1.1 km — well outside DUPLICATE_RADIUS_METERS.
  const spread = fixtureIndex * 0.01
  return {
    name: 'Pasar Seni',
    lat: PASAR_SENI.lat + spread,
    lon: PASAR_SENI.lon,
    source: { provider: 'OSM', sourceId: `node/${uuidv7()}` },
    ...over,
  }
}

/** A fixture pinned to a shared point, for tests that WANT a collision. */
function placeAt(name: string, at = PASAR_SENI): PlaceInput {
  return {
    name,
    lat: at.lat,
    lon: at.lon,
    source: { provider: 'OSM', sourceId: `node/${uuidv7()}` },
  }
}

beforeAll(async () => {
  initDb({ appUrl: APP_URL, systemUrl: MIGRATOR_URL })
  await systemDb().unsafe(`
    INSERT INTO users (id, email, password_hash) VALUES
      ('${user}',   'p-${user}@itest.invalid',   'x'),
      ('${viewer}', 'pv-${viewer}@itest.invalid', 'x');
  `)
})

afterAll(async () => {
  const sql = systemDb()
  await sql.unsafe(`
    DELETE FROM saved_places WHERE user_id IN ('${user}','${viewer}');
    DELETE FROM place_sources WHERE place_id IN (SELECT id FROM places WHERE canonical_name ~ '^(ITEST|Pasar Seni|Central Market|Alpha|Beta|Gamma|Delta|Bakery Alpha|Zeta)');
    DELETE FROM places WHERE canonical_name ~ '^(ITEST|Pasar Seni|Central Market|Alpha|Beta|Gamma|Delta|Bakery Alpha|Zeta)';
    DELETE FROM trip_preferences WHERE trip_id IN (SELECT id FROM trips WHERE owner_id IN ('${user}','${viewer}'));
    DELETE FROM trip_members WHERE trip_id IN (SELECT id FROM trips WHERE owner_id IN ('${user}','${viewer}'));
    DELETE FROM trips WHERE owner_id IN ('${user}','${viewer}');
    DELETE FROM users WHERE id IN ('${user}','${viewer}');
  `)
  await closeDb()
})

describe('creating a place', () => {
  it('creates a place with its source', async () => {
    const result = await upsertPlace(user, place({ name: 'ITEST Museum' }))
    expect(result.kind).toBe('created')
    if (result.kind !== 'created') return

    expect(result.place.name).toBe('ITEST Museum')
    expect(result.place.sources).toHaveLength(1)
    expect(result.place.sources[0]!.provider).toBe('OSM')
  })

  it('round-trips coordinates through PostGIS', async () => {
    const result = await upsertPlace(user, placeAt('ITEST Coords Probe'))
    if (result.kind !== 'created') throw new Error('expected created')
    expect(result.place.lat).toBeCloseTo(PASAR_SENI.lat, 5)
    expect(result.place.lon).toBeCloseTo(PASAR_SENI.lon, 5)
  })

  it('defaults opening-hour confidence to UNKNOWN, which never renders as open', async () => {
    const result = await upsertPlace(user, place({ name: 'ITEST Hours' }))
    if (result.kind !== 'created') throw new Error('expected created')
    expect(result.place.openingHoursConfidence).toBe('UNKNOWN')
  })

  it('rejects out-of-range coordinates and empty names', async () => {
    await expect(upsertPlace(user, place({ lat: 91 }))).rejects.toThrow(RangeError)
    await expect(upsertPlace(user, place({ lon: -181 }))).rejects.toThrow(RangeError)
    await expect(upsertPlace(user, place({ name: '  ' }))).rejects.toThrow(RangeError)
  })
})

/**
 * The schema has no column for any of these. A field that cannot be stored
 * cannot be fabricated, which is stronger than a rule saying not to.
 */
describe('there is nowhere to put an invented attribute', () => {
  it('has no rating, review, popularity, price or phone column on places', async () => {
    const rows = await systemDb()<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'places'
    `
    const columns = rows.map((r) => r.column_name.toLowerCase())
    for (const forbidden of [
      'rating',
      'review',
      'reviews',
      'popularity',
      'price',
      'price_level',
      'phone',
    ]) {
      expect(columns, `places.${forbidden} must not exist`).not.toContain(forbidden)
    }
  })
})

/**
 * Guard 1: exact provider identity. Certain, so it resolves silently.
 */
describe('duplicate detection by provider identity', () => {
  it('returns the existing place when the same source id is seen again', async () => {
    const sourceId = `node/${uuidv7()}`
    const first = await upsertPlace(
      user,
      place({ name: 'ITEST Identity', source: { provider: 'OSM', sourceId } }),
    )
    if (first.kind !== 'created') throw new Error('expected created')

    const second = await upsertPlace(
      user,
      place({ name: 'ITEST Identity renamed', source: { provider: 'OSM', sourceId } }),
    )
    expect(second.kind).toBe('existing')
    if (second.kind !== 'existing') return
    expect(second.place.id).toBe(first.place.id)
  })

  it('creates no second row for a repeated source id', async () => {
    const sourceId = `node/${uuidv7()}`
    await upsertPlace(user, place({ name: 'ITEST Once', source: { provider: 'OSM', sourceId } }))
    await upsertPlace(user, place({ name: 'ITEST Once', source: { provider: 'OSM', sourceId } }))

    const rows = await systemDb()`SELECT id FROM place_sources WHERE source_id = ${sourceId}`
    expect(rows).toHaveLength(1)
  })

  it('treats the same id from a different provider as a different place', async () => {
    const sharedId = `12345-${uuidv7()}`
    const a = await upsertPlace(
      user,
      place({ name: 'ITEST ProvA', source: { provider: 'OSM', sourceId: sharedId } }),
    )
    const b = await upsertPlace(
      user,
      place({
        name: 'ITEST ProvB',
        lat: FAR.lat,
        lon: FAR.lon,
        source: { provider: 'WIKIDATA', sourceId: sharedId },
      }),
    )
    expect(a.kind).toBe('created')
    expect(b.kind).toBe('created')
  })
})

/**
 * Guard 2: the spatial + name heuristic. It REPORTS rather than merging, because
 * auto-merging on a guess is how two distinct places quietly become one and a
 * user's saved note lands on the wrong pin.
 */
describe('fuzzy duplicate detection reports, never merges', () => {
  it('flags a near-identical name at the same coordinates', async () => {
    await upsertPlace(user, placeAt('Central Market Kuala Lumpur'))

    const result = await upsertPlace(user, placeAt('Central Market'))
    expect(result.kind).toBe('possible-duplicate')
    if (result.kind !== 'possible-duplicate') return

    expect(result.distanceMeters).toBeLessThan(DUPLICATE_RADIUS_METERS)
    expect(result.nameSimilarity).toBeGreaterThan(0.4)
  })

  it('writes nothing when a duplicate is reported', async () => {
    const before = await systemDb()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM places WHERE canonical_name LIKE 'Central Market%'
    `
    const result = await upsertPlace(user, placeAt('Central Market KL'))
    expect(result.kind).toBe('possible-duplicate')

    const after = await systemDb()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM places WHERE canonical_name LIKE 'Central Market%'
    `
    expect(after[0]!.n).toBe(before[0]!.n)
  })

  // Two cafés 500 m apart with the same name are different cafés.
  it('does not flag a same-named place outside the radius', async () => {
    await upsertPlace(user, placeAt('ITEST Kopitiam Ampang'))
    const far = await upsertPlace(user, placeAt('ITEST Kopitiam Ampang', FAR))
    expect(far.kind).toBe('created')
  })

  // Two unrelated businesses next door to each other are different businesses.
  it('does not flag a dissimilar name inside the radius', async () => {
    await upsertPlace(user, placeAt('Bakery Alpha Bread'))
    const other = await upsertPlace(user, placeAt('Zeta Hardware Warehouse', NEXT_DOOR))
    expect(other.kind).toBe('created')
  })

  it('creates anyway when the caller has confirmed it is genuinely distinct', async () => {
    await upsertPlace(user, placeAt('ITEST Twin Towers Plaza'))
    const forced = await upsertPlace(user, placeAt('ITEST Twin Towers Plaza'), {
      allowDuplicate: true,
    })
    expect(forced.kind).toBe('created')
  })
})

describe('saving places to a trip', () => {
  async function tripFor(owner: string) {
    const t = await createTrip(owner, { title: 'Places trip' }, NOW)
    if (!t.ok) throw new Error('setup failed')
    return t.value.id
  }

  it('saves a place and lists it', async () => {
    const tripId = await tripFor(user)
    const created = await upsertPlace(user, place({ name: 'ITEST Saved' }))
    if (created.kind !== 'created') throw new Error('expected created')

    const saved = await savePlaceToTrip(user, tripId, created.place.id, 'Try the laksa')
    expect(saved.kind).toBe('saved')

    const list = await listSavedPlaces(user, tripId)
    expect(list.map((p) => p.id)).toContain(created.place.id)
  })

  // A double tap on a slow connection must not produce two pins.
  it('is idempotent when the same place is saved twice', async () => {
    const tripId = await tripFor(user)
    const created = await upsertPlace(user, place({ name: 'ITEST Idempotent' }))
    if (created.kind !== 'created') throw new Error('expected created')

    await savePlaceToTrip(user, tripId, created.place.id)
    const second = await savePlaceToTrip(user, tripId, created.place.id)
    expect(second.kind).toBe('already-saved')

    const list = await listSavedPlaces(user, tripId)
    expect(list.filter((p) => p.id === created.place.id)).toHaveLength(1)
  })

  it('refuses a viewer saving to the trip', async () => {
    const tripId = await tripFor(user)
    await systemDb()`
      INSERT INTO trip_members (trip_id, user_id, role) VALUES (${tripId}, ${viewer}, 'VIEWER')
    `
    const created = await upsertPlace(user, place({ name: 'ITEST ViewerBlocked' }))
    if (created.kind !== 'created') throw new Error('expected created')

    const result = await savePlaceToTrip(viewer, tripId, created.place.id)
    expect(result.kind).toBe('forbidden')
  })

  it('refuses a non-member saving to the trip', async () => {
    const tripId = await tripFor(user)
    const created = await upsertPlace(user, place({ name: 'ITEST StrangerBlocked' }))
    if (created.kind !== 'created') throw new Error('expected created')

    const stranger = uuidv7()
    await systemDb()`
      INSERT INTO users (id, email, password_hash)
      VALUES (${stranger}, ${`s-${stranger}@itest.invalid`}, 'x')
    `
    const result = await savePlaceToTrip(stranger, tripId, created.place.id)
    expect(result.kind).toBe('forbidden')
    await systemDb()`DELETE FROM users WHERE id = ${stranger}`
  })
})

describe('spatial search', () => {
  it('finds places within a radius, nearest first', async () => {
    await upsertPlace(user, placeAt('Alpha Search Anchor'))
    await upsertPlace(user, placeAt('Beta Search Neighbour', NEXT_DOOR), { allowDuplicate: true })

    const found = await placesNear(PASAR_SENI.lon, PASAR_SENI.lat, 200)
    const names = found.map((f) => f.name)
    expect(names).toContain('Alpha Search Anchor')

    const distances = found.map((f) => f.distanceMeters)
    expect([...distances].sort((a, b) => a - b)).toEqual(distances)
  })

  it('excludes places outside the radius', async () => {
    await upsertPlace(user, placeAt('Gamma Far Away', FAR))
    const found = await placesNear(PASAR_SENI.lon, PASAR_SENI.lat, 100)
    expect(found.map((f) => f.name)).not.toContain('Gamma Far Away')
  })

  it('reports distances that match the real separation', async () => {
    await upsertPlace(user, placeAt('Delta Distance Probe'))
    const found = await placesNear(NEXT_DOOR.lon, NEXT_DOOR.lat, 500)
    const target = found.find((f) => f.name === 'Delta Distance Probe')
    expect(target).toBeDefined()
    // ~35 m apart by construction.
    expect(target!.distanceMeters).toBeGreaterThan(20)
    expect(target!.distanceMeters).toBeLessThan(60)
  })
})
