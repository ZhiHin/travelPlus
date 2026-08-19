/**
 * Data-confidence status and its derivation.
 *
 * This file implements the product's central truth rules. Read
 * docs/phase-0/06-BUSINESS-RULES.md §1 before changing anything here.
 *
 *   BR-T5  status is derived on read, never stored as a static label
 *   BR-T6  REALTIME requires a successful realtime fetch inside the freshness window
 *   BR-T7  a feed publishing vehicle positions but not trip updates can never yield REALTIME
 *
 * BR-T7 is why `FeedCapabilities` exists. The Kuala Lumpur pilot publishes
 * GTFS-Realtime VehiclePosition only, and VehiclePosition carries no predicted
 * stop times, so a live departure badge there would be a fabrication (ADR-0022).
 */

/** The six confidence states. One vocabulary across database, API and UI. */
export const DATA_STATUSES = [
  'REALTIME',
  'SCHEDULED',
  'ESTIMATED',
  'MANUAL',
  'STALE',
  'UNAVAILABLE',
] as const

export type DataStatus = (typeof DATA_STATUSES)[number]

/**
 * What a realtime feed actually publishes.
 *
 * Deliberately not a single `hasRealtime` boolean: "has a realtime feed" and
 * "can predict a departure time" are different claims, and conflating them is
 * exactly the failure this type prevents.
 */
export interface FeedCapabilities {
  /** GTFS-RT TripUpdate — carries StopTimeUpdate predictions. The only source of REALTIME. */
  readonly tripUpdates: boolean
  /** GTFS-RT VehiclePosition — position/bearing/occupancy. Never a prediction. */
  readonly vehiclePositions: boolean
  /** GTFS-RT Alert — service disruption text. */
  readonly serviceAlerts: boolean
}

export interface FeedHealth {
  readonly capabilities: FeedCapabilities
  /** Last successful realtime poll, or null if realtime has never succeeded. */
  readonly lastSuccessAt: Date | null
  /** How long a successful poll stays trustworthy. */
  readonly freshnessWindowSeconds: number
}

/**
 * Derive the status of a transit result at read time.
 *
 * Pure and total: same inputs always give the same answer, and every branch
 * returns. `now` is injected rather than read from the clock so the
 * REALTIME -> STALE transition is testable by advancing time alone, with no
 * new data arriving (see RISKS.md R-15).
 */
export function deriveTransitStatus(feed: FeedHealth, now: Date): DataStatus {
  // BR-T7. No trip updates means no predictions exist, however fresh the feed is.
  if (!feed.capabilities.tripUpdates) return 'SCHEDULED'

  if (feed.lastSuccessAt === null) return 'SCHEDULED'

  const ageSeconds = (now.getTime() - feed.lastSuccessAt.getTime()) / 1000

  // A future timestamp means clock skew, not freshness. Do not claim live.
  if (ageSeconds < 0) return 'STALE'

  return ageSeconds < feed.freshnessWindowSeconds ? 'REALTIME' : 'STALE'
}

/** Statuses that may be presented to a user as live information. */
export function isLive(status: DataStatus): status is 'REALTIME' {
  return status === 'REALTIME'
}

/**
 * Whether a status must be rendered with an age alongside it.
 *
 * "Live" without an age is a claim nobody can check, so the UI is required to
 * show retrieval time for both REALTIME and STALE.
 */
export function requiresAgeDisplay(status: DataStatus): boolean {
  return status === 'REALTIME' || status === 'STALE'
}

/**
 * Fixed user-facing vocabulary. Six phrases, one per status, no synonyms —
 * someone who learns "scheduled" once should never later meet "timetabled".
 */
export const STATUS_LABEL: Readonly<Record<DataStatus, string>> = Object.freeze({
  REALTIME: 'live',
  SCHEDULED: 'scheduled',
  ESTIMATED: 'estimated',
  MANUAL: 'you entered this',
  STALE: 'out of date',
  UNAVAILABLE: 'not available',
})

/**
 * Non-colour channels for each status.
 *
 * WCAG 2.2 AA forbids conveying meaning by colour alone, and transit confidence
 * is meaning. Stroke and node shape carry the same signal, which is also what
 * makes the six states legible in greyscale (docs/phase-0/24-ACCESSIBILITY.md §1).
 */
export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export type NodeStyle = 'filled' | 'filled-pulse' | 'filled-outlined' | 'hollow'

export const STATUS_STROKE: Readonly<Record<DataStatus, StrokeStyle>> = Object.freeze({
  REALTIME: 'solid',
  SCHEDULED: 'solid',
  ESTIMATED: 'dashed',
  MANUAL: 'solid',
  STALE: 'dashed',
  UNAVAILABLE: 'dotted',
})

export const STATUS_NODE: Readonly<Record<DataStatus, NodeStyle>> = Object.freeze({
  REALTIME: 'filled-pulse',
  SCHEDULED: 'filled',
  ESTIMATED: 'filled',
  MANUAL: 'filled-outlined',
  STALE: 'hollow',
  UNAVAILABLE: 'hollow',
})
