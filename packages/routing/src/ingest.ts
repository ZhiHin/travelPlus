import { createHash } from 'node:crypto'

/**
 * GTFS feed ingestion.
 *
 * The pipeline exists to make one thing impossible: ingesting a feed whose
 * licence nobody verified. `transit_feeds.licence` is `NOT NULL` with a `CHECK`
 * rejecting placeholder values, so the database refuses the row — but failing at
 * the last step wastes a download and reports the problem as a constraint
 * violation rather than as what it is. This gates it first, with a message that
 * names the actual problem.
 *
 * Steps, in order:
 *   1. licence gate      — refuse before spending anything
 *   2. fetch             — through the shared portal rate limit
 *   3. checksum          — so a re-ingest of identical bytes is a no-op
 *   4. validate          — service dates, required files, feed shape
 *   5. record            — version, provenance, health
 *
 * A graph build follows separately, because it is expensive and should not be
 * triggered by an unchanged feed.
 */

export interface FeedDefinition {
  readonly feedId: string
  readonly agency: string
  readonly url: string
  /**
   * The verified licence. There is deliberately no default and no 'unknown'
   * sentinel: a caller that has not checked cannot express that state.
   */
  readonly licence: string
  readonly attribution: string
  readonly licenceVerifiedAt: Date
  readonly capabilities: {
    readonly tripUpdates: boolean
    readonly vehiclePositions: boolean
    readonly serviceAlerts: boolean
  }
}

/** Values that look like a licence but are an admission of not having checked. */
const PLACEHOLDER_LICENCES = new Set([
  '',
  'unknown',
  'tbd',
  'todo',
  'n/a',
  'na',
  'none',
  'pending',
  'pending-verification',
  'see terms',
  '?',
])

export class UnverifiedLicenceError extends Error {
  constructor(feedId: string, given: string) {
    super(
      `Refusing to ingest "${feedId}": licence is "${given}", which is not a verified licence. ` +
        `A human must confirm the publisher's terms and record the actual licence ` +
        `(for example "CC BY 4.0") before this feed can be used.`,
    )
    this.name = 'UnverifiedLicenceError'
  }
}

/**
 * The gate. Runs before the fetch, so an unverified feed costs nothing.
 *
 * Checks the shape of the claim rather than its truth — no code can verify that
 * a human actually read the terms. What it can do is refuse the values people
 * type when they have not.
 */
export function assertLicenceVerified(feed: FeedDefinition, now: Date): void {
  const licence = feed.licence.trim()

  if (PLACEHOLDER_LICENCES.has(licence.toLowerCase())) {
    throw new UnverifiedLicenceError(feed.feedId, feed.licence)
  }
  if (licence.length < 3) {
    throw new UnverifiedLicenceError(feed.feedId, feed.licence)
  }
  if (feed.attribution.trim().length === 0) {
    throw new UnverifiedLicenceError(feed.feedId, 'attribution is empty')
  }
  // A verification date in the future is a typo or a fabrication; either way it
  // is not evidence that anyone checked.
  if (feed.licenceVerifiedAt.getTime() > now.getTime()) {
    throw new UnverifiedLicenceError(feed.feedId, 'licenceVerifiedAt is in the future')
  }
}

export interface FeedArchive {
  readonly bytes: Uint8Array
  readonly checksum: string
  readonly retrievedAt: Date
}

export function checksumOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export interface ValidationReport {
  readonly ok: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly serviceStart: string | null
  readonly serviceEnd: string | null
}

/** Files GTFS requires. A feed missing any of them will not build a graph. */
const REQUIRED_FILES = ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']

export interface FeedContents {
  /** Filenames present in the archive. */
  readonly files: readonly string[]
  /** Service window, parsed from calendar.txt or calendar_dates.txt. */
  readonly serviceStart: string | null
  readonly serviceEnd: string | null
  readonly tripCount: number
  readonly stopCount: number
}

/**
 * Validate a feed against the trip dates it will be used for.
 *
 * Service dates matter more than they look: a structurally perfect feed whose
 * calendar ended last month produces confident, wrong routes. That is worse than
 * no routes, so it is an error rather than a warning.
 */
export function validateFeed(
  contents: FeedContents,
  planningWindow: { readonly from: Date; readonly to: Date },
): ValidationReport {
  const errors: string[] = []
  const warnings: string[] = []

  for (const required of REQUIRED_FILES) {
    if (!contents.files.includes(required)) errors.push(`missing required file ${required}`)
  }

  if (contents.tripCount === 0) errors.push('feed contains no trips')
  if (contents.stopCount === 0) errors.push('feed contains no stops')

  if (!contents.serviceStart || !contents.serviceEnd) {
    errors.push('feed declares no service window')
  } else {
    const start = new Date(`${contents.serviceStart}T00:00:00Z`)
    const end = new Date(`${contents.serviceEnd}T23:59:59Z`)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      errors.push('service window dates are unparseable')
    } else if (end < planningWindow.from) {
      errors.push(
        `service window ended ${contents.serviceEnd}, before the planning window opens — ` +
          `routing against it would produce confident, wrong departures`,
      )
    } else if (start > planningWindow.to) {
      errors.push(
        `service window starts ${contents.serviceStart}, after the planning window closes`,
      )
    } else if (end < planningWindow.to) {
      // Partial coverage is usable, but the user must not be told a journey
      // exists on a date the feed does not cover.
      warnings.push(
        `service window ends ${contents.serviceEnd}, before the planning window closes — ` +
          `later dates will have no transit`,
      )
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    serviceStart: contents.serviceStart,
    serviceEnd: contents.serviceEnd,
  }
}

