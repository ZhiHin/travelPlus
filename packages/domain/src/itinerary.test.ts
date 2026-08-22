import { describe, expect, it } from 'vitest'
import { VIOLATION_CODES, checkConstraints, type Violation } from './constraints.js'
import {
  affectedBoundaries,
  moveItem,
  scheduleDay,
  type DayConstraints,
  type ItineraryItem,
  type LegInfo,
} from './itinerary.js'

/** Midnight, Kuala Lumpur, expressed as the UTC instant. */
const DAY = new Date('2026-09-05T16:00:00Z') // 00:00 MYT on the 6th
const H = 3600

const C: DayConstraints = {
  earliestStartSeconds: 8 * H,
  latestFinishSeconds: 22 * H,
  bufferSeconds: 600,
  minTransferSeconds: 300,
  maxWalkMetersPerLeg: 1000,
  maxWalkMetersPerDay: 6000,
}

function item(id: string, ordinal: number, over: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    id,
    kind: 'ACTIVITY',
    title: id,
    placeId: `place-${id}`,
    plannedDurationSeconds: H,
    desiredStart: null,
    lockTime: false,
    lockPlace: false,
    lockItem: false,
    ordinal,
    ...over,
  }
}

function leg(from: string, to: string, durationSeconds: number | null, walk = 300): LegInfo {
  return {
    fromItemId: from,
    toItemId: to,
    durationSeconds,
    walkMeters: walk,
    snapshotId: durationSeconds == null ? null : `snap-${from}-${to}`,
    status: durationSeconds == null ? 'UNAVAILABLE' : 'ROUTED',
  }
}

const at = (h: number) => new Date(DAY.getTime() + h * H * 1000)

describe('scheduleDay', () => {
  it('starts at the earliest allowed hour and chains forward', () => {
    const items = [item('a', 0), item('b', 1)]
    const result = scheduleDay(DAY, items, [leg('a', 'b', 900)], C)
    expect(result.items[0]!.start).toEqual(at(8))
    expect(result.items[0]!.end).toEqual(at(9))
    // 09:00 + 15 min travel + 10 min buffer = 09:25
    expect(result.items[1]!.start).toEqual(new Date(at(9).getTime() + 25 * 60_000))
  })

  // BR-I11: the scheduler never invents a travel time. A missing leg is a
  // recorded gap, and times after it are explicitly estimates.
  it('records a gap rather than inventing a duration for an unrouted leg', () => {
    const items = [item('a', 0), item('b', 1)]
    const result = scheduleDay(DAY, items, [leg('a', 'b', null)], C)
    expect(result.gaps).toEqual(['b'])
    // Only the buffer is applied; no guessed travel time.
    expect(result.items[1]!.start).toEqual(new Date(at(9).getTime() + 10 * 60_000))
  })

  it('honours an unlocked desired start when it is later than the cursor', () => {
    const items = [item('a', 0), item('b', 1, { desiredStart: at(14) })]
    const result = scheduleDay(DAY, items, [leg('a', 'b', 900)], C)
    expect(result.items[1]!.start).toEqual(at(14))
    expect(result.items[1]!.pinned).toBe(false)
  })

  it('ignores an unlocked desired start that would go backwards', () => {
    const items = [item('a', 0), item('b', 1, { desiredStart: at(7) })]
    const result = scheduleDay(DAY, items, [leg('a', 'b', 900)], C)
    expect(result.items[1]!.start.getTime()).toBeGreaterThan(at(9).getTime())
  })

  // A lock wins even when it conflicts. Moving the locked item to "fix" it would
  // hide the conflict the user needs to see (BR-I8).
  it('pins a locked time even when it lands before the cursor', () => {
    const items = [item('a', 0), item('b', 1, { desiredStart: at(8.5), lockTime: true })]
    const result = scheduleDay(DAY, items, [leg('a', 'b', 900)], C)
    expect(result.items[1]!.start).toEqual(at(8.5))
    expect(result.items[1]!.pinned).toBe(true)
  })

  it('is deterministic for identical input', () => {
    const items = [item('a', 0), item('b', 1), item('c', 2)]
    const legs = [leg('a', 'b', 900), leg('b', 'c', 1200)]
    const x = scheduleDay(DAY, items, legs, C)
    const y = scheduleDay(DAY, items, legs, C)
    expect(x).toEqual(y)
  })

  it('orders by ordinal regardless of array order', () => {
    const items = [item('c', 2), item('a', 0), item('b', 1)]
    const result = scheduleDay(DAY, items, [leg('a', 'b', 900), leg('b', 'c', 900)], C)
    expect(result.items.map((i) => i.itemId)).toEqual(['a', 'b', 'c'])
  })
})

/**
 * O3 / BR-I6: a reorder recalculates at most four leg boundaries, never n.
 */
