import { isTransitLeg, type FeedRef, type TransitLeg } from '@travelplus/domain'
import { describe, expect, it } from 'vitest'
import {
  MalformedRouteError,
  decodeGeometry,
  normalizeItinerary,
  type NormalizeContext,
  type OtpItinerary,
} from './normalize.js'

/**
 * Contract tests against captured OTP shapes.
 *
 * No running OTP is required, which is the CI rule that shapes everything
 * (testing strategy Â§3): a test needing a live provider is a test that will
 * eventually be skipped, and a skipped test is how a phase gate gets passed
 * dishonestly.
 *
 * The cases that matter most are the malformed and missing-optional-field ones.
 * They prove absent data stays absent rather than being defaulted into a
 * plausible lie.
 */

const T0 = new Date('2026-08-21T02:00:00Z')

const PRASARANA: FeedRef = {
  feedId: 'prasarana-rapid-rail-kl',
  feedVersion: '2026-08-01',
  agency: 'Prasarana',
  licence: 'CC BY 4.0',
  attribution: 'Transit data Â© Kerajaan Malaysia (data.gov.my), CC BY 4.0',
}

function ctx(over: Partial<NormalizeContext> = {}): NormalizeContext {
  let counter = 0
  return {
    routerRegion: 'klang-valley',
    feeds: [PRASARANA],
    retrievedAt: T0,
    // The pilot's actual configuration: vehicle positions, no trip updates.
    feedsSupportTripUpdates: false,
    newId: () => `route-${++counter}`,
    ...over,
  }
}

/** A two-leg itinerary: walk to Pasar Seni, ride the Kelana Jaya line. */
function itinerary(over: Partial<OtpItinerary> = {}): OtpItinerary {
  return {
    startTime: Date.UTC(2026, 7, 21, 1, 5),
    endTime: Date.UTC(2026, 7, 21, 1, 24),
    duration: 1140,
    walkDistance: 350,
    legs: [
      {
        mode: 'WALK',
        transitLeg: false,
        startTime: Date.UTC(2026, 7, 21, 1, 5),
        endTime: Date.UTC(2026, 7, 21, 1, 11),
        duration: 360,
        distance: 350,
        legGeometry: { points: '_p~iF~ps|U_ulLnnqC' },
      },
      {
        mode: 'SUBWAY',
        transitLeg: true,
        startTime: Date.UTC(2026, 7, 21, 1, 12),
        endTime: Date.UTC(2026, 7, 21, 1, 24),
        duration: 720,
        headsign: 'Gombak',
        intermediateStops: [{}, {}, {}],
        route: {
          shortName: 'KJL',
          longName: 'Kelana Jaya Line',
          color: 'E01E24',
          mode: 'SUBWAY',
          agency: { name: 'Prasarana', gtfsId: 'prasarana' },
        },
        from: {
          name: 'Pasar Seni',
          lat: 3.1427,
          lon: 101.6958,
          stop: { code: 'KJ14', platformCode: '2', wheelchairBoarding: 'POSSIBLE' },
        },
        to: { name: 'KLCC', lat: 3.1588, lon: 101.7137, stop: { code: 'KJ10' } },
        legGeometry: { points: '_p~iF~ps|U_ulLnnqC' },
      },
    ],
    ...over,
  }
}

describe('a well-formed itinerary', () => {
  it('normalizes legs, duration and transfers', () => {
    const route = normalizeItinerary(itinerary(), ctx())
    expect(route.legs).toHaveLength(2)
    expect(route.totalDurationSeconds).toBe(1140)
    expect(route.walkDistanceMeters).toBe(350)
    // One transit leg means zero transfers.
    expect(route.transferCount).toBe(0)
  })

  it('carries complete provenance', () => {
    const route = normalizeItinerary(itinerary(), ctx())
    expect(route.provenance.routerRegion).toBe('klang-valley')
    expect(route.provenance.retrievedAt).toEqual(T0)
    expect(route.provenance.feeds[0]!.licence).toBe('CC BY 4.0')
  })

  it('maps the transit leg fields the feed supplied', () => {
    const route = normalizeItinerary(itinerary(), ctx())
    const leg = route.legs[1] as TransitLeg
    expect(leg.kind).toBe('TRANSIT')
    expect(leg.agency).toBe('Prasarana')
    expect(leg.mode).toBe('SUBWAY')
    expect(leg.routeShortName).toBe('KJL')
    expect(leg.headsign).toBe('Gombak')
    expect(leg.boardStop.name).toBe('Pasar Seni')
    expect(leg.boardStop.platform).toBe('2')
    expect(leg.intermediateStopCount).toBe(3)
  })

  it('counts transfers as gaps between transit legs', () => {
    const three = itinerary({
      legs: [...itinerary().legs!, { ...itinerary().legs![1]! }, { ...itinerary().legs![1]! }],
    })
    // Three transit legs â†’ two transfers.
    expect(normalizeItinerary(three, ctx()).transferCount).toBe(2)
  })
})

