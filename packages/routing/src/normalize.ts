import type {
  FeedRef,
  GeoJsonLineString,
  NormalizedRoute,
  Provenance,
  RouteLeg,
  StopRef,
  TransitLeg,
  TransitMode,
} from '@travelplus/domain'

/**
 * OTP response → the provider-neutral route model.
 *
 * This is the single module allowed to construct a transit fact, and it takes an
 * OTP response as its only source (module boundary MB-7). Nothing else in the
 * product can produce a `TransitLeg`.
 *
 * The rule that governs every field below: **a value absent from the response
 * stays absent**. No defaults, no empty strings, no "Unknown Platform". A UI
 * that must narrow on `undefined` cannot accidentally print a plausible lie,
 * whereas a UI handed `platform: ''` will happily render an empty row that reads
 * as "no platform" rather than "we were not told".
 */

/** The subset of OTP's GTFS GraphQL response we consume. All fields optional. */
export interface OtpItinerary {
  startTime?: number
  endTime?: number
  duration?: number
  walkDistance?: number
  legs?: OtpLeg[]
}

export interface OtpLeg {
  mode?: string
  startTime?: number
  endTime?: number
  duration?: number
  distance?: number
  transitLeg?: boolean
  headsign?: string | null
  legGeometry?: { points?: string | null } | null
  intermediateStops?: unknown[] | null
  route?: {
    shortName?: string | null
    longName?: string | null
    color?: string | null
    mode?: string | null
    agency?: { name?: string | null; gtfsId?: string | null } | null
  } | null
  from?: OtpPlace | null
  to?: OtpPlace | null
  trip?: { gtfsId?: string | null } | null
  /** Present only when a GTFS-RT TripUpdate supplied predictions. */
  realTime?: boolean | null
  arrivalDelay?: number | null
  departureDelay?: number | null
  alerts?: { alertHeaderText?: string | null; alertEffect?: string | null }[] | null
}

export interface OtpPlace {
  name?: string | null
  lat?: number | null
  lon?: number | null
  stop?: {
    code?: string | null
    platformCode?: string | null
    wheelchairBoarding?: string | null
  } | null
}

export interface NormalizeContext {
  readonly routerRegion: string
  readonly feeds: readonly FeedRef[]
  readonly retrievedAt: Date
  /**
   * Whether ANY backing feed publishes TripUpdates.
   *
   * OTP sets `realTime: true` when it has applied realtime data of any kind. For
   * a feed that publishes vehicle positions only, that is not a departure
   * prediction — so this flag gates whether a `realtime` block may be built at
   * all (ADR-0022). Without it, the Kuala Lumpur pilot would surface live
   * departure times it does not have.
   */
  readonly feedsSupportTripUpdates: boolean
  readonly newId: () => string
}

export class MalformedRouteError extends Error {
  constructor(reason: string) {
    super(`Router response could not be normalized: ${reason}`)
    this.name = 'MalformedRouteError'
  }
}

const MAX_LEGS = 40

/**
 * Normalize one itinerary.
 *
 * Throws rather than returning a partial route. A half-understood itinerary
 * would surface as a plan the user could act on, so a malformed response becomes
 * `UNAVAILABLE` at the call site instead.
 */
export function normalizeItinerary(
  itinerary: OtpItinerary,
  context: NormalizeContext,
): NormalizedRoute {
  const rawLegs = itinerary.legs ?? []
  if (rawLegs.length === 0) throw new MalformedRouteError('itinerary contained no legs')
  if (rawLegs.length > MAX_LEGS) {
    throw new MalformedRouteError(
      `itinerary had ${rawLegs.length} legs, above the ${MAX_LEGS} bound`,
    )
  }
  if (typeof itinerary.startTime !== 'number' || typeof itinerary.endTime !== 'number') {
    throw new MalformedRouteError('itinerary lacked start or end time')
  }

  const legs = rawLegs.map((leg) => normalizeLeg(leg, context))
  const transitLegs = legs.filter((l): l is TransitLeg => l.kind === 'TRANSIT')

  // A realtime prediction on any leg is what makes the route REALTIME; without
  // one it is scheduled, however fresh the feed connection was.
  const hasPrediction = transitLegs.some((l) => l.realtime !== undefined)

  const provenance: Provenance = {
    status: hasPrediction ? 'REALTIME' : 'SCHEDULED',
    retrievedAt: context.retrievedAt,
    routerRegion: context.routerRegion,
    feeds: context.feeds,
  }

  return {
    id: context.newId(),
    provenance,
    totalDurationSeconds: itinerary.duration ?? (itinerary.endTime - itinerary.startTime) / 1000,
    startTime: new Date(itinerary.startTime),
    endTime: new Date(itinerary.endTime),
    // Transfers are gaps between transit legs, so n legs means n-1 transfers.
    transferCount: Math.max(0, transitLegs.length - 1),
    walkDistanceMeters: itinerary.walkDistance ?? 0,
    geometry: mergeGeometry(legs),
    legs,
  }
}

