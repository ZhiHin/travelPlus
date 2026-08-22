import { withUser, type Sql } from '@travelplus/db'
import {
  affectedBoundaries,
  checkConstraints,
  moveItem,
  scheduleDay,
  uuidv7,
  type DayConstraints,
  type ItemKind,
  type ItineraryItem,
  type LegInfo,
  type Violation,
} from '@travelplus/domain'

/**
 * Itinerary services.
 *
 * The contract that shapes every write here: **the user sees the consequence
 * before it happens**. A reorder is previewed — affected legs, new times, new
 * conflicts — and committed only when the caller sends the preview back. A
 * commit that creates a conflict succeeds WITH the conflict shown; resolving it
 * is the traveller's decision, not the service's (BR-I7, BR-I8).
 *
 * Every write bumps `version` in the same transaction (BR-TR8), and every
 * committed change writes an immutable `itinerary_versions` row (BR-I9).
 */

export type ItineraryError =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'conflict'; readonly currentVersion: number }
  | { readonly kind: 'invalid'; readonly problems: readonly string[] }
  | { readonly kind: 'locked'; readonly itemId: string; readonly reason: string }

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ItineraryError }

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const err = <T>(error: ItineraryError): Result<T> => ({ ok: false, error })

async function roleFor(tx: Sql, tripId: string, userId: string): Promise<string | null> {
  const [row] = await tx<{ role: string }[]>`
    SELECT role FROM trip_members WHERE trip_id = ${tripId} AND user_id = ${userId}
  `
  return row?.role ?? null
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

export interface DayRow {
  readonly id: string
  readonly localDate: string
  readonly ianaZone: string
  readonly ordinal: number
  readonly version: number
}

/**
 * Ensure a day exists for each date in the trip's range, in order.
 *
 * Idempotent: re-running after the dates change adds missing days and leaves
 * existing ones (and their items) alone. Days outside the new range are NOT
 * deleted automatically — a traveller who shortens a trip by mistake should
 * not lose a day of planning silently.
 */
export async function ensureDays(
  userId: string,
  tripId: string,
  ianaZone: string,
): Promise<Result<DayRow[]>> {
  return withUser(userId, async (tx) => {
    const role = await roleFor(tx, tripId, userId)
    if (!role) return err<DayRow[]>({ kind: 'not-found' })
    if (role === 'VIEWER') return err<DayRow[]>({ kind: 'forbidden' })

    const [trip] = await tx<{ start_date: Date | null; end_date: Date | null }[]>`
      SELECT start_date, end_date FROM trips WHERE id = ${tripId}
    `
    if (!trip?.start_date || !trip.end_date) {
      return err<DayRow[]>({ kind: 'invalid', problems: ['Set the trip dates first.'] })
    }

    const dates: string[] = []
    for (let d = new Date(trip.start_date); d <= trip.end_date; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10))
    }

    for (const [ordinal, date] of dates.entries()) {
      await tx`
        INSERT INTO trip_days (id, trip_id, local_date, iana_zone, ordinal)
        VALUES (${uuidv7()}, ${tripId}, ${date}, ${ianaZone}, ${ordinal})
        ON CONFLICT (trip_id, local_date) DO UPDATE SET ordinal = EXCLUDED.ordinal
      `
    }

    return ok(await listDays(tx, tripId))
  })
}