/**
 * The rule that carries the product's central claim: a field the provider did
 * not send must be `undefined`, never a default that reads as a fact.
 */
describe('absent fields stay absent', () => {
  it('omits platform and stopCode when the feed did not supply them', () => {
    const bare = itinerary()
    bare.legs![1]!.from = { name: 'Pasar Seni', lat: 3.1427, lon: 101.6958, stop: {} }

    const leg = normalizeItinerary(bare, ctx()).legs[1] as TransitLeg
    expect(leg.boardStop.platform).toBeUndefined()
    expect(leg.boardStop.stopCode).toBeUndefined()
  })

  it('omits route names and colour when absent', () => {
    const bare = itinerary()
    bare.legs![1]!.route = { agency: { name: 'Prasarana' } }

    const leg = normalizeItinerary(bare, ctx()).legs[1] as TransitLeg
    expect(leg.routeShortName).toBeUndefined()
    expect(leg.routeLongName).toBeUndefined()
    expect(leg.routeColor).toBeUndefined()
  })

  // An empty string is the provider saying nothing, not saying "". Storing it
  // produces a UI row that reads "no platform" rather than "we were not told".
  it('treats an empty string as absent, not as a value', () => {
    const blank = itinerary()
    blank.legs![1]!.headsign = '   '
    blank.legs![1]!.route!.shortName = ''

    const leg = normalizeItinerary(blank, ctx()).legs[1] as TransitLeg
    expect(leg.headsign).toBeUndefined()
    expect(leg.routeShortName).toBeUndefined()
  })

  it('omits alerts entirely rather than returning an empty array', () => {
    const leg = normalizeItinerary(itinerary(), ctx()).legs[1] as TransitLeg
    expect(leg.alerts).toBeUndefined()
  })

  it('includes alerts when the feed supplied them', () => {
    const alerted = itinerary()
    alerted.legs![1]!.alerts = [
      { alertHeaderText: 'Minor delays', alertEffect: 'SIGNIFICANT_DELAYS' },
    ]
    const leg = normalizeItinerary(alerted, ctx()).legs[1] as TransitLeg
    expect(leg.alerts).toHaveLength(1)
    expect(leg.alerts![0]!.header).toBe('Minor delays')
  })
})

/**
 * "The feed does not say" and "not accessible" are different statements, and
 * conflating them is the failure persona P7 is most exposed to.
 */
describe('accessibility distinguishes unknown from inaccessible', () => {
  it('reports accessible when the feed says POSSIBLE', () => {
    const leg = normalizeItinerary(itinerary(), ctx()).legs[1] as TransitLeg
    expect(leg.accessibility).toEqual({ wheelchairAccessible: true, confidence: 'FEED' })
  })

  it('reports NOT accessible when the feed says NOT_POSSIBLE', () => {
    const inaccessible = itinerary()
    inaccessible.legs![1]!.from!.stop!.wheelchairBoarding = 'NOT_POSSIBLE'
    const leg = normalizeItinerary(inaccessible, ctx()).legs[1] as TransitLeg
    expect(leg.accessibility?.wheelchairAccessible).toBe(false)
  })

  it('omits the block for NO_INFORMATION rather than claiming inaccessible', () => {
    const unknown = itinerary()
    unknown.legs![1]!.from!.stop!.wheelchairBoarding = 'NO_INFORMATION'
    const leg = normalizeItinerary(unknown, ctx()).legs[1] as TransitLeg
    expect(leg.accessibility).toBeUndefined()
  })

  it('omits the block when the field is missing entirely', () => {
    const missing = itinerary()
    missing.legs![1]!.from!.stop = { code: 'KJ14' }
    const leg = normalizeItinerary(missing, ctx()).legs[1] as TransitLeg
    expect(leg.accessibility).toBeUndefined()
  })
})

