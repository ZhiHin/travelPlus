import { describe, expect, it, vi } from 'vitest'
import {
  KLANG_VALLEY_FEEDS,
  UnverifiedLicenceError,
  assertLicenceVerified,
  checksumOf,
  ingestFeed,
  otpFilenameFor,
  validateFeed,
  type FeedContents,
  type FeedDefinition,
  type IngestDeps,
} from './ingest.js'

const NOW = new Date('2026-08-21T10:00:00Z')
const WINDOW = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-30T00:00:00Z') }

function feed(over: Partial<FeedDefinition> = {}): FeedDefinition {
  return {
    feedId: 'test-feed',
    agency: 'Test Agency',
    url: 'https://api.data.gov.my/gtfs-static/test',
    licence: 'CC BY 4.0',
    attribution: 'Data © Someone, CC BY 4.0',
    licenceVerifiedAt: new Date('2026-08-01T00:00:00Z'),
    capabilities: { tripUpdates: false, vehiclePositions: true, serviceAlerts: false },
    ...over,
  }
}

function contents(over: Partial<FeedContents> = {}): FeedContents {
  return {
    files: ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt'],
    serviceStart: '2026-01-01',
    serviceEnd: '2027-01-01',
    tripCount: 5000,
    stopCount: 400,
    ...over,
  }
}

/**
 * The gate exists because R-17 was a real, blocking risk for two days. It cannot
 * verify that a human read the terms — no code can — but it can refuse the
 * values people type when they have not.
 */
describe('the licence gate', () => {
  it('accepts a real licence', () => {
    expect(() => assertLicenceVerified(feed(), NOW)).not.toThrow()
  })

  it('refuses every placeholder people actually type', () => {
    for (const placeholder of [
      '',
      '  ',
      'unknown',
      'UNKNOWN',
      'TBD',
      'todo',
      'N/A',
      'none',
      'pending',
      '?',
    ]) {
      expect(() => assertLicenceVerified(feed({ licence: placeholder }), NOW), placeholder).toThrow(
        UnverifiedLicenceError,
      )
    }
  })

  it('refuses "pending-verification", which an earlier fixture used', () => {
    expect(() => assertLicenceVerified(feed({ licence: 'PENDING-VERIFICATION' }), NOW)).toThrow(
      UnverifiedLicenceError,
    )
  })

  it('refuses an empty attribution, since CC BY is meaningless without it', () => {
    expect(() => assertLicenceVerified(feed({ attribution: '   ' }), NOW)).toThrow(
      UnverifiedLicenceError,
    )
  })

  // A future date is a typo or a fabrication; either way it is not evidence.
  it('refuses a verification date in the future', () => {
    expect(() =>
      assertLicenceVerified(feed({ licenceVerifiedAt: new Date('2027-01-01') }), NOW),
    ).toThrow(/future/)
  })

  it('names the feed and the offending value in the message', () => {
    try {
      assertLicenceVerified(feed({ feedId: 'ktmb', licence: 'TBD' }), NOW)
      expect.unreachable()
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('ktmb')
      expect(message).toContain('TBD')
      // The message must say what to DO, not merely that it refused.
      expect(message).toMatch(/human must confirm/)
    }
  })
})

describe('feed validation', () => {
  it('accepts a well-formed feed covering the planning window', () => {
    expect(validateFeed(contents(), WINDOW).ok).toBe(true)
  })

  it('rejects a feed missing a required GTFS file', () => {
    const report = validateFeed(contents({ files: ['agency.txt', 'stops.txt'] }), WINDOW)
    expect(report.ok).toBe(false)
    expect(report.errors.join(' ')).toContain('routes.txt')
  })

  it('rejects an empty feed', () => {
    expect(validateFeed(contents({ tripCount: 0 }), WINDOW).ok).toBe(false)
    expect(validateFeed(contents({ stopCount: 0 }), WINDOW).ok).toBe(false)
  })

  // A structurally perfect feed whose calendar ended last month produces
  // confident, wrong departures. That is worse than no routes at all.
  it('rejects a feed whose service window already ended', () => {
    const report = validateFeed(
      contents({ serviceStart: '2025-01-01', serviceEnd: '2025-12-31' }),
      WINDOW,
    )
    expect(report.ok).toBe(false)
    expect(report.errors.join(' ')).toMatch(/confident, wrong departures/)
  })

  it('rejects a feed whose service window has not started', () => {
    const report = validateFeed(
      contents({ serviceStart: '2027-06-01', serviceEnd: '2027-12-31' }),
      WINDOW,
    )
    expect(report.ok).toBe(false)
  })

  // Partial coverage is usable; the user just must not be told a journey exists
  // on a date the feed does not cover.
  it('warns rather than rejects when coverage is partial', () => {
    const report = validateFeed(
      contents({ serviceStart: '2026-01-01', serviceEnd: '2026-09-15' }),
      WINDOW,
    )
    expect(report.ok).toBe(true)
    expect(report.warnings.join(' ')).toMatch(/later dates will have no transit/)
  })

  it('rejects a feed declaring no service window at all', () => {
    const report = validateFeed(contents({ serviceStart: null, serviceEnd: null }), WINDOW)
    expect(report.ok).toBe(false)
  })

  it('rejects unparseable dates rather than guessing', () => {
    const report = validateFeed(contents({ serviceStart: 'soon', serviceEnd: 'later' }), WINDOW)
    expect(report.ok).toBe(false)
  })
})