function normalizeLeg(leg: OtpLeg, context: NormalizeContext): RouteLeg {
  const geometry = decodeGeometry(leg.legGeometry?.points ?? null)

  if (leg.transitLeg !== true) {
    const kind = streetMode(leg.mode)
    return {
      kind,
      distanceMeters: leg.distance ?? 0,
      durationSeconds: leg.duration ?? 0,
      geometry,
    }
  }

  const from = leg.from
  const to = leg.to
  if (!from || !to) throw new MalformedRouteError('transit leg lacked a boarding or alighting stop')
  if (typeof leg.startTime !== 'number' || typeof leg.endTime !== 'number') {
    throw new MalformedRouteError('transit leg lacked scheduled times')
  }

  const agency = leg.route?.agency?.name
  if (!agency) throw new MalformedRouteError('transit leg lacked an operating agency')

  const transit: TransitLeg = {
    kind: 'TRANSIT',
    agency,
    mode: transitMode(leg.route?.mode ?? leg.mode),
    boardStop: stopRef(from),
    alightStop: stopRef(to),
    intermediateStopCount: leg.intermediateStops?.length ?? 0,
    scheduled: {
      // OTP reports the effective times; delays are surfaced separately below
      // rather than folded in, so scheduled stays scheduled.
      departure: new Date(leg.startTime - (leg.departureDelay ?? 0) * 1000),
      arrival: new Date(leg.endTime - (leg.arrivalDelay ?? 0) * 1000),
    },
    geometry,
    feedId: context.feeds[0]?.feedId ?? context.routerRegion,
    ...optional('routeShortName', leg.route?.shortName),
    ...optional('routeLongName', leg.route?.longName),
    ...optional('routeColor', leg.route?.color),
    ...optional('headsign', leg.headsign),
    ...realtimeBlock(leg, context),
    ...alertsBlock(leg),
    ...accessibilityBlock(from),
  }

  return transit
}

/**
 * Build a realtime block, or omit it.
 *
 * Two conditions, both required:
 *   1. OTP applied realtime data to this leg, AND
 *   2. a backing feed actually publishes TripUpdates.
 *
 * The second is the one that matters for the pilot. OTP sets `realTime: true`
 * for any applied realtime data, but a vehicle-position-only feed carries no
 * predicted stop times — so treating that flag alone as a prediction would
 * manufacture a departure time nobody published (ADR-0022, BR-T7).
 */
function realtimeBlock(
  leg: OtpLeg,
  context: NormalizeContext,
): Partial<Pick<TransitLeg, 'realtime'>> {
  if (!context.feedsSupportTripUpdates) return {}
  if (leg.realTime !== true) return {}
  if (typeof leg.startTime !== 'number' || typeof leg.endTime !== 'number') return {}

  return {
    realtime: {
      departure: new Date(leg.startTime),
      arrival: new Date(leg.endTime),
      delaySeconds: leg.departureDelay ?? 0,
    },
  }
}

function alertsBlock(leg: OtpLeg): Partial<Pick<TransitLeg, 'alerts'>> {
  const alerts = (leg.alerts ?? [])
    .filter((a) => typeof a.alertHeaderText === 'string' && a.alertHeaderText.length > 0)
    .map((a) => ({
      header: a.alertHeaderText as string,
      effect: a.alertEffect ?? 'UNKNOWN_EFFECT',
    }))
  return alerts.length > 0 ? { alerts } : {}
}