/**
 * ADR-0022 at the normalization boundary. OTP sets `realTime: true` for any
 * applied realtime data, but a vehicle-position-only feed carries no predicted
 * stop times â€” so the flag alone must not manufacture a departure prediction.
 */
describe('the pilot cannot produce a realtime prediction', () => {
  it('omits realtime when no feed publishes TripUpdates, even if OTP flagged it', () => {
    const flagged = itinerary()
    flagged.legs![1]!.realTime = true
    flagged.legs![1]!.departureDelay = 120

    const route = normalizeItinerary(flagged, ctx({ feedsSupportTripUpdates: false }))
    const leg = route.legs[1] as TransitLeg
    expect(leg.realtime).toBeUndefined()
    expect(route.provenance.status).toBe('SCHEDULED')
  })

  it('builds realtime only when a feed genuinely publishes TripUpdates', () => {
    const flagged = itinerary()
    flagged.legs![1]!.realTime = true
    flagged.legs![1]!.departureDelay = 120

    const route = normalizeItinerary(flagged, ctx({ feedsSupportTripUpdates: true }))
    const leg = route.legs[1] as TransitLeg
    expect(leg.realtime).toBeDefined()
    expect(leg.realtime!.delaySeconds).toBe(120)
    expect(route.provenance.status).toBe('REALTIME')
  })

  it('stays SCHEDULED when TripUpdates exist but this leg had no prediction', () => {
    const route = normalizeItinerary(itinerary(), ctx({ feedsSupportTripUpdates: true }))
    expect(route.provenance.status).toBe('SCHEDULED')
  })

  // The scheduled time must remain the published one, not the delayed one, or
  // "scheduled" silently starts meaning "predicted".
  it('keeps scheduled times free of the applied delay', () => {
    const delayed = itinerary()
    delayed.legs![1]!.realTime = true
    delayed.legs![1]!.departureDelay = 180

    const leg = normalizeItinerary(delayed, ctx({ feedsSupportTripUpdates: true }))
      .legs[1] as TransitLeg
    expect(leg.realtime!.departure.getTime() - leg.scheduled.departure.getTime()).toBe(180_000)
  })
})

describe('malformed responses fail rather than half-succeed', () => {
  it('rejects an itinerary with no legs', () => {
    expect(() => normalizeItinerary(itinerary({ legs: [] }), ctx())).toThrow(MalformedRouteError)
  })

  it('rejects an itinerary missing start or end time', () => {
    const broken = itinerary()
    delete broken.startTime
    expect(() => normalizeItinerary(broken, ctx())).toThrow(/start or end time/)
  })

  it('rejects a transit leg with no agency', () => {
    const broken = itinerary()
    broken.legs![1]!.route = { shortName: 'KJL' }
    expect(() => normalizeItinerary(broken, ctx())).toThrow(/operating agency/)
  })

  it('rejects a transit leg with no boarding stop', () => {
    const broken = itinerary()
    broken.legs![1]!.from = null
    expect(() => normalizeItinerary(broken, ctx())).toThrow(/boarding or alighting stop/)
  })

  it('rejects a stop with no coordinates', () => {
    const broken = itinerary()
    broken.legs![1]!.from = { name: 'Pasar Seni' }
    expect(() => normalizeItinerary(broken, ctx())).toThrow(/coordinates/)
  })

  // A pathological response should not become a pathological route object.
  it('rejects an itinerary with an absurd number of legs', () => {
    const huge = itinerary({ legs: Array.from({ length: 100 }, () => itinerary().legs![0]!) })
    expect(() => normalizeItinerary(huge, ctx())).toThrow(/above the 40/)
  })
})