describe('affectedBoundaries', () => {
  it('reports nothing for an unchanged order', () => {
    expect(affectedBoundaries(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([])
  })

  it('touches at most four boundaries when one item moves', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f']
    const after = moveItem(before, 'e', 1) // a e b c d f
    const changed = affectedBoundaries(before, after)
    expect(changed.length).toBeLessThanOrEqual(4)
    // The untouched boundary survives.
    expect(changed.some((p) => p.from === 'b' && p.to === 'c')).toBe(false)
  })

  it('never exceeds four for any single move in a long itinerary', () => {
    const before = Array.from({ length: 30 }, (_, i) => `i${i}`)
    for (let from = 0; from < before.length; from++) {
      for (let to = 0; to < before.length; to++) {
        const after = moveItem(before, before[from]!, to)
        expect(affectedBoundaries(before, after).length, `${from}->${to}`).toBeLessThanOrEqual(4)
      }
    }
  })

  it('identifies exactly the new boundaries', () => {
    const before = ['a', 'b', 'c']
    const after = ['a', 'c', 'b']
    const changed = affectedBoundaries(before, after).map((p) => `${p.from}->${p.to}`)
    expect(changed.sort()).toEqual(['a->c', 'c->b'])
  })
})

describe('moveItem', () => {
  it('produces a gap-free sequence with every item exactly once', () => {
    const ids = ['a', 'b', 'c', 'd']
    for (const id of ids) {
      for (let to = 0; to < ids.length; to++) {
        const next = moveItem(ids, id, to)
        expect([...next].sort()).toEqual([...ids].sort())
        expect(next.indexOf(id)).toBe(to)
      }
    }
  })

  it('clamps an out-of-range index', () => {
    expect(moveItem(['a', 'b', 'c'], 'a', 99)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 'c', -5)).toEqual(['c', 'a', 'b'])
  })

  it('rejects an unknown item', () => {
    expect(() => moveItem(['a'], 'zzz', 0)).toThrow(RangeError)
  })
})

