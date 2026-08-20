/**
 * Coverage tiers.
 *
 * "Global by architecture, regional by data." A destination's tier is derived
 * from what has actually been installed for it, and is shown to the user BEFORE
 * they commit to planning there — so a gap is a known condition rather than a
 * discovery made mid-trip.
 *
 * The tier is never client-supplied (BR-TR4). It is computed here from region
 * and feed facts, so the UI cannot claim coverage that does not exist.
 */

import type { FeedCapabilities } from './status.js'

export const COVERAGE_TIERS = ['T0', 'T1', 'T2', 'T3'] as const
export type CoverageTier = (typeof COVERAGE_TIERS)[number]

export interface FeedFacts {
  readonly capabilities: FeedCapabilities
  /** Whether the feed's service dates cover the dates being planned. */
  readonly serviceDatesCover: boolean
  /** Realtime freshness, when the feed publishes predictions at all. */
  readonly lastSuccessAt: Date | null
  readonly freshnessWindowSeconds: number
}

export interface RegionFacts {
  /** A built, active routing graph exists for this area. */
  readonly hasStreetGraph: boolean
  readonly feeds: readonly FeedFacts[]
}

/**
 * Derive the tier.
 *
 *   T0  nothing installed        → manual entry and external links only
 *   T1  street graph only        → walking, cycling, driving
 *   T2  + valid schedule data    → transit, labelled SCHEDULED
 *   T3  + live predictions       → transit, labelled REALTIME while fresh
 *
 * T3 requires `tripUpdates`, not merely "a realtime feed". The Kuala Lumpur
 * pilot publishes GTFS-RT VehiclePosition only, and vehicle positions carry no
 * predicted stop times — so KL derives T2 no matter how fresh its feed is
 * (ADR-0022). A moving marker on a map is not an arrival prediction.
 */
export function deriveCoverageTier(region: RegionFacts | null, now: Date): CoverageTier {
  if (!region?.hasStreetGraph) return 'T0'

  const usable = region.feeds.filter((f) => f.serviceDatesCover)
  if (usable.length === 0) return 'T1'

  const hasFreshPredictions = usable.some(
    (f) =>
      f.capabilities.tripUpdates &&
      f.lastSuccessAt !== null &&
      now.getTime() - f.lastSuccessAt.getTime() < f.freshnessWindowSeconds * 1000 &&
      now.getTime() >= f.lastSuccessAt.getTime(),
  )

  return hasFreshPredictions ? 'T3' : 'T2'
}

export interface TierDescription {
  readonly badge: string
  readonly summary: string
  /** What the user can still do. Never empty — a gap always has a next step. */
  readonly available: readonly string[]
}

/**
 * User-facing description of a tier.
 *
 * Every tier lists what IS available, including T0. An unavailable state that
 * offers no next step is an error screen wearing a badge, and this product
 * treats gaps as designed states (FR-12.6).
 */
export const TIER_DESCRIPTION: Readonly<Record<CoverageTier, TierDescription>> = Object.freeze({
  T0: {
    badge: 'No routing data',
    summary: "We don't have map or transit data for this area yet.",
    available: ['Add places manually', 'Open directions in another app'],
  },
  T1: {
    badge: 'Walking and driving only',
    summary: 'We can route on streets here, but we have no transit schedules.',
    available: ['Walking routes', 'Cycling routes', 'Driving routes', 'Add transit legs manually'],
  },
  T2: {
    badge: 'Scheduled transit',
    summary: 'Transit routing uses published timetables. Live departures are not available here.',
    available: ['Transit routes', 'Walking, cycling and driving', 'Scheduled departure times'],
  },
  T3: {
    badge: 'Live transit',
    summary: 'Transit routing includes live departure predictions.',
    available: ['Live departures', 'Delay information', 'Transit routes', 'Walking and driving'],
  },
})

/** True when transit routing can be offered at all. */
export function supportsTransit(tier: CoverageTier): boolean {
  return tier === 'T2' || tier === 'T3'
}

/** True when a live badge may ever be shown for this tier. */
export function supportsRealtime(tier: CoverageTier): boolean {
  return tier === 'T3'
}

/**
 * The tier for a whole trip.
 *
 * The MINIMUM across destinations, not the maximum. A trip that is T3 in one
 * city and T1 in another must not advertise "live transit" — the traveller
 * would reasonably expect it everywhere. Per-leg labelling still uses each
 * destination's own tier.
 */
export function tripCoverageTier(tiers: readonly CoverageTier[]): CoverageTier {
  if (tiers.length === 0) return 'T0'
  return tiers.reduce((worst, t) =>
    COVERAGE_TIERS.indexOf(t) < COVERAGE_TIERS.indexOf(worst) ? t : worst,
  )
}
