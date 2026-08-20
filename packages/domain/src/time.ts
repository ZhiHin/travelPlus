/**
 * Time handling.
 *
 *   BR-TZ1  instants are UTC
 *   BR-TZ2  future wall-clock intentions also store local date, local time and IANA zone
 *   BR-TZ3  a local datetime without a zone is rejected
 *   BR-TZ4  a local time occurring twice (DST fall-back) is rejected with both candidates
 *   BR-TZ5  a local time that does not exist (DST spring-forward) is rejected with a suggestion
 *
 * "Dinner at 19:00 in Kuala Lumpur" is a wall-clock intention. "The train
 * departed" is an instant. Storing only one of those breaks across a DST
 * boundary or a border crossing, which is how a traveller misses a train.
 *
 * Resolution uses the platform's own IANA database via Intl, so there is no
 * network call and no bundled timezone dataset to drift out of date.
 */

/** A wall-clock intention: what a human means by "10:00 on this date, there". */
export interface LocalDateTime {
  /** ISO calendar date, `YYYY-MM-DD`. */
  readonly date: string
  /** 24-hour local time, `HH:MM`. */
  readonly time: string
  /** IANA zone identifier, e.g. `Asia/Kuala_Lumpur`. */
  readonly zone: string
}

export type ResolveResult =
  | { readonly kind: 'ok'; readonly instant: Date }
  /** DST fall-back: the wall clock passes this time twice. */
  | { readonly kind: 'ambiguous'; readonly candidates: readonly [Date, Date] }
  /** DST spring-forward: the wall clock skips this time entirely. */
  | { readonly kind: 'nonexistent'; readonly suggested: Date }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Offset in minutes that `zone` was at a given instant. */
function zoneOffsetMinutes(instant: Date, zone: string): number {
  // `en-US` with an explicit part list gives a stable, parseable breakdown.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return (asUtc - instant.getTime()) / 60_000
}

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a wall-clock intention to an instant.
 *
 * Rather than guessing through a DST transition, this reports `ambiguous` or
 * `nonexistent` so the caller can ask. Silently picking one interpretation is
 * how an itinerary ends up an hour wrong exactly once a year.
 */
export function resolveLocal(local: LocalDateTime): ResolveResult {
  if (!DATE_RE.test(local.date))
    throw new TypeError(`Invalid date "${local.date}", expected YYYY-MM-DD`)
  if (!TIME_RE.test(local.time)) throw new TypeError(`Invalid time "${local.time}", expected HH:MM`)
  if (!local.zone) throw new TypeError('A time zone is required (BR-TZ3)')
  if (!isValidZone(local.zone)) throw new TypeError(`Unknown IANA zone "${local.zone}"`)

  const [y, mo, d] = local.date.split('-').map(Number) as [number, number, number]
  const [h, mi] = local.time.split(':').map(Number) as [number, number]

  // Treat the wall-clock reading as if it were UTC, then correct by the offset
  // that actually applies. Two probes bracket any DST transition.
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0)

  const offsetBefore = zoneOffsetMinutes(new Date(naive - 86_400_000), local.zone)
  const offsetAfter = zoneOffsetMinutes(new Date(naive + 86_400_000), local.zone)

  const candidateFor = (offsetMinutes: number) => new Date(naive - offsetMinutes * 60_000)

  const a = candidateFor(offsetBefore)
  const b = candidateFor(offsetAfter)

  const roundTripsCleanly = (candidate: Date, offsetMinutes: number) =>
    zoneOffsetMinutes(candidate, local.zone) === offsetMinutes

  const aValid = roundTripsCleanly(a, offsetBefore)
  const bValid = roundTripsCleanly(b, offsetAfter)

  if (aValid && bValid) {
    if (a.getTime() === b.getTime()) return { kind: 'ok', instant: a }
    // Both readings are real: the clock passed this wall time twice.
    const [first, second] = a.getTime() < b.getTime() ? [a, b] : [b, a]
    return { kind: 'ambiguous', candidates: [first, second] }
  }

  if (aValid) return { kind: 'ok', instant: a }
  if (bValid) return { kind: 'ok', instant: b }

  // Neither reading round-trips: the wall clock skipped this time. Suggest the
  // instant the clock jumped to, which is the nearest time that does exist.
  const suggested = new Date(Math.min(a.getTime(), b.getTime()))
  return { kind: 'nonexistent', suggested }
}

/** Format an instant as a wall-clock reading in `zone`. */
export function toLocal(instant: Date, zone: string): LocalDateTime {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = dtf.formatToParts(instant)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    zone,
  }
}

/**
 * The local calendar date of an instant in a zone.
 *
 * BR-TZ8: an itinerary day boundary is the local date at the destination, not
 * UTC midnight. A 23:30 activity in Kuala Lumpur belongs to that evening, not
 * to the following UTC day.
 */
export function localDateOf(instant: Date, zone: string): string {
  return toLocal(instant, zone).date
}

export function addSeconds(instant: Date, seconds: number): Date {
  return new Date(instant.getTime() + seconds * 1000)
}

export function differenceSeconds(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 1000
}
