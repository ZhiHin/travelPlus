import type { FeedRef, NormalizedRoute } from '@travelplus/domain'
import { safeFetch, type SafeFetchOptions } from '@travelplus/integrations'
import { MalformedRouteError, normalizeItinerary, type OtpItinerary } from './normalize.js'

/**
 * The OpenTripPlanner adapter.
 *
 * Targets OTP's GTFS GraphQL API and normalizes the response in one place, so an
 * upstream API change is contained here rather than spread across the product
 * (ADR-0002).
 *
 * The outcome type is the important part. Three situations that a naive client
 * conflates are kept distinct, because they mean different things to a traveller
 * and produce different screens:
 *
 *   `routes`      the router answered with journeys
 *   `no-route`    the router answered; no journey exists for this time and mode
 *   `unavailable` we could not ask
 *
 * Collapsing the middle two into "error" tells a user their trip is impossible
 * when the truth is "try again in a minute", or the reverse.
 */

export interface RouteQuery {
  readonly from: { readonly lat: number; readonly lon: number }
  readonly to: { readonly lat: number; readonly lon: number }
  /** Exactly one of these. `arriveBy` flips the search direction. */
  readonly departAt?: Date
  readonly arriveBy?: Date
  readonly modes?: readonly ('WALK' | 'TRANSIT' | 'BICYCLE' | 'CAR')[]
  readonly maxWalkMeters?: number
  readonly wheelchair?: boolean
  readonly numItineraries?: number
}

export type RouteOutcome =
  | { readonly kind: 'routes'; readonly routes: readonly NormalizedRoute[] }
  /** The router answered and no journey exists. Not retryable. */
  | { readonly kind: 'no-route'; readonly reason: string }
  /** We could not ask. Retryable. */
  | { readonly kind: 'unavailable'; readonly reason: string }

export interface OtpDeps {
  readonly baseUrl: string
  readonly routerRegion: string
  readonly feeds: readonly FeedRef[]
  /** Whether any backing feed publishes TripUpdates (ADR-0022). */
  readonly feedsSupportTripUpdates: boolean
  readonly now: () => Date
  readonly newId: () => string
  readonly timeoutMs?: number
  readonly fetchOptions?: Partial<SafeFetchOptions>
}

/**
 * The GraphQL document.
 *
 * Every optional field is requested explicitly. Asking for `platformCode` and
 * `wheelchairBoarding` even though most feeds omit them is deliberate: the
 * normalizer can only preserve an absence it was given the chance to observe.
 */
const PLAN_QUERY = `
query Plan(
  $fromLat: Float!, $fromLon: Float!, $toLat: Float!, $toLon: Float!,
  $date: String!, $time: String!, $arriveBy: Boolean!,
  $modes: [TransportMode!], $maxWalkDistance: Float, $wheelchair: Boolean,
  $numItineraries: Int
) {
  plan(
    from: { lat: $fromLat, lon: $fromLon }
    to: { lat: $toLat, lon: $toLon }
    date: $date
    time: $time
    arriveBy: $arriveBy
    transportModes: $modes
    maxWalkDistance: $maxWalkDistance
    wheelchair: $wheelchair
    numItineraries: $numItineraries
  ) {
    itineraries {
      startTime endTime duration walkDistance
      legs {
        mode startTime endTime duration distance transitLeg headsign realTime
        departureDelay arrivalDelay
        legGeometry { points }
        intermediateStops { gtfsId }
        route {
          shortName longName color mode
          agency { name gtfsId }
        }
        from { name lat lon stop { code platformCode wheelchairBoarding } }
        to   { name lat lon stop { code platformCode wheelchairBoarding } }
        alerts { alertHeaderText alertEffect }
      }
    }
  }
}`

interface GraphQlResponse {
  data?: { plan?: { itineraries?: OtpItinerary[] | null } | null } | null
  errors?: { message?: string }[]
}

export interface OtpClient {
  plan(query: RouteQuery): Promise<RouteOutcome>
}

export function createOtpClient(deps: OtpDeps): OtpClient {
  const host = new URL(deps.baseUrl).hostname

  return {
    async plan(query) {
      const when = query.departAt ?? query.arriveBy
      if (!when) {
        return { kind: 'unavailable', reason: 'Neither departAt nor arriveBy was supplied' }
      }
      if (query.departAt && query.arriveBy) {
        return { kind: 'unavailable', reason: 'Supply exactly one of departAt or arriveBy' }
      }

      const variables = {
        fromLat: query.from.lat,
        fromLon: query.from.lon,
        toLat: query.to.lat,
        toLon: query.to.lon,
        // OTP wants local date and time strings for the router's own zone.
        date: when.toISOString().slice(0, 10),
        time: when.toISOString().slice(11, 19),
        arriveBy: query.arriveBy !== undefined,
        modes: (query.modes ?? ['WALK', 'TRANSIT']).map((m) => ({ mode: m })),
        maxWalkDistance: query.maxWalkMeters ?? 2000,
        wheelchair: query.wheelchair ?? false,
        numItineraries: Math.min(query.numItineraries ?? 3, 5),
      }

      let body: string
      try {
        const response = await safeFetch(new URL('/otp/gtfs/v1', deps.baseUrl).toString(), {
          allowedHosts: [host],
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          jsonBody: { query: PLAN_QUERY, variables },
          timeoutMs: deps.timeoutMs ?? 15_000,
          ...deps.fetchOptions,
        })

        if (!response.ok) {
          return { kind: 'unavailable', reason: `Router returned ${response.status}` }
        }
        body = response.body
      } catch (error) {
        // Timeout, DNS failure, circuit open. All retryable, all "we could not
        // ask" rather than "no journey exists".
        return {
          kind: 'unavailable',
          reason: error instanceof Error ? error.message : 'Router unreachable',
        }
      }

      let parsed: GraphQlResponse
      try {
        parsed = JSON.parse(body) as GraphQlResponse
      } catch {
        return { kind: 'unavailable', reason: 'Router returned malformed JSON' }
      }

      if (parsed.errors?.length) {
        return {
          kind: 'unavailable',
          reason: parsed.errors[0]?.message ?? 'Router reported a query error',
        }
      }

      const itineraries = parsed.data?.plan?.itineraries ?? []
      if (itineraries.length === 0) {
        // The router answered. There is genuinely no journey — a different
        // situation from being unable to ask, and a different screen.
        return { kind: 'no-route', reason: 'No journey found for that time and travel mode' }
      }

      const context = {
        routerRegion: deps.routerRegion,
        feeds: deps.feeds,
        retrievedAt: deps.now(),
        feedsSupportTripUpdates: deps.feedsSupportTripUpdates,
        newId: deps.newId,
      }

      const routes: NormalizedRoute[] = []
      for (const itinerary of itineraries) {
        try {
          routes.push(normalizeItinerary(itinerary, context))
        } catch (error) {
          // One unusable itinerary among several is dropped; the rest still
          // help. A half-understood route is never returned.
          if (!(error instanceof MalformedRouteError)) throw error
        }
      }

      if (routes.length === 0) {
        return { kind: 'unavailable', reason: 'Router response could not be normalized' }
      }

      return { kind: 'routes', routes }
    },
  }
}
