/**
 * Structured logging with redaction.
 *
 * OpenTelemetry-compatible JSON to stdout: no vendor, no cost, and a collector
 * can be attached later without touching application code.
 *
 * The redaction layer is the point. Rules that say "never log a password" fail
 * the first time someone logs a whole object, so redaction happens at
 * serialisation and does not depend on every call site being careful
 * (docs/phase-0/27-OBSERVABILITY.md §2).
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

/**
 * Keys whose values never reach a log, at any depth.
 *
 * Matched case-insensitively as substrings, so `passwordHash`, `POSTGRES_PASSWORD`
 * and `user_password` are all caught by `password`.
 */
const SECRET_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'session',
  'apikey',
  'api_key',
  'encryption',
  'credential',
  'confirmation_ref',
  'confirmationref',
  'private',
  'signature',
  'prompt',
] as const

export const REDACTED = '[redacted]'

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase()
  return SECRET_KEY_PATTERNS.some((p) => lower.includes(p))
}

/**
 * Round a coordinate to roughly 1 km.
 *
 * Knowing a route was planned in Kuala Lumpur is operationally useful. Knowing
 * which building someone stood in front of is a liability with no operational
 * value, so precision is discarded before the value is ever written.
 */
export function coarsenCoordinate(value: number): number {
  return Math.round(value * 100) / 100
}

const COORD_KEYS = new Set(['lat', 'lon', 'lng', 'latitude', 'longitude'])

/** Recursively redact secrets and coarsen coordinates. Cycle-safe. */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value

  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) return value.map((v) => redact(v, seen))

  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }

  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      out[key] = REDACTED
    } else if (COORD_KEYS.has(key.toLowerCase()) && typeof v === 'number') {
      out[key] = coarsenCoordinate(v)
    } else {
      out[key] = redact(v, seen)
    }
  }
  return out
}

export interface LogFields {
  /** Threaded request -> job -> provider call, so one id recovers the whole unit of work. */
  readonly correlationId?: string
  readonly [key: string]: unknown
}

export interface Logger {
  debug(event: string, fields?: LogFields): void
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  error(event: string, fields?: LogFields): void
  /** Derive a logger that carries fields onto every subsequent line. */
  child(fields: LogFields): Logger
}

export interface LoggerOptions {
  readonly level?: LogLevel
  /** Injected so tests can capture output instead of writing to stdout. */
  readonly sink?: (line: string) => void
  readonly now?: () => Date
  readonly base?: LogFields
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info'
  const sink = options.sink ?? ((line: string) => console.error(line))
  const now = options.now ?? (() => new Date())
  const base = options.base ?? {}

  function emit(lineLevel: LogLevel, event: string, fields?: LogFields): void {
    if (LEVEL_RANK[lineLevel] < LEVEL_RANK[level]) return

    const merged = { ...base, ...fields }
    const record = {
      ts: now().toISOString(),
      level: lineLevel,
      // Dotted, stable names so lines aggregate: route.plan.completed, ai.job.failed.
      msg: event,
      ...(redact(merged) as Record<string, unknown>),
    }
    sink(JSON.stringify(record))
  }

  return {
    debug: (e, f) => emit('debug', e, f),
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  }
}