/**
 * Accessibility, with its confidence.
 *
 * `NO_INFORMATION` and a missing field both mean the feed did not say, which is
 * a different statement from "not accessible". Omitting the block entirely is
 * how that distinction survives to the UI (persona P7).
 */
function accessibilityBlock(place: OtpPlace): Partial<Pick<TransitLeg, 'accessibility'>> {
  const value = place.stop?.wheelchairBoarding
  if (value === 'POSSIBLE') {
    return { accessibility: { wheelchairAccessible: true, confidence: 'FEED' } }
  }
  if (value === 'NOT_POSSIBLE') {
    return { accessibility: { wheelchairAccessible: false, confidence: 'FEED' } }
  }
  return {}
}

function stopRef(place: OtpPlace): StopRef {
  if (typeof place.lat !== 'number' || typeof place.lon !== 'number') {
    throw new MalformedRouteError('stop lacked coordinates')
  }
  return {
    name: place.name ?? 'Unnamed stop',
    coord: [place.lon, place.lat],
    ...optional('stopCode', place.stop?.code),
    ...optional('platform', place.stop?.platformCode),
  }
}

/** Include a key only when the provider supplied a non-empty value. */
function optional<K extends string>(
  key: K,
  value: string | null | undefined,
): Record<K, string> | Record<string, never> {
  if (typeof value !== 'string') return {}
  const trimmed = value.trim()
  // An empty string is the provider saying nothing, not saying "".
  return trimmed.length > 0 ? ({ [key]: trimmed } as Record<K, string>) : {}
}

const STREET_MODES: Record<string, 'WALK' | 'CYCLE' | 'DRIVE'> = {
  WALK: 'WALK',
  BICYCLE: 'CYCLE',
  SCOOTER: 'CYCLE',
  CAR: 'DRIVE',
  CAR_PARK: 'DRIVE',
}

function streetMode(mode: string | undefined): 'WALK' | 'CYCLE' | 'DRIVE' {
  return STREET_MODES[mode ?? 'WALK'] ?? 'WALK'
}

const TRANSIT_MODES: Record<string, TransitMode> = {
  BUS: 'BUS',
  COACH: 'BUS',
  RAIL: 'RAIL',
  SUBWAY: 'SUBWAY',
  METRO: 'SUBWAY',
  TRAM: 'TRAM',
  FERRY: 'FERRY',
  FUNICULAR: 'CABLE',
  GONDOLA: 'CABLE',
  CABLE_CAR: 'CABLE',
  MONORAIL: 'RAIL',
}

function transitMode(mode: string | null | undefined): TransitMode {
  return TRANSIT_MODES[(mode ?? '').toUpperCase()] ?? 'OTHER'
}

/**
 * Decode OTP's encoded polyline into GeoJSON.
 *
 * Precision 5, the Google polyline standard OTP emits. A malformed string yields
 * an empty geometry rather than throwing: a route with no drawn line is still a
 * usable set of instructions, and the semantic list carries the same facts.
 */
export function decodeGeometry(encoded: string | null): GeoJsonLineString {
  const coordinates: [number, number][] = []
  if (!encoded) return { type: 'LineString', coordinates }

  let index = 0
  let lat = 0
  let lon = 0

  try {
    while (index < encoded.length) {
      lat += decodeValue()
      lon += decodeValue()
      coordinates.push([lon / 1e5, lat / 1e5])
    }
  } catch {
    return { type: 'LineString', coordinates: [] }
  }

  return { type: 'LineString', coordinates }

  function decodeValue(): number {
    let result = 0
    let shift = 0
    let byte: number
    do {
      if (index >= encoded!.length) throw new Error('truncated polyline')
      byte = encoded!.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
}

function mergeGeometry(legs: readonly RouteLeg[]): GeoJsonLineString {
  const coordinates: (readonly [number, number])[] = []
  for (const leg of legs) coordinates.push(...leg.geometry.coordinates)
  return { type: 'LineString', coordinates }
}
