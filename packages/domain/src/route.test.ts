import { describe, expect, it } from 'vitest'
import {
  attributionLines,
  canShowLive,
  displayDeparture,
  isTransitLeg,
  licences,
  type Provenance,
  type StreetLeg,
  type TransitLeg,
} from './route.js'
import type { DataStatus } from './status.js'

const GEOM = { type: 'LineString' as const, coordinates: [[101.6869, 3.139] as const] }

const KL_FEED = {
  feedId: 'prasarana-rapid-rail-kl',
  feedVersion: '2026-08-01',
  agency: 'Prasarana',
  licence: 'PENDING-VERIFICATION',
  attribution: 'Data from data.gov.my',
}

function provenance(status: DataStatus): Provenance {
  return {
    status,
    retrievedAt: new Date('2026-08-20T10:00:00Z'),
    routerRegion: 'klang-valley',
    feeds: [KL_FEED],
  }
}

function transitLeg(over: Partial<TransitLeg> = {}): TransitLeg {
  return {
    kind: 'TRANSIT',
    agency: 'Prasarana',
    mode: 'SUBWAY',
    boardStop: { name: 'KL Sentral', coord: [101.6869, 3.1339] },
    alightStop: { name: 'Pasar Seni', coord: [101.6958, 3.1427] },
    intermediateStopCount: 1,
    scheduled: {
      departure: new Date('2026-08-20T09:12:00Z'),
      arrival: new Date('2026-08-20T09:18:00Z'),
    },
    geometry: GEOM,
    feedId: KL_FEED.feedId,
    ...over,
  }
}

const walkLeg: StreetLeg = {
  kind: 'WALK',
  distanceMeters: 350,
  durationSeconds: 300,
  geometry: GEOM,
}

describe('leg discrimination', () => {
  it('identifies transit legs', () => {
    expect(isTransitLeg(transitLeg())).toBe(true)
    expect(isTransitLeg(walkLeg)).toBe(false)
  })
})

describe('canShowLive — the live-badge gate', () => {
  it('is false when the leg carries no prediction, even under REALTIME provenance', () => {
    expect(canShowLive(transitLeg(), provenance('REALTIME'))).toBe(false)
  })

  it('is false when a prediction exists but provenance is not REALTIME', () => {
    const leg = transitLeg({
      realtime: {
        departure: new Date('2026-08-20T09:14:00Z'),
        arrival: new Date('2026-08-20T09:20:00Z'),
        delaySeconds: 120,
      },
    })
    for (const s of ['SCHEDULED', 'STALE', 'ESTIMATED', 'MANUAL', 'UNAVAILABLE'] as const) {
      expect(canShowLive(leg, provenance(s)), s).toBe(false)
    }
  })

  it('is true only when both a prediction and REALTIME provenance are present', () => {
    const leg = transitLeg({
      realtime: {
        departure: new Date('2026-08-20T09:14:00Z'),
        arrival: new Date('2026-08-20T09:20:00Z'),
        delaySeconds: 120,
      },
    })
    expect(canShowLive(leg, provenance('REALTIME'))).toBe(true)
  })

  it('is never true for a walking leg', () => {
    expect(canShowLive(walkLeg, provenance('REALTIME'))).toBe(false)
  })
})

describe('displayDeparture — the label travels with the value', () => {
  it('returns the scheduled time labelled scheduled when no prediction exists', () => {
    const leg = transitLeg()
    const d = displayDeparture(leg, provenance('SCHEDULED'))
    expect(d.basis).toBe('scheduled')
    expect(d.at).toEqual(leg.scheduled.departure)
  })

  // The Kuala Lumpur pilot's exact case: a fresh realtime feed exists, but it
  // publishes vehicle positions only, so no TripUpdate prediction is present.
  it('never labels a KL pilot departure as realtime', () => {
    const leg = transitLeg()
    for (const s of ['SCHEDULED', 'STALE'] as const) {
      expect(displayDeparture(leg, provenance(s)).basis).toBe('scheduled')
    }
  })

  it('returns the predicted time labelled realtime when one genuinely exists', () => {
    const predicted = new Date('2026-08-20T09:14:00Z')
    const leg = transitLeg({
      realtime: { departure: predicted, arrival: new Date('2026-08-20T09:20:00Z'), delaySeconds: 120 },
    })
    const d = displayDeparture(leg, provenance('REALTIME'))
    expect(d.basis).toBe('realtime')
    expect(d.at).toEqual(predicted)
  })
})

describe('optional fields stay absent', () => {
  it('leaves platform and stopCode undefined when the feed omitted them', () => {
    const leg = transitLeg()
    expect(leg.boardStop.platform).toBeUndefined()
    expect(leg.boardStop.stopCode).toBeUndefined()
    expect(leg.routeShortName).toBeUndefined()
  })

  it('distinguishes absent accessibility data from "not accessible"', () => {
    expect(transitLeg().accessibility).toBeUndefined()
    const known = transitLeg({
      accessibility: { wheelchairAccessible: false, confidence: 'FEED' },
    })
    expect(known.accessibility?.wheelchairAccessible).toBe(false)
    expect(known.accessibility?.confidence).toBe('FEED')
  })
})

describe('attribution', () => {
  it('renders from stored feed metadata', () => {
    expect(attributionLines(provenance('SCHEDULED'))).toEqual([
      'Data from data.gov.my (Prasarana, 2026-08-01)',
    ])
  })

  it('lists distinct licences across multiple feeds', () => {
    const p: Provenance = {
      ...provenance('SCHEDULED'),
      feeds: [KL_FEED, { ...KL_FEED, feedId: 'ktmb', agency: 'KTMB' }],
    }
    expect(licences(p)).toEqual(['PENDING-VERIFICATION'])
  })
})
