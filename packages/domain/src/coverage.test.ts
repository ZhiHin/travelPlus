import { describe, expect, it } from 'vitest'
import {
  COVERAGE_TIERS,
  TIER_DESCRIPTION,
  deriveCoverageTier,
  supportsRealtime,
  supportsTransit,
  tripCoverageTier,
  type FeedFacts,
  type RegionFacts,
} from './coverage.js'

const NOW = new Date('2026-08-20T10:00:00Z')

function feed(over: Partial<FeedFacts> = {}): FeedFacts {
  return {
    capabilities: { tripUpdates: true, vehiclePositions: true, serviceAlerts: true },
    serviceDatesCover: true,
    lastSuccessAt: new Date(NOW.getTime() - 30_000),
    freshnessWindowSeconds: 120,
    ...over,
  }
}

function region(over: Partial<RegionFacts> = {}): RegionFacts {
  return { hasStreetGraph: true, feeds: [feed()], ...over }
}

describe('tier derivation', () => {
  it('is T0 with no region installed', () => {
    expect(deriveCoverageTier(null, NOW)).toBe('T0')
  })

  it('is T0 when the region has no built street graph', () => {
    expect(deriveCoverageTier(region({ hasStreetGraph: false }), NOW)).toBe('T0')
  })

  it('is T1 with a street graph and no feeds', () => {
    expect(deriveCoverageTier(region({ feeds: [] }), NOW)).toBe('T1')
  })

  it('is T2 with valid schedule data but no live predictions', () => {
    const r = region({
      feeds: [
        feed({
          capabilities: { tripUpdates: false, vehiclePositions: false, serviceAlerts: false },
        }),
      ],
    })
    expect(deriveCoverageTier(r, NOW)).toBe('T2')
  })

  it('is T3 with fresh live predictions', () => {
    expect(deriveCoverageTier(region(), NOW)).toBe('T3')
  })
})

/**
 * The Kuala Lumpur pilot's exact configuration. data.gov.my publishes GTFS-RT
 * VehiclePosition only, and vehicle positions carry no predicted stop times, so
 * the pilot must derive T2 however fresh its feed is (ADR-0022).
 */
describe('a positions-only feed can never reach T3', () => {
  const klFeed = feed({
    capabilities: { tripUpdates: false, vehiclePositions: true, serviceAlerts: false },
  })

  it('derives T2 with a perfectly fresh positions-only feed', () => {
    expect(deriveCoverageTier(region({ feeds: [klFeed] }), NOW)).toBe('T2')
  })

  it('derives T2 at every point in time', () => {
    for (const offset of [-10_000, 0, 1_000, 60_000, 119_000, 121_000, 10_000_000]) {
      const r = region({
        feeds: [feed({ ...klFeed, lastSuccessAt: new Date(NOW.getTime() - offset) })],
      })
      expect(deriveCoverageTier(r, NOW), `offset ${offset}`).not.toBe('T3')
    }
  })

  it('derives T2 even with an absurdly generous freshness window', () => {
    const r = region({ feeds: [feed({ ...klFeed, freshnessWindowSeconds: 86_400 })] })
    expect(deriveCoverageTier(r, NOW)).toBe('T2')
  })
})

describe('freshness affects T3, not T2', () => {
  it('drops to T2 once predictions go stale', () => {
    const stale = feed({ lastSuccessAt: new Date(NOW.getTime() - 300_000) })
    expect(deriveCoverageTier(region({ feeds: [stale] }), NOW)).toBe('T2')
  })

  it('drops to T2 when realtime has never succeeded', () => {
    expect(deriveCoverageTier(region({ feeds: [feed({ lastSuccessAt: null })] }), NOW)).toBe('T2')
  })

  it('does not trust a future timestamp (clock skew)', () => {
    const skewed = feed({ lastSuccessAt: new Date(NOW.getTime() + 60_000) })
    expect(deriveCoverageTier(region({ feeds: [skewed] }), NOW)).toBe('T2')
  })
})

describe('service dates', () => {
  it('ignores a feed whose service dates do not cover the trip', () => {
    const expired = feed({ serviceDatesCover: false })
    expect(deriveCoverageTier(region({ feeds: [expired] }), NOW)).toBe('T1')
  })

  it('uses the best usable feed when several are present', () => {
    const r = region({
      feeds: [
        feed({ serviceDatesCover: false }),
        feed({
          capabilities: { tripUpdates: false, vehiclePositions: true, serviceAlerts: false },
        }),
        feed(),
      ],
    })
    expect(deriveCoverageTier(r, NOW)).toBe('T3')
  })
})

describe('capability queries', () => {
  it('offers transit only at T2 and above', () => {
    expect(supportsTransit('T0')).toBe(false)
    expect(supportsTransit('T1')).toBe(false)
    expect(supportsTransit('T2')).toBe(true)
    expect(supportsTransit('T3')).toBe(true)
  })

  it('permits a live badge only at T3', () => {
    expect(COVERAGE_TIERS.filter(supportsRealtime)).toEqual(['T3'])
  })
})

/**
 * A traveller told "live transit" would reasonably expect it for the whole
 * trip, so the trip-level tier is the worst destination, not the best.
 */
describe('trip-level tier is the minimum', () => {
  it('takes the worst of several destinations', () => {
    expect(tripCoverageTier(['T3', 'T1'])).toBe('T1')
    expect(tripCoverageTier(['T3', 'T2'])).toBe('T2')
    expect(tripCoverageTier(['T2', 'T0', 'T3'])).toBe('T0')
  })

  it('is T0 for a trip with no destinations', () => {
    expect(tripCoverageTier([])).toBe('T0')
  })

  it('is unchanged for a single destination', () => {
    for (const t of COVERAGE_TIERS) expect(tripCoverageTier([t])).toBe(t)
  })

  it('is order-independent', () => {
    expect(tripCoverageTier(['T1', 'T3', 'T2'])).toBe(tripCoverageTier(['T3', 'T2', 'T1']))
  })
})

describe('tier descriptions', () => {
  it('describes every tier', () => {
    for (const t of COVERAGE_TIERS) {
      expect(TIER_DESCRIPTION[t].badge).toBeTruthy()
      expect(TIER_DESCRIPTION[t].summary).toBeTruthy()
    }
  })

  // An unavailable state offering no next step is an error screen wearing a
  // badge. Every tier, including T0, must leave the user something to do.
  it('always offers at least one available action, including at T0', () => {
    for (const t of COVERAGE_TIERS) {
      expect(TIER_DESCRIPTION[t].available.length).toBeGreaterThan(0)
    }
  })

  // Asserted against `available` — the list of things the user CAN do — rather
  // than against the prose. T2's summary legitimately contains the phrase "live
  // departures are not available", and a naive substring check would flag that
  // honest sentence as a broken promise.
  it('offers no live capability below T3', () => {
    for (const t of ['T0', 'T1', 'T2'] as const) {
      for (const item of TIER_DESCRIPTION[t].available) {
        expect(item.toLowerCase(), `${t} offers "${item}"`).not.toMatch(
          /\blive\b|\brealtime\b|\breal-time\b|\bdelay\b/,
        )
      }
    }
  })

  it('offers live departures at T3', () => {
    const offered = TIER_DESCRIPTION.T3.available.join(' ').toLowerCase()
    expect(offered).toMatch(/\blive\b/)
  })

  it('says plainly that live departures are unavailable at T2', () => {
    expect(TIER_DESCRIPTION.T2.summary.toLowerCase()).toContain('live departures are not available')
  })
})
