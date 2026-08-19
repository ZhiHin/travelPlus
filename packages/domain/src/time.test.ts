import { describe, expect, it } from 'vitest'
import {
  addSeconds,
  differenceSeconds,
  isValidZone,
  localDateOf,
  resolveLocal,
  toLocal,
} from './time.js'

const KL = 'Asia/Kuala_Lumpur' // pilot region, UTC+8, no DST
const NY = 'America/New_York' // northern DST
const SYD = 'Australia/Sydney' // southern DST
const KOL = 'Asia/Kolkata' // half-hour offset
const UTC = 'UTC'

describe('zone validation', () => {
  it('accepts real zones and rejects invented ones', () => {
    for (const z of [KL, NY, SYD, KOL, UTC]) expect(isValidZone(z)).toBe(true)
    expect(isValidZone('Mars/Olympus')).toBe(false)
  })

  it('requires a zone (BR-TZ3)', () => {
    expect(() => resolveLocal({ date: '2026-08-20', time: '10:00', zone: '' })).toThrow(
      /time zone is required/,
    )
  })

  it('rejects malformed date and time', () => {
    expect(() => resolveLocal({ date: '20-08-2026', time: '10:00', zone: KL })).toThrow(TypeError)
    expect(() => resolveLocal({ date: '2026-08-20', time: '25:00', zone: KL })).toThrow(TypeError)
  })
})

describe('pilot region — Asia/Kuala_Lumpur (UTC+8, no DST)', () => {
  it('resolves unambiguously all year', () => {
    for (const date of ['2026-01-15', '2026-03-29', '2026-06-21', '2026-10-25', '2026-12-31']) {
      expect(resolveLocal({ date, time: '10:00', zone: KL }).kind, `${date}`).toBe('ok')
    }
  })

  it('round-trips a wall-clock reading', () => {
    const r = resolveLocal({ date: '2026-08-20', time: '19:30', zone: KL })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(toLocal(r.instant, KL)).toEqual({ date: '2026-08-20', time: '19:30', zone: KL })
    expect(r.instant.toISOString()).toBe('2026-08-20T11:30:00.000Z')
  })
})

describe('DST transitions', () => {
  // US 2026: clocks forward 8 Mar, back 1 Nov.
  it('reports a nonexistent local time on spring-forward (BR-TZ5)', () => {
    const r = resolveLocal({ date: '2026-03-08', time: '02:30', zone: NY })
    expect(r.kind).toBe('nonexistent')
    if (r.kind !== 'nonexistent') return
    expect(r.suggested).toBeInstanceOf(Date)
  })

  it('reports an ambiguous local time on fall-back with both candidates (BR-TZ4)', () => {
    const r = resolveLocal({ date: '2026-11-01', time: '01:30', zone: NY })
    expect(r.kind).toBe('ambiguous')
    if (r.kind !== 'ambiguous') return
    const [first, second] = r.candidates
    expect(second.getTime() - first.getTime()).toBe(3_600_000)
  })

  it('resolves times either side of a transition cleanly', () => {
    expect(resolveLocal({ date: '2026-03-08', time: '00:30', zone: NY }).kind).toBe('ok')
    expect(resolveLocal({ date: '2026-03-08', time: '04:30', zone: NY }).kind).toBe('ok')
  })

  it('handles southern-hemisphere DST', () => {
    for (const date of ['2026-01-15', '2026-07-15']) {
      expect(resolveLocal({ date, time: '12:00', zone: SYD }).kind).toBe('ok')
    }
  })
})

describe('offset edge cases', () => {
  it('handles a half-hour offset zone', () => {
    const r = resolveLocal({ date: '2026-08-20', time: '09:15', zone: KOL })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.instant.toISOString()).toBe('2026-08-20T03:45:00.000Z')
  })

  it('handles a zero-offset zone', () => {
    const r = resolveLocal({ date: '2026-08-20', time: '09:15', zone: UTC })
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.instant.toISOString()).toBe('2026-08-20T09:15:00.000Z')
  })
})

describe('day boundaries (BR-TZ8)', () => {
  it('uses the destination local date, not the UTC date', () => {
    const early = resolveLocal({ date: '2026-08-20', time: '07:30', zone: KL })
    expect(early.kind).toBe('ok')
    if (early.kind !== 'ok') return
    // 07:30 in KL is still the previous day in UTC — the itinerary must not move it.
    expect(early.instant.toISOString()).toBe('2026-08-19T23:30:00.000Z')
    expect(localDateOf(early.instant, KL)).toBe('2026-08-20')
    expect(localDateOf(early.instant, UTC)).toBe('2026-08-19')
  })
})

describe('instant arithmetic', () => {
  it('adds and differences seconds', () => {
    const t = new Date('2026-08-20T10:00:00Z')
    expect(addSeconds(t, 900).toISOString()).toBe('2026-08-20T10:15:00.000Z')
    expect(differenceSeconds(addSeconds(t, 900), t)).toBe(900)
  })
})