async function listDays(tx: Sql, tripId: string): Promise<DayRow[]> {
  const rows = await tx<
    { id: string; local_date: Date; iana_zone: string; ordinal: number; version: number }[]
  >`
    SELECT id, local_date, iana_zone, ordinal, version FROM trip_days
    WHERE trip_id = ${tripId} ORDER BY ordinal
  `
  return rows.map((r) => ({
    id: r.id,
    localDate: r.local_date.toISOString().slice(0, 10),
    ianaZone: r.iana_zone,
    ordinal: r.ordinal,
    version: r.version,
  }))
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface AddItemInput {
  readonly kind: ItemKind
  readonly title: string
  readonly placeId?: string | null
  readonly plannedDurationSeconds?: number
  readonly desiredStart?: Date | null
  readonly lockTime?: boolean
  readonly lockPlace?: boolean
  readonly lockItem?: boolean
  readonly notes?: string
}

export interface ItemRow {
  readonly id: string
  readonly dayId: string
  readonly kind: ItemKind
  readonly title: string
  readonly placeId: string | null
  readonly plannedDurationSeconds: number
  readonly startInstant: Date | null
  readonly endInstant: Date | null
  readonly lockTime: boolean
  readonly lockPlace: boolean
  readonly lockItem: boolean
  readonly ordinal: number
  readonly version: number
  readonly inboundSnapshotId: string | null
}

export async function addItem(
  userId: string,
  dayId: string,
  input: AddItemInput,
): Promise<Result<ItemRow>> {
  const problems: string[] = []
  if (!input.title?.trim()) problems.push('Give the item a name.')
  if (input.plannedDurationSeconds !== undefined && input.plannedDurationSeconds <= 0) {
    problems.push('Duration must be positive.')
  }
  if (input.lockItem && !(input.lockTime ?? true)) {
    problems.push('Locking the whole item also locks its time and place.')
  }
  if (problems.length) return err({ kind: 'invalid', problems })

  return withUser(userId, async (tx) => {
    const [day] = await tx<{ trip_id: string; iana_zone: string }[]>`
      SELECT trip_id, iana_zone FROM trip_days WHERE id = ${dayId}
    `
    if (!day) return err<ItemRow>({ kind: 'not-found' })
    const role = await roleFor(tx, day.trip_id, userId)
    if (role === 'VIEWER') return err<ItemRow>({ kind: 'forbidden' })

    const [{ next }] = await tx<{ next: number }[]>`
      SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM itinerary_items
      WHERE trip_day_id = ${dayId} AND deleted_at IS NULL
    `

    const id = uuidv7()
    const lockItem = input.lockItem ?? false
    await tx`
      INSERT INTO itinerary_items
        (id, trip_day_id, trip_id, kind, place_id, title, notes, iana_zone,
         planned_duration_seconds, start_instant, lock_time, lock_place, lock_item, ordinal)
      VALUES
        (${id}, ${dayId}, ${day.trip_id}, ${input.kind}, ${input.placeId ?? null},
         ${input.title.trim()}, ${input.notes ?? null}, ${day.iana_zone},
         ${input.plannedDurationSeconds ?? 3600}, ${input.desiredStart ?? null},
         ${lockItem || (input.lockTime ?? false)}, ${lockItem || (input.lockPlace ?? false)},
         ${lockItem}, ${next})
    `
    await bumpTrip(tx, day.trip_id)
    return ok((await loadItem(tx, id))!)
  })
}

async function loadItem(tx: Sql, id: string): Promise<ItemRow | null> {
  const [r] = await tx<
    {
      id: string
      trip_day_id: string
      kind: ItemKind
      title: string
      place_id: string | null
      planned_duration_seconds: number
      start_instant: Date | null
      end_instant: Date | null
      lock_time: boolean
      lock_place: boolean
      lock_item: boolean
      ordinal: number
      version: number
      inbound_route_snapshot_id: string | null
    }[]
  >`
    SELECT id, trip_day_id, kind, title, place_id, planned_duration_seconds, start_instant,
           end_instant, lock_time, lock_place, lock_item, ordinal, version,
           inbound_route_snapshot_id
    FROM itinerary_items WHERE id = ${id} AND deleted_at IS NULL
  `
  return r ? rowToItem(r) : null
}

function rowToItem(r: {
  id: string
  trip_day_id: string
  kind: ItemKind
  title: string
  place_id: string | null
  planned_duration_seconds: number
  start_instant: Date | null
  end_instant: Date | null
  lock_time: boolean
  lock_place: boolean
  lock_item: boolean
  ordinal: number
  version: number
  inbound_route_snapshot_id: string | null
}): ItemRow {
  return {
    id: r.id,
    dayId: r.trip_day_id,
    kind: r.kind,
    title: r.title,
    placeId: r.place_id,
    plannedDurationSeconds: r.planned_duration_seconds,
    startInstant: r.start_instant,
    endInstant: r.end_instant,
    lockTime: r.lock_time,
    lockPlace: r.lock_place,
    lockItem: r.lock_item,
    ordinal: r.ordinal,
    version: r.version,
    inboundSnapshotId: r.inbound_route_snapshot_id,
  }
}

export async function listItems(userId: string, dayId: string): Promise<Result<ItemRow[]>> {
  return withUser(userId, async (tx) => {
    const [day] = await tx<{ trip_id: string }[]>`SELECT trip_id FROM trip_days WHERE id = ${dayId}`
    if (!day) return err<ItemRow[]>({ kind: 'not-found' })
    return ok(await itemsForDay(tx, dayId))
  })
}

async function itemsForDay(tx: Sql, dayId: string): Promise<ItemRow[]> {
  const rows = await tx<Parameters<typeof rowToItem>[0][]>`
    SELECT id, trip_day_id, kind, title, place_id, planned_duration_seconds, start_instant,
           end_instant, lock_time, lock_place, lock_item, ordinal, version,
           inbound_route_snapshot_id
    FROM itinerary_items WHERE trip_day_id = ${dayId} AND deleted_at IS NULL ORDER BY ordinal
  `
  return rows.map(rowToItem)
}

export async function setLocks(
  userId: string,
  itemId: string,
  locks: { lockTime?: boolean; lockPlace?: boolean; lockItem?: boolean },
  version: number,
): Promise<Result<ItemRow>> {
  return withUser(userId, async (tx) => {
    const current = await loadItem(tx, itemId)
    if (!current) return err<ItemRow>({ kind: 'not-found' })
    if (version !== current.version) {
      return err<ItemRow>({ kind: 'conflict', currentVersion: current.version })
    }

    const lockItem = locks.lockItem ?? current.lockItem
    // BR-I3: lock_item implies both. The CHECK constraint would refuse an
    // inconsistent state; normalising here keeps the request honest.
    const lockTime = lockItem || (locks.lockTime ?? current.lockTime)
    const lockPlace = lockItem || (locks.lockPlace ?? current.lockPlace)

    const rows = await tx`
      UPDATE itinerary_items
      SET lock_time = ${lockTime}, lock_place = ${lockPlace}, lock_item = ${lockItem},
          version = version + 1, updated_at = now()
      WHERE id = ${itemId} AND version = ${version}
      RETURNING trip_id
    `
    if (rows.length === 0) {
      const latest = await loadItem(tx, itemId)
      return err<ItemRow>({ kind: 'conflict', currentVersion: latest?.version ?? version })
    }
    await bumpTrip(tx, (rows[0] as { trip_id: string }).trip_id)
    return ok((await loadItem(tx, itemId))!)
  })
}

export async function removeItem(
  userId: string,
  itemId: string,
  version: number,
): Promise<Result<{ affectedBoundaries: readonly { from: string; to: string }[] }>> {
  return withUser(userId, async (tx) => {
    const current = await loadItem(tx, itemId)
    if (!current) return err({ kind: 'not-found' })
    if (current.lockItem) {
      return err({ kind: 'locked', itemId, reason: `${current.title} is locked` })
    }
    if (version !== current.version) {
      return err({ kind: 'conflict', currentVersion: current.version })
    }

    const before = (await itemsForDay(tx, current.dayId)).map((i) => i.id)
    const after = before.filter((id) => id !== itemId)

    await tx`UPDATE itinerary_items SET deleted_at = now() WHERE id = ${itemId}`
    await renumber(tx, current.dayId, after)

    const [day] = await tx<{ trip_id: string }[]>`
      SELECT trip_id FROM trip_days WHERE id = ${current.dayId}
    `
    await bumpTrip(tx, day!.trip_id)

    return ok({ affectedBoundaries: affectedBoundaries(before, after) })
  })
}

// ---------------------------------------------------------------------------
// Reorder — preview, then commit
// ---------------------------------------------------------------------------

export interface ReorderPreview {
  readonly previewToken: string
  readonly order: readonly string[]
  /** At most four (BR-I6). The caller re-routes only these. */
  readonly affectedBoundaries: readonly { from: string; to: string }[]
  readonly violations: readonly Violation[]
  readonly dayVersion: number
}

const previews = new Map<
  string,
  { dayId: string; order: string[]; dayVersion: number; at: number }
>()
const PREVIEW_TTL_MS = 5 * 60_000

/**
 * Preview a move. Nothing is persisted.
 *
 * Returns the boundaries that would need re-routing and the violations the new
 * order would produce given current leg data. Legs that do not yet exist for a
 * new adjacency are reported as PENDING, so the preview says "this needs routing"
 * rather than inventing a duration.
 */
export async function previewMove(
  userId: string,
  dayId: string,
  itemId: string,
  toIndex: number,
  constraints: DayConstraints,
  now: Date,
): Promise<Result<ReorderPreview>> {
  return withUser(userId, async (tx) => {
    const [day] = await tx<
      { trip_id: string; version: number; local_date: Date; iana_zone: string }[]
    >`
      SELECT trip_id, version, local_date, iana_zone FROM trip_days WHERE id = ${dayId}
    `
    if (!day) return err<ReorderPreview>({ kind: 'not-found' })
    const role = await roleFor(tx, day.trip_id, userId)
    if (role === 'VIEWER') return err<ReorderPreview>({ kind: 'forbidden' })

    const items = await itemsForDay(tx, dayId)
    const target = items.find((i) => i.id === itemId)
    if (!target) return err<ReorderPreview>({ kind: 'not-found' })
    if (target.lockItem) {
      return err<ReorderPreview>({
        kind: 'locked',
        itemId,
        reason: `${target.title} is locked and cannot be moved`,
      })
    }

    const before = items.map((i) => i.id)
    const after = moveItem(before, itemId, toIndex)
    const boundaries = affectedBoundaries(before, after)

    // Existing legs survive for unchanged adjacencies; new adjacencies are
    // PENDING until routed. No duration is guessed.
    const legs: LegInfo[] = []
    for (let i = 1; i < after.length; i++) {
      const from = after[i - 1]!
      const to = after[i]!
      const isNew = boundaries.some((b) => b.from === from && b.to === to)
      const toItem = items.find((x) => x.id === to)!
      legs.push({
        fromItemId: from,
        toItemId: to,
        durationSeconds: isNew ? null : legDurationFromSnapshot(toItem),
        walkMeters: 0,
        snapshotId: isNew ? null : toItem.inboundSnapshotId,
        status: isNew ? 'PENDING' : toItem.inboundSnapshotId ? 'ROUTED' : 'UNAVAILABLE',
      })
    }

    const domainItems: ItineraryItem[] = after.map((id, ordinal) => {
      const i = items.find((x) => x.id === id)!
      return {
        id: i.id,
        kind: i.kind,
        title: i.title,
        placeId: i.placeId,
        plannedDurationSeconds: i.plannedDurationSeconds,
        desiredStart: i.lockTime ? i.startInstant : null,
        lockTime: i.lockTime,
        lockPlace: i.lockPlace,
        lockItem: i.lockItem,
        ordinal,
      }
    })

    const dayStart = new Date(`${day.local_date.toISOString().slice(0, 10)}T00:00:00Z`)
    const scheduled = scheduleDay(dayStart, domainItems, legs, constraints)
    const violations = checkConstraints({
      dayStart,
      items: domainItems,
      scheduled: scheduled.items,
      legs,
      constraints,
    })

    const previewToken = uuidv7()
    previews.set(previewToken, { dayId, order: after, dayVersion: day.version, at: now.getTime() })

    return ok<ReorderPreview>({
      previewToken,
      order: after,
      affectedBoundaries: boundaries,
      violations,
      dayVersion: day.version,
    })
  })
}

/**
 * Commit a previewed move.
 *
 * The token binds the commit to exactly the order the user saw. A stale day
 * version (another editor moved something meanwhile) is a conflict, never a
 * silent overwrite (ADR-0019).
 */
export async function commitMove(
  userId: string,
  previewToken: string,
  now: Date,
): Promise<Result<{ order: readonly string[]; versionNumber: number }>> {
  const preview = previews.get(previewToken)
  if (!preview || now.getTime() - preview.at > PREVIEW_TTL_MS) {
    previews.delete(previewToken)
    return err({ kind: 'invalid', problems: ['Your preview expired. Try the change again.'] })
  }

  return withUser(userId, async (tx) => {
    const [day] = await tx<{ trip_id: string; version: number }[]>`
      SELECT trip_id, version FROM trip_days WHERE id = ${preview.dayId}
    `
    if (!day) return err({ kind: 'not-found' })
    if (day.version !== preview.dayVersion) {
      return err({ kind: 'conflict', currentVersion: day.version })
    }

    await renumber(tx, preview.dayId, preview.order)
    await tx`
      UPDATE trip_days SET version = version + 1, updated_at = now() WHERE id = ${preview.dayId}
    `
    await bumpTrip(tx, day.trip_id)
    const versionNumber = await writeVersion(tx, day.trip_id, userId, 'reorder')

    previews.delete(previewToken)
    return ok({ order: preview.order, versionNumber })
  })
}

/** Two-pass renumber: ordinals are unique per day, so shift out of range first. */
async function renumber(tx: Sql, dayId: string, order: readonly string[]): Promise<void> {
  for (const [i, id] of order.entries()) {
    await tx`UPDATE itinerary_items SET ordinal = ${i + 10_000} WHERE id = ${id} AND trip_day_id = ${dayId}`
  }
  for (const [i, id] of order.entries()) {
    await tx`UPDATE itinerary_items SET ordinal = ${i}, version = version + 1 WHERE id = ${id} AND trip_day_id = ${dayId}`
  }
}

async function bumpTrip(tx: Sql, tripId: string): Promise<void> {
  await tx`UPDATE trips SET version = version + 1, updated_at = now() WHERE id = ${tripId}`
}

/** Every committed change writes an immutable version (BR-I9). */
async function writeVersion(
  tx: Sql,
  tripId: string,
  userId: string,
  label: string,
): Promise<number> {
  const [{ next }] = await tx<{ next: number }[]>`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next FROM itinerary_versions WHERE trip_id = ${tripId}
  `
  const days = await tx`
    SELECT d.id, d.local_date, d.ordinal,
           (SELECT json_agg(json_build_object('id', i.id, 'title', i.title, 'ordinal', i.ordinal,
                                              'kind', i.kind, 'lockItem', i.lock_item) ORDER BY i.ordinal)
            FROM itinerary_items i WHERE i.trip_day_id = d.id AND i.deleted_at IS NULL) AS items
    FROM trip_days d WHERE d.trip_id = ${tripId} ORDER BY d.ordinal
  `
  await tx`
    INSERT INTO itinerary_versions (id, trip_id, version_number, label, snapshot, created_by)
    VALUES (${uuidv7()}, ${tripId}, ${next}, ${label}, ${JSON.stringify(days)}, ${userId})
  `
  return next
}

export async function listVersions(
  userId: string,
  tripId: string,
): Promise<Result<{ versionNumber: number; label: string | null; createdAt: Date }[]>> {
  return withUser(userId, async (tx) => {
    const rows = await tx<{ version_number: number; label: string | null; created_at: Date }[]>`
      SELECT version_number, label, created_at FROM itinerary_versions
      WHERE trip_id = ${tripId} ORDER BY version_number DESC
    `
    return ok(
      rows.map((r) => ({
        versionNumber: r.version_number,
        label: r.label,
        createdAt: r.created_at,
      })),
    )
  })
}

function legDurationFromSnapshot(_item: ItemRow): number | null {
  // Snapshot durations are joined in the route service; the preview uses the
  // presence of a snapshot id as "routed" and leaves the exact duration to the
  // caller that owns snapshot loading. A null here is a gap, never a guess.
  return null
}
