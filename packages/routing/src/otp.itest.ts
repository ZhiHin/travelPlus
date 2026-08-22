import { isTransitLeg, uuidv7, type NormalizedRoute, type TransitLeg } from '@travelplus/domain'
import { beforeAll, describe, expect, it } from 'vitest'
import { createOtpClient, type OtpClient } from './otp.js'

/**
 * Live routing against the Klang Valley graph (Phase 3 exit gate).
 *
 * This is not a mock. It requires an OTP 2.8.1 router serving the graph built
 * by `infra/otp/build-graph.mjs`:
 *
 *   docker compose --profile routing up -d otp
 *
 * The journey under test crosses operators — KTM Komuter (ktmb) to an LRT line
 * (prasarana-rapid-rail-kl) — because a single-operator query can pass while
 * the transfer graph between feeds is silently broken. Klang is served by
 * Komuter only; Ampang Park by the LRT Kelana Jaya line only. There is no way
 * to do this trip on one feed.
 *
 * If the router is not reachable the suite is skipped with a loud notice
 * rather than failing, so the database-only integration run still works on a
 * machine without the 100 MB graph. The phase record states when it last ran.
 */

const OTP_BASE_URL = process.env.OTP_BASE_URL ?? 'http://127.0.0.1:8080'

const KLANG_KTM = { lat: 3.0433, lon: 101.4497 }
const AMPANG_PARK_LRT = { lat: 3.1597, lon: 101.7193 }
/** Monday 09:00 Kuala Lumpur time. */
const MONDAY_0900_KL = new Date('2026-08-24T01:00:00Z')

async function routerReachable(): Promise<boolean> {
  try {
    const r = await fetch(new URL('/otp/gtfs/v1', OTP_BASE_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ feeds { feedId } }' }),
      signal: AbortSignal.timeout(3000),
    })
    return r.ok
  } catch {
    return false
  }
}

const reachable = await routerReachable()
if (!reachable) {
  console.warn(
    `[otp.itest] router not reachable at ${OTP_BASE_URL} — live routing tests SKIPPED. ` +
      'Start it with: docker compose --profile routing up -d otp',
  )
}

describe.skipIf(!reachable)('live routing — Klang Valley graph', () => {
  let client: OtpClient

  beforeAll(() => {
    client = createOtpClient({
      baseUrl: OTP_BASE_URL,
      routerRegion: 'klang-valley',
      routerZone: 'Asia/Kuala_Lumpur',
      feeds: [
        {
          feedId: 'ktmb',
          feedVersion: 'itest',
          agency: 'Keretapi Tanah Melayu',
          licence: 'CC BY 4.0',
          attribution: 'data.gov.my',
        },
        {
          feedId: 'prasarana-rapid-rail-kl',
          feedVersion: 'itest',
          agency: 'Rapid Rail',
          licence: 'CC BY 4.0',
          attribution: 'data.gov.my',
        },
      ],
      // Kuala Lumpur publishes VehiclePositions only (ADR-0022).
      feedsSupportTripUpdates: false,
      now: () => MONDAY_0900_KL,
      newId: uuidv7,
    })
  })

  it('finds a Komuter → LRT journey across two feeds', async () => {
    const outcome = await client.plan({
      from: KLANG_KTM,
      to: AMPANG_PARK_LRT,
      departAt: MONDAY_0900_KL,
      numItineraries: 5,
    })
    expect(outcome.kind).toBe('routes')
    if (outcome.kind !== 'routes') return

    const crossFeed = outcome.routes.find((r) => {
      const feeds = new Set(r.legs.filter(isTransitLeg).map((l) => l.feedId))
      return feeds.has('ktmb') && feeds.has('prasarana-rapid-rail-kl')
    })
    expect(crossFeed, 'no itinerary used both KTM and Rapid Rail').toBeDefined()
    if (!crossFeed) return

    const transit = crossFeed.legs.filter(isTransitLeg)
    expect(transit.length).toBeGreaterThanOrEqual(2)
    expect(crossFeed.transferCount).toBeGreaterThanOrEqual(1)

    // The transfer happens at a named station that both legs agree on.
    const komuter = transit.find((l) => l.feedId === 'ktmb')!
    const lrt = transit.find((l) => l.feedId === 'prasarana-rapid-rail-kl')!
    expect(komuter.alightStop.name.length).toBeGreaterThan(0)
    expect(lrt.boardStop.name.length).toBeGreaterThan(0)

    // Plausibility, not precision: a guessed duration would be a bug, but so
    // would a graph that routes Klang to central KL in nine minutes.
    expect(crossFeed.totalDurationSeconds).toBeGreaterThan(45 * 60)
    expect(crossFeed.totalDurationSeconds).toBeLessThan(4 * 3600)
    expect(crossFeed.startTime.getTime()).toBeGreaterThanOrEqual(MONDAY_0900_KL.getTime())
  })

  it('never claims live: every leg is scheduled and provenance is SCHEDULED', async () => {
    const outcome = await client.plan({
      from: KLANG_KTM,
      to: AMPANG_PARK_LRT,
      departAt: MONDAY_0900_KL,
    })
    expect(outcome.kind).toBe('routes')
    if (outcome.kind !== 'routes') return

    for (const route of outcome.routes) {
      expect(route.provenance.status).toBe('SCHEDULED')
      for (const leg of route.legs.filter(isTransitLeg)) {
        expect((leg as TransitLeg).realtime).toBeUndefined()
      }
    }
  })

  it('preserves absences: no platform or stop code is invented', async () => {
    const outcome = await client.plan({
      from: KLANG_KTM,
      to: AMPANG_PARK_LRT,
      departAt: MONDAY_0900_KL,
    })
    if (outcome.kind !== 'routes') throw new Error(outcome.kind)

    const legs = outcome.routes.flatMap((r: NormalizedRoute) => r.legs.filter(isTransitLeg))
    for (const leg of legs) {
      // These feeds do not publish platform codes. The normalizer must report
      // that as absence, not as '' or 'Platform 1'.
      expect(leg.boardStop.platform).toBeUndefined()
      expect(leg.alightStop.platform).toBeUndefined()
      expect(leg.scheduled.departure.getTime()).toBeLessThan(leg.scheduled.arrival.getTime())
    }
  })

  it('reports no-route for a destination outside the graph, not a guess', async () => {
    // Kota Kinabalu: ~1,600 km away and outside the clipped street graph.
    const outcome = await client.plan({
      from: KLANG_KTM,
      to: { lat: 5.9804, lon: 116.0735 },
      departAt: MONDAY_0900_KL,
    })
    expect(outcome.kind).not.toBe('routes')
  })

  it('plans in router-local time: a 09:00 KL departure leaves after 09:00 KL', async () => {
    const outcome = await client.plan({
      from: KLANG_KTM,
      to: AMPANG_PARK_LRT,
      departAt: MONDAY_0900_KL,
      numItineraries: 1,
    })
    if (outcome.kind !== 'routes') throw new Error(outcome.kind)
    const first = outcome.routes[0]!
    const kl = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(first.startTime)
    // Departure is on the morning of the request, not at 01:00 when nothing runs.
    expect(Number(kl)).toBeGreaterThanOrEqual(9)
    expect(Number(kl)).toBeLessThan(12)
  })
})
