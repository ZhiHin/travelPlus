/**
 * The provider-neutral route model.
 *
 * This is the ONLY route shape the domain and UI ever see. Three properties are
 * enforced by the types themselves, because they carry the product's core claim:
 *
 *  1. `realtime` is optional with no default, so a live badge requires narrowing
 *     on its presence. "Render scheduled data as live" is not expressible.
 *  2. `platform` and `stopCode` are optional. Absent means the feed did not say,
 *     and the UI omits the row rather than inventing a plausible value.
 *  3. `provenance` is non-optional, so a route without provenance cannot be
 *     constructed at all.
 */

import type { DataStatus } from './status.js'

export interface GeoJsonLineString {
  readonly type: 'LineString'
  readonly coordinates: readonly (readonly [number, number])[]
}

export interface FeedRef {
  readonly feedId: string
  readonly feedVersion: string
  readonly agency: string
  readonly licence: string
  readonly attribution: string
}

export interface Provenance {
  readonly status: DataStatus
  /** When the provider answered. Required — freshness is derived from it. */
  readonly retrievedAt: Date
  readonly routerRegion: string
  readonly feeds: readonly FeedRef[]
}

export interface StopRef {
  readonly name: string
  readonly coord: readonly [number, number]
  /** Present only when the source feed supplied it. */
  readonly stopCode?: string
  /** Present only when the source feed supplied it. */
  readonly platform?: string
}

export type TransitMode = 'BUS' | 'RAIL' | 'SUBWAY' | 'TRAM' | 'FERRY' | 'CABLE' | 'OTHER'
export type AccessibilityConfidence = 'FEED' | 'INFERRED' | 'UNKNOWN'

export interface StreetLeg {
  readonly kind: 'WALK' | 'CYCLE' | 'DRIVE'
  readonly distanceMeters: number
  readonly durationSeconds: number
  readonly geometry: GeoJsonLineString
}

export interface TransitLeg {
  readonly kind: 'TRANSIT'
  readonly agency: string
  readonly mode: TransitMode
  readonly boardStop: StopRef
  readonly alightStop: StopRef
  readonly intermediateStopCount: number
  readonly scheduled: { readonly departure: Date; readonly arrival: Date }
  readonly geometry: GeoJsonLineString
  readonly feedId: string
  /** Present only when the feed supplied it. */
  readonly routeShortName?: string
  readonly routeLongName?: string
  readonly routeColor?: string
  readonly headsign?: string
  /** Present ONLY when a GTFS-RT TripUpdate supplied predictions. Never defaulted. */
  readonly realtime?: {
    readonly departure: Date
    readonly arrival: Date
    readonly delaySeconds: number
  }
  readonly alerts?: readonly { readonly header: string; readonly effect: string }[]
  /**
   * Absent means the feed carried no accessibility data at all. That is a
   * different statement from `{ wheelchairAccessible: false }`, and conflating
   * them is the failure mode persona P7 is most exposed to.
   */
  readonly accessibility?: {
    readonly wheelchairAccessible: boolean
    readonly confidence: AccessibilityConfidence
  }
}

export type RouteLeg = StreetLeg | TransitLeg

export interface NormalizedRoute {
  readonly id: string
  readonly provenance: Provenance
  readonly totalDurationSeconds: number
  readonly startTime: Date
  readonly endTime: Date
  readonly transferCount: number
  readonly walkDistanceMeters: number
  readonly geometry: GeoJsonLineString
  readonly legs: readonly RouteLeg[]
}

export function isTransitLeg(leg: RouteLeg): leg is TransitLeg {
  return leg.kind === 'TRANSIT'
}

/**
 * Whether a leg may be rendered with a live badge.
 *
 * Requires BOTH a realtime prediction on the leg AND a REALTIME provenance
 * status. A positions-only feed satisfies neither, so the Kuala Lumpur pilot
 * cannot reach this branch (ADR-0022).
 */
export function canShowLive(leg: RouteLeg, provenance: Provenance): boolean {
  return isTransitLeg(leg) && leg.realtime !== undefined && provenance.status === 'REALTIME'
}

/**
 * The departure time to display, and what it may be called.
 *
 * Returns the scheduled time unless a genuine prediction exists. The caller
 * cannot accidentally present the scheduled value under a live label because
 * the label travels with the value.
 */
export function displayDeparture(
  leg: TransitLeg,
  provenance: Provenance,
): { at: Date; basis: 'realtime' | 'scheduled' } {
  return canShowLive(leg, provenance) && leg.realtime !== undefined
    ? { at: leg.realtime.departure, basis: 'realtime' }
    : { at: leg.scheduled.departure, basis: 'scheduled' }
}

/** Attribution lines, rendered from stored feed metadata so they cannot drift. */
export function attributionLines(provenance: Provenance): string[] {
  return provenance.feeds.map((f) => `${f.attribution} (${f.agency}, ${f.feedVersion})`)
}

/** Distinct feed licences backing a route — surfaced in the data-source screen. */
export function licences(provenance: Provenance): string[] {
  return [...new Set(provenance.feeds.map((f) => f.licence))]
}