describe('ingestion ordering', () => {
  function deps(over: Partial<IngestDeps> = {}): IngestDeps {
    return {
      fetchFeed: vi.fn(async () => new TextEncoder().encode('feed-bytes')),
      inspect: vi.fn(async () => contents()),
      storedChecksum: vi.fn(async () => null),
      now: () => NOW,
      ...over,
    }
  }

  it('ingests a valid, changed feed', async () => {
    const result = await ingestFeed(feed(), WINDOW, deps())
    expect(result.kind).toBe('ingested')
  })

  // The gate runs first so an unverified feed costs no bandwidth and no parsing.
  it('refuses an unverified licence WITHOUT fetching', async () => {
    const d = deps()
    await expect(ingestFeed(feed({ licence: 'TBD' }), WINDOW, d)).rejects.toThrow(
      UnverifiedLicenceError,
    )
    expect(d.fetchFeed).not.toHaveBeenCalled()
  })

  // A daily poll of an unchanged feed should cost one request, not a graph rebuild.
  it('skips validation when the bytes are identical', async () => {
    const bytes = new TextEncoder().encode('feed-bytes')
    const d = deps({ storedChecksum: async () => checksumOf(bytes) })

    const result = await ingestFeed(feed(), WINDOW, d)
    expect(result.kind).toBe('unchanged')
    expect(d.inspect).not.toHaveBeenCalled()
  })

  it('re-validates when the bytes changed', async () => {
    const d = deps({ storedChecksum: async () => 'a-different-checksum' })
    const result = await ingestFeed(feed(), WINDOW, d)
    expect(result.kind).toBe('ingested')
    expect(d.inspect).toHaveBeenCalled()
  })

  it('rejects an invalid feed with its report', async () => {
    const d = deps({ inspect: async () => contents({ tripCount: 0 }) })
    const result = await ingestFeed(feed(), WINDOW, d)
    expect(result.kind).toBe('rejected')
    if (result.kind !== 'rejected') return
    expect(result.report.errors.length).toBeGreaterThan(0)
  })

  it('produces a stable checksum for identical bytes', () => {
    const a = checksumOf(new TextEncoder().encode('same'))
    const b = checksumOf(new TextEncoder().encode('same'))
    expect(a).toBe(b)
    expect(a).not.toBe(checksumOf(new TextEncoder().encode('different')))
  })
})

/**
 * The pilot's real configuration, asserted so a later edit cannot quietly
 * promote it.
 */
describe('the Klang Valley pilot feeds', () => {
  it('defines the four feeds the pilot needs', () => {
    expect(KLANG_VALLEY_FEEDS.map((f) => f.feedId)).toEqual([
      'prasarana-rapid-rail-kl',
      'prasarana-rapid-bus-kl',
      'prasarana-rapid-bus-mrtfeeder',
      'ktmb',
    ])
  })

  it('every feed passes the licence gate', () => {
    for (const f of KLANG_VALLEY_FEEDS) {
      expect(() => assertLicenceVerified(f, NOW), f.feedId).not.toThrow()
    }
  })

  it('records CC BY 4.0, verified from the developer FAQ', () => {
    for (const f of KLANG_VALLEY_FEEDS) expect(f.licence).toBe('CC BY 4.0')
  })

  // CC BY 4.0 requires indicating modifications. We do not serve the feed as
  // published; we serve routes computed from it.
  it('attribution indicates the data was modified', () => {
    for (const f of KLANG_VALLEY_FEEDS) {
      expect(f.attribution.toLowerCase(), f.feedId).toContain('modified')
      expect(f.attribution).toContain('CC BY 4.0')
    }
  })

  // ADR-0022. If this ever flips, the pilot starts claiming live departures it
  // does not have — so it is asserted rather than assumed.
  it('declares NO TripUpdates on any feed', () => {
    for (const f of KLANG_VALLEY_FEEDS) {
      expect(f.capabilities.tripUpdates, `${f.feedId} must not claim TripUpdates`).toBe(false)
    }
  })

  it('declares vehicle positions, which the portal does publish', () => {
    for (const f of KLANG_VALLEY_FEEDS) expect(f.capabilities.vehiclePositions).toBe(true)
  })

  it('points at data.gov.my', () => {
    for (const f of KLANG_VALLEY_FEEDS) {
      expect(new URL(f.url).hostname).toBe('api.data.gov.my')
    }
  })

  it('is frozen, so a runtime edit cannot promote the pilot', () => {
    expect(Object.isFrozen(KLANG_VALLEY_FEEDS)).toBe(true)
    expect(Object.isFrozen(KLANG_VALLEY_FEEDS[0])).toBe(true)
  })
})

/**
 * OTP ignores a GTFS archive whose filename does not contain "gtfs" — verified
 * from the Basic Tutorial. The portal serves these from query-string URLs with
 * no useful filename, so the rename is load-bearing: without it the graph builds
 * successfully and contains no transit.
 */
describe('OTP filename requirement', () => {
  it('produces a filename containing gtfs', () => {
    for (const f of KLANG_VALLEY_FEEDS) {
      expect(otpFilenameFor(f)).toContain('gtfs')
      expect(otpFilenameFor(f).endsWith('.zip')).toBe(true)
    }
  })

  it('produces a distinct filename per feed', () => {
    const names = new Set(KLANG_VALLEY_FEEDS.map(otpFilenameFor))
    expect(names.size).toBe(KLANG_VALLEY_FEEDS.length)
  })
})
