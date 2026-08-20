import { describe, expect, it } from 'vitest'
import { REDACTED, coarsenCoordinate, createLogger, redact } from './logger.js'

function capture(level?: 'debug' | 'info' | 'warn' | 'error') {
  const lines: Array<Record<string, unknown>> = []
  const logger = createLogger({
    ...(level ? { level } : {}),
    sink: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    now: () => new Date('2026-08-20T10:00:00Z'),
  })
  return { logger, lines }
}

describe('log record shape', () => {
  it('emits ts, level and a dotted event name', () => {
    const { logger, lines } = capture()
    logger.info('route.plan.completed', { durationMs: 412 })
    expect(lines[0]).toMatchObject({
      ts: '2026-08-20T10:00:00.000Z',
      level: 'info',
      msg: 'route.plan.completed',
      durationMs: 412,
    })
  })

  it('respects the level threshold', () => {
    const { logger, lines } = capture('warn')
    logger.debug('a')
    logger.info('b')
    logger.warn('c')
    logger.error('d')
    expect(lines.map((l) => l.msg)).toEqual(['c', 'd'])
  })

  it('carries child fields onto every line', () => {
    const { logger, lines } = capture()
    const scoped = logger.child({ correlationId: '01J-abc', tripId: 't-1' })
    scoped.info('trip.opened')
    expect(lines[0]).toMatchObject({ correlationId: '01J-abc', tripId: 't-1' })
  })
})

// Rules that say "never log a password" fail the first time someone logs a whole
// object. These assert the layer catches it regardless of the call site.
describe('redaction', () => {
  it('redacts obviously sensitive keys', () => {
    const out = redact({ password: 'hunter2', authToken: 'abc', apiKey: 'k' }) as Record<
      string,
      unknown
    >
    expect(out.password).toBe(REDACTED)
    expect(out.authToken).toBe(REDACTED)
    expect(out.apiKey).toBe(REDACTED)
  })

  it('matches as a substring, so passwordHash and POSTGRES_PASSWORD are caught', () => {
    const out = redact({
      passwordHash: '$argon2id$...',
      POSTGRES_PASSWORD: 'pw',
      user_password: 'pw',
    }) as Record<string, unknown>
    expect(Object.values(out)).toEqual([REDACTED, REDACTED, REDACTED])
  })

  it('redacts at any depth', () => {
    const out = redact({ a: { b: { c: { sessionToken: 'leak' } } } }) as Record<string, unknown>
    const c = ((out.a as Record<string, unknown>).b as Record<string, unknown>).c as Record<
      string,
      unknown
    >
    expect(c.sessionToken).toBe(REDACTED)
  })

  it('redacts inside arrays', () => {
    const out = redact([{ secret: 'x' }, { fine: 'y' }]) as Array<Record<string, unknown>>
    expect(out[0]!.secret).toBe(REDACTED)
    expect(out[1]!.fine).toBe('y')
  })

  it('redacts booking confirmation references and AI prompts', () => {
    const out = redact({ confirmation_ref: 'ABC123', prompt: 'system rules...' }) as Record<
      string,
      unknown
    >
    expect(out.confirmation_ref).toBe(REDACTED)
    expect(out.prompt).toBe(REDACTED)
  })

  it('survives circular references without hanging', () => {
    const a: Record<string, unknown> = { name: 'trip' }
    a.self = a
    expect(() => redact(a)).not.toThrow()
    expect((redact(a) as Record<string, unknown>).self).toBe('[circular]')
  })

  it('preserves harmless fields', () => {
    const out = redact({ tripId: 't-1', legCount: 4, status: 'SCHEDULED' })
    expect(out).toEqual({ tripId: 't-1', legCount: 4, status: 'SCHEDULED' })
  })

  it('serialises Errors without losing the message', () => {
    const out = redact({ err: new Error('boom') }) as Record<string, Record<string, unknown>>
    expect(out.err!.message).toBe('boom')
  })
})

// Knowing a route was planned in Kuala Lumpur is useful. Knowing which building
// someone stood outside is a liability with no operational value.
describe('coordinate coarsening', () => {
  it('rounds to roughly 1 km', () => {
    expect(coarsenCoordinate(3.13906)).toBe(3.14)
    expect(coarsenCoordinate(101.68685)).toBe(101.69)
  })

  it('coarsens coordinates inside logged objects', () => {
    const out = redact({ lat: 3.139061, lon: 101.686852 }) as Record<string, number>
    expect(out.lat).toBe(3.14)
    expect(out.lon).toBe(101.69)
  })

  it('coarsens common aliases', () => {
    const out = redact({ latitude: 3.139061, longitude: 101.686852, lng: 101.686852 }) as Record<
      string,
      number
    >
    expect(out.latitude).toBe(3.14)
    expect(out.longitude).toBe(101.69)
    expect(out.lng).toBe(101.69)
  })

  it('leaves non-numeric coordinate fields alone', () => {
    const out = redact({ lat: 'unknown' }) as Record<string, unknown>
    expect(out.lat).toBe('unknown')
  })
})

describe('end to end through the logger', () => {
  it('never writes a secret to the sink', () => {
    const { logger, lines } = capture()
    logger.info('auth.login', {
      email: 'traveller@example.com',
      password: 'hunter2',
      sessionToken: 'sess_abc',
      lat: 3.139061,
    })
    const raw = JSON.stringify(lines[0])
    expect(raw).not.toContain('hunter2')
    expect(raw).not.toContain('sess_abc')
    expect(raw).not.toContain('3.139061')
    expect(raw).toContain('traveller@example.com')
  })
})
