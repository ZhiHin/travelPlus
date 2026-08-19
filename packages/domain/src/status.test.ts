import { describe, expect, it } from 'vitest'
import {
  DATA_STATUSES,
  STATUS_LABEL,
  STATUS_NODE,
  STATUS_STROKE,
  deriveTransitStatus,
  isLive,
  requiresAgeDisplay,
  type FeedHealth,
} from './status.js'

const T0 = new Date('2026-08-20T10:00:00Z')

function feed(over: Partial<FeedHealth> = {}): FeedHealth {
  return {
    capabilities: { tripUpdates: true, vehiclePositions: true, serviceAlerts: true },
    lastSuccessAt: T0,
    freshnessWindowSeconds: 120,
    ...over,
  }
}

describe('deriveTransitStatus', () => {
  it('returns REALTIME inside the freshness window', () => {
    const now = new Date(T0.getTime() + 60_000)
    expect(deriveTransitStatus(feed(), now)).toBe('REALTIME')
  })

  it('returns STALE once the freshness window has passed', () => {
    const now = new Date(T0.getTime() + 121_000)
    expect(deriveTransitStatus(feed(), now)).toBe('STALE')
  })

  // RISKS.md R-15: the badge must change with no new data arriving. Advancing the
  // clock alone has to flip it, or a silently dead feed keeps showing "live".
  it('flips REALTIME to STALE by advancing time alone, with identical feed data', () => {
    const f = feed()
    expect(deriveTransitStatus(f, new Date(T0.getTime() + 30_000))).toBe('REALTIME')
    expect(deriveTransitStatus(f, new Date(T0.getTime() + 3_600_000))).toBe('STALE')
  })

  it('treats the exact window boundary as stale, not live', () => {
    const now = new Date(T0.getTime() + 120_000)
    expect(deriveTransitStatus(feed(), now)).toBe('STALE')
  })

  it('never claims live when lastSuccessAt is in the future (clock skew)', () => {
    const now = new Date(T0.getTime() - 60_000)
    expect(deriveTransitStatus(feed(), now)).toBe('STALE')
  })

  it('returns SCHEDULED when realtime has never succeeded', () => {
    expect(deriveTransitStatus(feed({ lastSuccessAt: null }), T0)).toBe('SCHEDULED')
  })

  // ADR-0022 / BR-T7 — the Kuala Lumpur pilot's exact configuration.
  describe('BR-T7: vehicle positions are not predictions', () => {
    const klPilot = feed({
      capabilities: { tripUpdates: false, vehiclePositions: true, serviceAlerts: false },
    })

    it('returns SCHEDULED for a positions-only feed even when perfectly fresh', () => {
      const now = new Date(T0.getTime() + 1_000)
      expect(deriveTransitStatus(klPilot, now)).toBe('SCHEDULED')
    })

    it('can never return REALTIME for a positions-only feed at any point in time', () => {
      const offsets = [-10_000, 0, 1, 1_000, 60_000, 119_999, 120_000, 10_000_000]
      for (const ms of offsets) {
        const status = deriveTransitStatus(klPilot, new Date(T0.getTime() + ms))
        expect(status, `offset ${ms}ms must not be REALTIME`).not.toBe('REALTIME')
      }
    })

    it('is unaffected by a very long freshness window', () => {
      const generous = feed({
        capabilities: { tripUpdates: false, vehiclePositions: true, serviceAlerts: false },
        freshnessWindowSeconds: 86_400,
      })
      expect(deriveTransitStatus(generous, new Date(T0.getTime() + 1_000))).toBe('SCHEDULED')
    })
  })
})

describe('presentation rules', () => {
  it('only REALTIME counts as live', () => {
    expect(isLive('REALTIME')).toBe(true)
    for (const s of DATA_STATUSES.filter((x) => x !== 'REALTIME')) {
      expect(isLive(s)).toBe(false)
    }
  })

  it('requires an age for both REALTIME and STALE', () => {
    expect(requiresAgeDisplay('REALTIME')).toBe(true)
    expect(requiresAgeDisplay('STALE')).toBe(true)
    expect(requiresAgeDisplay('SCHEDULED')).toBe(false)
  })

  it('gives every status a label, a stroke and a node style', () => {
    for (const s of DATA_STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy()
      expect(STATUS_STROKE[s]).toBeTruthy()
      expect(STATUS_NODE[s]).toBeTruthy()
    }
  })

  // Not by colour alone: the six states must stay distinguishable in greyscale,
  // so stroke+node together has to separate the ones users act on differently.
  it('distinguishes REALTIME, ESTIMATED, STALE and UNAVAILABLE without colour', () => {
    const key = (s: (typeof DATA_STATUSES)[number]) => `${STATUS_STROKE[s]}/${STATUS_NODE[s]}`
    const acted = ['REALTIME', 'ESTIMATED', 'STALE', 'UNAVAILABLE'] as const
    expect(new Set(acted.map(key)).size).toBe(acted.length)
  })
})
