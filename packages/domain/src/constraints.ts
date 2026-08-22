import type { DayConstraints, ItineraryItem, LegInfo, ScheduledItem } from './itinerary.js'

/**
 * The constraint engine — the thirteen violation classes from the error
 * taxonomy (17-ERROR-CODES.md).
 *
 * Violations are facts about the world, not errors in the request. The UI
 * renders them as explanations beside the items they concern, and a reorder that
 * creates one still commits — resolving it is the traveller's decision (BR-I8).
 *
 * Two codes are deliberately distinct and must never be merged:
 *   ACCESSIBILITY_UNSATISFIED — there is no step-free route
 *   ACCESSIBILITY_UNKNOWN     — the feed does not say
 * Telling a wheelchair user "we don't know" is honest and actionable. Telling
 * them "no accessible route" when we merely lack data is a worse, different claim.
 */

export const VIOLATION_CODES = [
  'OVERLAP',
  'IMPOSSIBLE_TRANSFER',
  'MAX_WALK_EXCEEDED',
  'PLACE_CLOSED',
  'MISSING_MEAL',
  'INSUFFICIENT_BUFFER',
  'OUTSIDE_USER_HOURS',
  'LOCKED_ITEM_CONFLICT',
  'ACCESSIBILITY_UNSATISFIED',
  'ACCESSIBILITY_UNKNOWN',
  'BUDGET_EXCEEDED',
  'NO_ROUTE_FOUND',
  'UNRESOLVED_PLACE',
] as const
export type ViolationCode = (typeof VIOLATION_CODES)[number]

export interface Violation {
  readonly code: ViolationCode
  /** Items this concerns, so the UI can anchor the explanation. */
  readonly itemIds: readonly string[]
  readonly detail: string
  /** BUDGET_EXCEEDED and the ACCESSIBILITY_UNKNOWN are warnings, never blockers. */
  readonly severity: 'error' | 'warning'
}

export interface PlaceFacts {
  readonly placeId: string
  /** Opening window as seconds past local midnight, when the feed supplied it. */
  readonly opens?: number
  readonly closes?: number
  readonly hoursConfidence: 'FEED' | 'PARSED' | 'USER' | 'UNKNOWN'
}

export interface MealWindow {
  readonly label: string
  readonly fromSeconds: number
  readonly toSeconds: number
}

export interface CheckInput {
  readonly dayStart: Date
  readonly items: readonly ItineraryItem[]
  readonly scheduled: readonly ScheduledItem[]
  readonly legs: readonly LegInfo[]
  readonly constraints: DayConstraints
  readonly places?: readonly PlaceFacts[]
  readonly mealWindows?: readonly MealWindow[]
  readonly requireStepFree?: boolean
  readonly legAccessibility?: ReadonlyMap<string, 'ACCESSIBLE' | 'INACCESSIBLE' | 'UNKNOWN'>
  readonly budget?: {
    readonly limitMinor: number
    readonly spentMinor: number
    readonly currency: string
  }
}

function secondsIntoDay(instant: Date, dayStart: Date): number {
  return (instant.getTime() - dayStart.getTime()) / 1000
}