describe('geometry decoding', () => {
  it('decodes an encoded polyline to coordinates', () => {
    const geometry = decodeGeometry('_p~iF~ps|U_ulLnnqC')
    expect(geometry.type).toBe('LineString')
    expect(geometry.coordinates.length).toBeGreaterThan(0)
    const [lon, lat] = geometry.coordinates[0]!
    expect(Math.abs(lat)).toBeLessThanOrEqual(90)
    expect(Math.abs(lon)).toBeLessThanOrEqual(180)
  })

  it('returns an empty line for null rather than throwing', () => {
    expect(decodeGeometry(null).coordinates).toEqual([])
  })

  // A route with no drawn line is still a usable set of instructions, and the
  // semantic list carries the same facts.
  it('returns an empty line for a truncated polyline rather than throwing', () => {
    expect(decodeGeometry('_p~iF~ps|U_ulL').coordinates.length).toBeGreaterThanOrEqual(0)
    expect(() => decodeGeometry('!!!invalid!!!')).not.toThrow()
  })

  it('still normalizes an itinerary whose geometry is missing', () => {
    const noGeometry = itinerary()
    noGeometry.legs!.forEach((l) => {
      l.legGeometry = null
    })
    const route = normalizeItinerary(noGeometry, ctx())
    expect(route.geometry.coordinates).toEqual([])
    expect(route.legs).toHaveLength(2)
  })
})

describe('mode mapping', () => {
  it('maps known transit modes', () => {
    const cases: [string, string][] = [
      ['BUS', 'BUS'],
      ['SUBWAY', 'SUBWAY'],
      ['TRAM', 'TRAM'],
      ['RAIL', 'RAIL'],
      ['MONORAIL', 'RAIL'],
      ['FERRY', 'FERRY'],
      ['FUNICULAR', 'CABLE'],
    ]
    for (const [otpMode, expected] of cases) {
      const shaped = itinerary()
      shaped.legs![1]!.route!.mode = otpMode
      const leg = normalizeItinerary(shaped, ctx()).legs[1] as TransitLeg
      expect(leg.mode, otpMode).toBe(expected)
    }
  })

  it('falls back to OTHER for an unrecognised mode rather than guessing', () => {
    const odd = itinerary()
    odd.legs![1]!.route!.mode = 'HOVERCRAFT'
    const leg = normalizeItinerary(odd, ctx()).legs[1] as TransitLeg
    expect(leg.mode).toBe('OTHER')
  })

  it('maps street modes', () => {
    for (const [otpMode, expected] of [
      ['WALK', 'WALK'],
      ['BICYCLE', 'CYCLE'],
      ['CAR', 'DRIVE'],
    ] as const) {
      const shaped = itinerary()
      shaped.legs![0]!.mode = otpMode
      expect(normalizeItinerary(shaped, ctx()).legs[0]!.kind).toBe(expected)
    }
  })
})

describe('feed attribution per leg', () => {
  const KTMB: FeedRef = {
    feedId: 'ktmb',
    feedVersion: '2026-08-01',
    agency: 'Keretapi Tanah Melayu',
    licence: 'CC BY 4.0',
    attribution: 'Transit data Â© Kerajaan Malaysia (data.gov.my), CC BY 4.0',
  }

  function transitLeg(agencyGtfsId: string) {
    const base = itinerary().legs[1]!
    return { ...base, route: { ...base.route, agency: { name: 'x', gtfsId: agencyGtfsId } } }
  }

  // The live Komuter -> LRT journey stamped every leg 'prasarana-rapid-rail-kl'
  // before this: the first configured feed, not the one that ran the train.
  it('derives the feed from the scoped agency id in a multi-feed graph', () => {
    const route = normalizeItinerary(
      itinerary({
        legs: [transitLeg('ktmb:ktmb'), transitLeg('prasarana-rapid-rail-kl:rapidrail')],
      }),
      ctx({ feeds: [PRASARANA, KTMB] }),
    )
    const feeds = route.legs.filter(isTransitLeg).map((l) => l.feedId)
    expect(feeds).toEqual(['ktmb', 'prasarana-rapid-rail-kl'])
  })

  it('falls back to the only configured feed when the id is unscoped', () => {
    const route = normalizeItinerary(itinerary({ legs: [transitLeg('prasarana')] }), ctx())
    expect(route.legs.filter(isTransitLeg)[0]!.feedId).toBe('prasarana-rapid-rail-kl')
  })

  it('names the region, not a guess, when the id matches no configured feed', () => {
    const route = normalizeItinerary(
      itinerary({ legs: [transitLeg('mystery:agency')] }),
      ctx({ feeds: [PRASARANA, KTMB] }),
    )
    expect(route.legs.filter(isTransitLeg)[0]!.feedId).toBe('klang-valley')
  })
})