describe('checkConstraints — the thirteen classes', () => {
  function codes(v: Violation[]): string[] {
    return v.map((x) => x.code)
  }

  function run(
    items: ItineraryItem[],
    legs: LegInfo[],
    extra: Partial<Parameters<typeof checkConstraints>[0]> = {},
  ) {
    const scheduled = scheduleDay(DAY, items, legs, C).items
    return checkConstraints({ dayStart: DAY, items, scheduled, legs, constraints: C, ...extra })
  }

  it('passes a clean day', () => {
    const items = [item('a', 0), item('b', 1)]
    expect(run(items, [leg('a', 'b', 900)])).toEqual([])
  })

  it('defines exactly thirteen codes', () => {
    expect(VIOLATION_CODES).toHaveLength(13)
  })

  it('detects OVERLAP from a desired start inside the previous item', () => {
    const items = [item('a', 0), item('b', 1, { desiredStart: at(8.5) })]
    // Unlocked desired start before cursor is ignored by the scheduler, so force
    // the overlap via scheduled input directly.
    const scheduled = [
      { itemId: 'a', start: at(8), end: at(9), pinned: false },
      { itemId: 'b', start: at(8.5), end: at(9.5), pinned: false },
    ]
    const v = checkConstraints({
      dayStart: DAY,
      items,
      scheduled,
      legs: [leg('a', 'b', 0)],
      constraints: C,
    })
    expect(codes(v)).toContain('OVERLAP')
  })

  it('reports LOCKED_ITEM_CONFLICT rather than OVERLAP when a lock causes it', () => {
    const items = [item('a', 0), item('b', 1, { desiredStart: at(8.5), lockTime: true })]
    const v = run(items, [leg('a', 'b', 600)])
    expect(codes(v)).toContain('LOCKED_ITEM_CONFLICT')
    expect(codes(v)).not.toContain('OVERLAP')
  })

  it('detects IMPOSSIBLE_TRANSFER when the gap is shorter than the routed time', () => {
    const items = [item('a', 0), item('b', 1, { desiredStart: at(9.1), lockTime: true })]
    const v = run(items, [leg('a', 'b', 1800)])
    expect(codes(v)).toContain('IMPOSSIBLE_TRANSFER')
  })

  it('detects INSUFFICIENT_BUFFER as a warning', () => {
    const items = [item('a', 0), item('b', 1, { desiredStart: at(9.3), lockTime: true })]
    const v = run(items, [leg('a', 'b', 900)])
    const buffer = v.find((x) => x.code === 'INSUFFICIENT_BUFFER')
    expect(buffer?.severity).toBe('warning')
  })

  it('detects MAX_WALK_EXCEEDED per leg and per day', () => {
    const items = [item('a', 0), item('b', 1)]
    expect(codes(run(items, [leg('a', 'b', 900, 1500)]))).toContain('MAX_WALK_EXCEEDED')

    const many = [item('a', 0), item('b', 1), item('c', 2), item('d', 3)]
    const legs = [leg('a', 'b', 900, 900), leg('b', 'c', 900, 900), leg('c', 'd', 900, 900)]
    // 2700 m total is under 6000, so this should pass...
    expect(codes(run(many, legs))).not.toContain('MAX_WALK_EXCEEDED')
    // ...but eight 900 m legs is 7200 m.
    const long = Array.from({ length: 9 }, (_, i) => item(`i${i}`, i))
    const longLegs = Array.from({ length: 8 }, (_, i) => leg(`i${i}`, `i${i + 1}`, 900, 900))
    const v = run(long, longLegs)
    expect(v.some((x) => x.code === 'MAX_WALK_EXCEEDED' && x.itemIds.length === 9)).toBe(true)
  })

  it('detects NO_ROUTE_FOUND for an unavailable leg', () => {
    const items = [item('a', 0), item('b', 1)]
    expect(codes(run(items, [leg('a', 'b', null)]))).toContain('NO_ROUTE_FOUND')
  })

  it('detects OUTSIDE_USER_HOURS', () => {
    const items = [item('a', 0, { desiredStart: at(21.5), lockTime: true })]
    expect(codes(run(items, []))).toContain('OUTSIDE_USER_HOURS')
  })

  // BR-PL6: closed-place conflicts are raised ONLY when hours came from a feed.
  it('raises PLACE_CLOSED only at FEED confidence', () => {
    const items = [item('a', 0)]
    const closedFeed = run(items, [], {
      places: [{ placeId: 'place-a', opens: 10 * H, closes: 18 * H, hoursConfidence: 'FEED' }],
    })
    expect(codes(closedFeed)).toContain('PLACE_CLOSED')

    const closedUnknown = run(items, [], {
      places: [{ placeId: 'place-a', opens: 10 * H, closes: 18 * H, hoursConfidence: 'UNKNOWN' }],
    })
    expect(codes(closedUnknown)).not.toContain('PLACE_CLOSED')
  })

  it('detects MISSING_MEAL as a warning', () => {
    const items = [item('a', 0)]
    const v = run(items, [], {
      mealWindows: [{ label: 'lunch', fromSeconds: 12 * H, toSeconds: 14 * H }],
    })
    expect(v.find((x) => x.code === 'MISSING_MEAL')?.severity).toBe('warning')
  })

  it('is satisfied by a MEAL item inside the window', () => {
    const items = [item('a', 0), item('lunch', 1, { kind: 'MEAL', desiredStart: at(12.5) })]
    const v = run(items, [leg('a', 'lunch', 600)], {
      mealWindows: [{ label: 'lunch', fromSeconds: 12 * H, toSeconds: 14 * H }],
    })
    expect(codes(v)).not.toContain('MISSING_MEAL')
  })

  it('detects UNRESOLVED_PLACE for an activity with no place', () => {
    const items = [item('a', 0, { placeId: null })]
    expect(codes(run(items, []))).toContain('UNRESOLVED_PLACE')
  })

  // BR-M7: over budget informs; it does not refuse the user's own money.
  it('reports BUDGET_EXCEEDED as a warning, never an error', () => {
    const v = run([item('a', 0)], [], {
      budget: { limitMinor: 10_000, spentMinor: 12_000, currency: 'MYR' },
    })
    const b = v.find((x) => x.code === 'BUDGET_EXCEEDED')
    expect(b?.severity).toBe('warning')
  })

  /**
   * The distinction persona P7 depends on. "We don't know" is actionable; "no
   * accessible route" when we merely lack data is a worse, different claim.
   */
  describe('accessibility', () => {
    const items = [item('a', 0), item('b', 1)]
    const legs = [leg('a', 'b', 900)]

    it('raises ACCESSIBILITY_UNSATISFIED as an error when the feed says inaccessible', () => {
      const v = run(items, legs, {
        requireStepFree: true,
        legAccessibility: new Map([['a->b', 'INACCESSIBLE']]),
      })
      const a = v.find((x) => x.code === 'ACCESSIBILITY_UNSATISFIED')
      expect(a?.severity).toBe('error')
      expect(codes(v)).not.toContain('ACCESSIBILITY_UNKNOWN')
    })

    it('raises ACCESSIBILITY_UNKNOWN as a warning when the feed does not say', () => {
      const v = run(items, legs, { requireStepFree: true })
      const u = v.find((x) => x.code === 'ACCESSIBILITY_UNKNOWN')
      expect(u?.severity).toBe('warning')
      expect(u?.detail).toMatch(/does not say/)
      expect(codes(v)).not.toContain('ACCESSIBILITY_UNSATISFIED')
    })

    it('raises nothing when the feed confirms accessible', () => {
      const v = run(items, legs, {
        requireStepFree: true,
        legAccessibility: new Map([['a->b', 'ACCESSIBLE']]),
      })
      expect(codes(v).filter((c) => c.startsWith('ACCESSIBILITY'))).toEqual([])
    })

    it('raises nothing when step-free is not required', () => {
      expect(codes(run(items, legs)).filter((c) => c.startsWith('ACCESSIBILITY'))).toEqual([])
    })
  })

  it('anchors every violation to item ids so the UI can place it', () => {
    const items = [item('a', 0), item('b', 1)]
    const v = run(items, [leg('a', 'b', null)])
    for (const x of v) expect(Array.isArray(x.itemIds)).toBe(true)
  })
})
