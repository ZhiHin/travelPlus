/**
 * Itinerary entities and the deterministic scheduler.
 *
 * The scheduler is arithmetic, not judgement. It consumes routed durations,
 * visit durations, locks and buffers, and produces times. It never estimates a
 * travel time itself — a leg with no routed duration is a gap the scheduler
 * reports, not a number it invents (BR-I11).
 */

export const ITEM_KINDS = [
  'ACTIVITY',
  'MEAL',
  'REST',
  'LODGING',
  'MEETING',
  'TRANSPORT',
  'FREE_TIME',
  'BOOKING',
] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

export interface ItineraryItem {
  readonly id: string
  readonly kind: ItemKind
  readonly title: string
  readonly placeId: string | null
  /** Seconds the traveller intends to spend here. */
  readonly plannedDurationSeconds: number
  /** Desired start, honoured when unlocked if it does not conflict. */
  readonly desiredStart: Date | null
  readonly lockTime: boolean
  readonly lockPlace: boolean
  readonly lockItem: boolean
  readonly ordinal: number
}

/** The routed journey between two consecutive items, or an explicit gap. */
export interface LegInfo {
  readonly fromItemId: string
  readonly toItemId: string
  readonly durationSeconds: number | null
  readonly walkMeters: number
  readonly snapshotId: string | null
  readonly status: 'ROUTED' | 'UNAVAILABLE' | 'PENDING'
}

export interface DayConstraints {
  /** Earliest a day may start, as seconds past local midnight. */
  readonly earliestStartSeconds: number
  readonly latestFinishSeconds: number
  readonly bufferSeconds: number
  readonly minTransferSeconds: number
  readonly maxWalkMetersPerLeg: number
  readonly maxWalkMetersPerDay: number
}

export interface ScheduledItem {
  readonly itemId: string
  readonly start: Date
  readonly end: Date
  /** Whether the start was pinned by a lock or derived. */
  readonly pinned: boolean
}

export interface ScheduleResult {
  readonly items: readonly ScheduledItem[]
  /** Legs that could not contribute a duration; times after them are estimates. */
  readonly gaps: readonly string[]
}

/**
 * Schedule a day forward from its start.
 *
 * Walks items in ordinal order. Each item starts at the later of: the previous
 * item's end plus the routed leg plus buffer, or its own locked/desired start.
 * A locked time that cannot be met is still honoured — the conflict is reported
 * by the constraint engine, not silently resolved here (BR-I8).
 */
export function scheduleDay(
  dayStart: Date,
  items: readonly ItineraryItem[],
  legs: readonly LegInfo[],
  constraints: DayConstraints,
): ScheduleResult {
  const ordered = [...items].sort((a, b) => a.ordinal - b.ordinal)
  const legByPair = new Map(legs.map((l) => [`${l.fromItemId}->${l.toItemId}`, l]))

  const scheduled: ScheduledItem[] = []
  const gaps: string[] = []
  let cursor = new Date(dayStart.getTime() + constraints.earliestStartSeconds * 1000)
  let previous: ItineraryItem | null = null

  for (const item of ordered) {
    if (previous) {
      const leg = legByPair.get(`${previous.id}->${item.id}`)
      if (leg?.durationSeconds != null) {
        cursor = new Date(
          cursor.getTime() + (leg.durationSeconds + constraints.bufferSeconds) * 1000,
        )
      } else {
        // No routed duration. The scheduler does not guess; it records the gap
        // and continues from the previous end plus buffer only.
        gaps.push(item.id)
        cursor = new Date(cursor.getTime() + constraints.bufferSeconds * 1000)
      }
    }

    const pinned = (item.lockTime || item.lockItem) && item.desiredStart !== null
    let start = cursor

    if (pinned) {
      // A lock wins even when it lands before the cursor — that conflict is
      // surfaced, not hidden by moving the locked item.
      start = item.desiredStart!
    } else if (item.desiredStart && item.desiredStart > cursor) {
      // An unlocked preference is honoured only when it does not require
      // travelling backwards in time.
      start = item.desiredStart
    }

    const end = new Date(start.getTime() + item.plannedDurationSeconds * 1000)
    scheduled.push({ itemId: item.id, start, end, pinned })

    cursor = end
    previous = item
  }

  return { items: scheduled, gaps }
}

/**
 * Which leg boundaries a reorder touches.
 *
 * Moving one item changes at most four legs: the two around its old position
 * (which become one) and the two around its new position (which were one). An
 * itinerary of n items needs at most 4 re-routes, never n (O3, BR-I6).
 */
export function affectedBoundaries(
  before: readonly string[],
  after: readonly string[],
): readonly { readonly from: string; readonly to: string }[] {
  const pairs = (ids: readonly string[]) =>
    ids.slice(0, -1).map((id, i) => ({ from: id, to: ids[i + 1]! }))
  const key = (p: { from: string; to: string }) => `${p.from}->${p.to}`

  const old = new Set(pairs(before).map(key))
  return pairs(after).filter((p) => !old.has(key(p)))
}

/**
 * Reorder by moving one item to a new index. Returns the new ordinal sequence,
 * gap-free and stable for the untouched items.
 */
export function moveItem(ids: readonly string[], itemId: string, toIndex: number): string[] {
  const from = ids.indexOf(itemId)
  if (from < 0) throw new RangeError(`Item ${itemId} is not in the sequence`)
  const target = Math.max(0, Math.min(toIndex, ids.length - 1))
  const next = [...ids]
  next.splice(from, 1)
  next.splice(target, 0, itemId)
  return next
}