export type IngestOutcome =
  | { readonly kind: 'ingested'; readonly checksum: string; readonly report: ValidationReport }
  /** Bytes identical to the stored version. No graph rebuild needed. */
  | { readonly kind: 'unchanged'; readonly checksum: string }
  | { readonly kind: 'rejected'; readonly report: ValidationReport }

export interface IngestDeps {
  /** Fetches the archive, through the shared portal rate limit. */
  readonly fetchFeed: (url: string) => Promise<Uint8Array>
  /** Reads the archive's manifest without extracting it fully. */
  readonly inspect: (bytes: Uint8Array) => Promise<FeedContents>
  /** The checksum currently stored for this feed, if any. */
  readonly storedChecksum: (feedId: string) => Promise<string | null>
  readonly now: () => Date
}

/**
 * Ingest one feed.
 *
 * Ordered so the cheapest refusal comes first: the licence gate runs before the
 * download, and the checksum comparison runs before validation. A daily poll of
 * an unchanged feed therefore costs one request and no parsing.
 */
export async function ingestFeed(
  feed: FeedDefinition,
  planningWindow: { readonly from: Date; readonly to: Date },
  deps: IngestDeps,
): Promise<IngestOutcome> {
  const now = deps.now()

  // Before anything is spent.
  assertLicenceVerified(feed, now)

  const bytes = await deps.fetchFeed(feed.url)
  const checksum = checksumOf(bytes)

  const stored = await deps.storedChecksum(feed.feedId)
  if (stored === checksum) {
    // Identical bytes. Re-validating and rebuilding a graph would burn minutes
    // for a guaranteed-identical result.
    return { kind: 'unchanged', checksum }
  }

  const contents = await deps.inspect(bytes)
  const report = validateFeed(contents, planningWindow)

  if (!report.ok) return { kind: 'rejected', report }

  return { kind: 'ingested', checksum, report }
}

/**
 * The Kuala Lumpur pilot feeds.
 *
 * Licence verified 2026-08-21 from the data.gov.my developer FAQ: CC BY 4.0,
 * which permits derivative works and redistribution — a routing graph built from
 * these feeds is exactly that case.
 *
 * Attribution carries the "indicate modifications" element CC BY 4.0 requires,
 * because we do not serve the feed as published; we serve routes computed from it.
 */
const DATA_GOV_MY_ATTRIBUTION =
  'Transit data © Kerajaan Malaysia (data.gov.my), CC BY 4.0. ' +
  'Modified: schedules built into a routing graph.'

const LICENCE_VERIFIED_AT = new Date('2026-08-21T00:00:00Z')

/** No feed here publishes TripUpdates, which is why the pilot ships at T2. */
const KL_CAPABILITIES = {
  tripUpdates: false,
  vehiclePositions: true,
  serviceAlerts: false,
} as const

export const KLANG_VALLEY_FEEDS: readonly FeedDefinition[] = Object.freeze([
  Object.freeze({
    feedId: 'prasarana-rapid-rail-kl',
    agency: 'Prasarana',
    url: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl',
    licence: 'CC BY 4.0',
    attribution: DATA_GOV_MY_ATTRIBUTION,
    licenceVerifiedAt: LICENCE_VERIFIED_AT,
    capabilities: KL_CAPABILITIES,
  }),
  Object.freeze({
    feedId: 'prasarana-rapid-bus-kl',
    agency: 'Prasarana',
    url: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl',
    licence: 'CC BY 4.0',
    attribution: DATA_GOV_MY_ATTRIBUTION,
    licenceVerifiedAt: LICENCE_VERIFIED_AT,
    capabilities: KL_CAPABILITIES,
  }),
  Object.freeze({
    feedId: 'prasarana-rapid-bus-mrtfeeder',
    agency: 'Prasarana',
    url: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder',
    licence: 'CC BY 4.0',
    attribution: DATA_GOV_MY_ATTRIBUTION,
    licenceVerifiedAt: LICENCE_VERIFIED_AT,
    capabilities: KL_CAPABILITIES,
  }),
  Object.freeze({
    feedId: 'ktmb',
    agency: 'KTMB',
    url: 'https://api.data.gov.my/gtfs-static/ktmb',
    licence: 'CC BY 4.0',
    attribution: DATA_GOV_MY_ATTRIBUTION,
    licenceVerifiedAt: LICENCE_VERIFIED_AT,
    capabilities: KL_CAPABILITIES,
  }),
])

/**
 * OTP requires each GTFS filename to contain `gtfs`.
 *
 * Verified from the OTP Basic Tutorial, 2026-08-19. The portal serves these from
 * query-string URLs with no useful filename, so the fetch script must rename
 * them or the graph build silently ignores the feed.
 */
export function otpFilenameFor(feed: FeedDefinition): string {
  return `${feed.feedId}-gtfs.zip`
}