export function checkConstraints(input: CheckInput): Violation[] {
  const violations: Violation[] = []
  const { constraints, dayStart } = input
  const byId = new Map(input.items.map((i) => [i.id, i]))
  const sched = [...input.scheduled].sort((a, b) => a.start.getTime() - b.start.getTime())
  const ordered = [...input.items].sort((a, b) => a.ordinal - b.ordinal)
  const legByPair = new Map(input.legs.map((l) => [`${l.fromItemId}->${l.toItemId}`, l]))

  // --- OVERLAP and LOCKED_ITEM_CONFLICT ----------------------------------------
  for (let i = 1; i < sched.length; i++) {
    const prev = sched[i - 1]!
    const cur = sched[i]!
    if (cur.start < prev.end) {
      const overlapSeconds = Math.round((prev.end.getTime() - cur.start.getTime()) / 1000)
      const code: ViolationCode = cur.pinned || prev.pinned ? 'LOCKED_ITEM_CONFLICT' : 'OVERLAP'
      violations.push({
        code,
        itemIds: [prev.itemId, cur.itemId],
        detail:
          code === 'LOCKED_ITEM_CONFLICT'
            ? `A locked time cannot be met: ${byId.get(cur.itemId)?.title ?? cur.itemId} overlaps the previous item by ${Math.ceil(overlapSeconds / 60)} min`
            : `${byId.get(cur.itemId)?.title ?? cur.itemId} starts ${Math.ceil(overlapSeconds / 60)} min before the previous item ends`,
        severity: 'error',
      })
    }
  }

  // --- Per-leg checks -----------------------------------------------------------
  let dayWalk = 0
  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1]!
    const to = ordered[i]!
    const leg = legByPair.get(`${from.id}->${to.id}`)
    const fromSched = sched.find((s) => s.itemId === from.id)
    const toSched = sched.find((s) => s.itemId === to.id)

    if (!leg || leg.status === 'UNAVAILABLE') {
      violations.push({
        code: 'NO_ROUTE_FOUND',
        itemIds: [from.id, to.id],
        detail: `No route found from ${from.title} to ${to.title}`,
        severity: 'error',
      })
      continue
    }
    if (leg.status === 'PENDING' || leg.durationSeconds == null) continue

    dayWalk += leg.walkMeters
    if (leg.walkMeters > constraints.maxWalkMetersPerLeg) {
      violations.push({
        code: 'MAX_WALK_EXCEEDED',
        itemIds: [from.id, to.id],
        detail: `${leg.walkMeters} m of walking to ${to.title} exceeds your ${constraints.maxWalkMetersPerLeg} m limit per leg`,
        severity: 'error',
      })
    }

    if (fromSched && toSched) {
      const gap = (toSched.start.getTime() - fromSched.end.getTime()) / 1000
      if (gap < leg.durationSeconds) {
        violations.push({
          code: 'IMPOSSIBLE_TRANSFER',
          itemIds: [from.id, to.id],
          detail: `Travel to ${to.title} takes ${Math.ceil(leg.durationSeconds / 60)} min but only ${Math.max(0, Math.floor(gap / 60))} min is available`,
          severity: 'error',
        })
      } else if (gap - leg.durationSeconds < constraints.minTransferSeconds) {
        violations.push({
          code: 'INSUFFICIENT_BUFFER',
          itemIds: [from.id, to.id],
          detail: `Only ${Math.floor((gap - leg.durationSeconds) / 60)} min of slack before ${to.title}; you asked for ${Math.floor(constraints.minTransferSeconds / 60)}`,
          severity: 'warning',
        })
      }
    }

    // Accessibility — two distinct codes, never merged.
    if (input.requireStepFree) {
      const access = input.legAccessibility?.get(`${from.id}->${to.id}`) ?? 'UNKNOWN'
      if (access === 'INACCESSIBLE') {
        violations.push({
          code: 'ACCESSIBILITY_UNSATISFIED',
          itemIds: [from.id, to.id],
          detail: `The route to ${to.title} is not step-free`,
          severity: 'error',
        })
      } else if (access === 'UNKNOWN') {
        violations.push({
          code: 'ACCESSIBILITY_UNKNOWN',
          itemIds: [from.id, to.id],
          detail: `The transit feed does not say whether the route to ${to.title} is step-free`,
          severity: 'warning',
        })
      }
    }
  }

  if (dayWalk > constraints.maxWalkMetersPerDay) {
    violations.push({
      code: 'MAX_WALK_EXCEEDED',
      itemIds: ordered.map((i) => i.id),
      detail: `${Math.round(dayWalk)} m of walking today exceeds your ${constraints.maxWalkMetersPerDay} m daily limit`,
      severity: 'error',
    })
  }

  // --- OUTSIDE_USER_HOURS ---------------------------------------------------------
  for (const s of sched) {
    const startSec = secondsIntoDay(s.start, dayStart)
    const endSec = secondsIntoDay(s.end, dayStart)
    if (startSec < constraints.earliestStartSeconds || endSec > constraints.latestFinishSeconds) {
      violations.push({
        code: 'OUTSIDE_USER_HOURS',
        itemIds: [s.itemId],
        detail: `${byId.get(s.itemId)?.title ?? s.itemId} falls outside your ${fmt(constraints.earliestStartSeconds)}–${fmt(constraints.latestFinishSeconds)} day`,
        severity: 'warning',
      })
    }
  }

  // --- PLACE_CLOSED — only when confidence is FEED (BR-PL6) ------------------------
  for (const s of sched) {
    const item = byId.get(s.itemId)
    const place = input.places?.find((p) => p.placeId === item?.placeId)
    if (!place || place.hoursConfidence !== 'FEED' || place.opens == null || place.closes == null)
      continue
    const arrive = secondsIntoDay(s.start, dayStart)
    if (arrive < place.opens || arrive >= place.closes) {
      violations.push({
        code: 'PLACE_CLOSED',
        itemIds: [s.itemId],
        detail: `${item?.title} is closed at ${fmt(arrive)} (open ${fmt(place.opens)}–${fmt(place.closes)})`,
        severity: 'error',
      })
    }
  }

  // --- UNRESOLVED_PLACE ------------------------------------------------------------
  for (const item of ordered) {
    if (item.kind === 'ACTIVITY' && item.placeId === null) {
      violations.push({
        code: 'UNRESOLVED_PLACE',
        itemIds: [item.id],
        detail: `${item.title} is not matched to a real place, so it cannot be routed`,
        severity: 'error',
      })
    }
  }

  // --- MISSING_MEAL ----------------------------------------------------------------
  for (const window of input.mealWindows ?? []) {
    const covered = ordered.some((item) => {
      if (item.kind !== 'MEAL') return false
      const s = sched.find((x) => x.itemId === item.id)
      if (!s) return false
      const at = secondsIntoDay(s.start, dayStart)
      return at >= window.fromSeconds && at <= window.toSeconds
    })
    if (!covered) {
      violations.push({
        code: 'MISSING_MEAL',
        itemIds: [],
        detail: `No ${window.label} between ${fmt(window.fromSeconds)} and ${fmt(window.toSeconds)}`,
        severity: 'warning',
      })
    }
  }

  // --- BUDGET_EXCEEDED — a warning, never a rejection (BR-M7) ------------------------
  if (input.budget && input.budget.spentMinor > input.budget.limitMinor) {
    violations.push({
      code: 'BUDGET_EXCEEDED',
      itemIds: [],
      detail: `Planned spend exceeds the trip budget by ${((input.budget.spentMinor - input.budget.limitMinor) / 100).toFixed(2)} ${input.budget.currency}`,
      severity: 'warning',
    })
  }

  return violations
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
