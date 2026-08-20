/**
 * UUIDv7 identifiers (ADR-0015).
 *
 * Generated in the application rather than by the database, because outbox rows
 * and audit events need to reference an entity's id inside the same transaction
 * that creates it — before any INSERT has returned.
 *
 * v7 puts a 48-bit big-endian Unix millisecond timestamp in the leading bytes,
 * so ids sort chronologically. That keeps index locality close to a bigserial on
 * high-write tables like `route_snapshots` and `audit_events`, while staying
 * non-guessable and safe to expose in a URL — which bigserial is not, and
 * enumeration is precisely the attack the authorization tests must defeat.
 *
 * Layout (RFC 9562):
 *   0                   1                   2                   3
 *   |unix_ts_ms (48 bits)          |ver(4)|rand_a(12)|var(2)|rand_b(62)|
 */

/** Injectable sources keep generation deterministic under test. */
export interface UuidV7Options {
  /** Unix milliseconds. Defaults to `Date.now()`. */
  readonly now?: number
  /** Fills a byte array with random values. Defaults to `crypto.getRandomValues`. */
  readonly randomBytes?: (into: Uint8Array) => Uint8Array
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

function defaultRandomBytes(into: Uint8Array): Uint8Array {
  // Web Crypto is available in Node 19+, Deno, Bun and browsers, so the domain
  // stays platform-free rather than importing node:crypto (boundary MB-1).
  crypto.getRandomValues(into)
  return into
}

/**
 * Generate a UUIDv7 string.
 *
 * Throws rather than silently truncating if the timestamp cannot be represented,
 * because a wrong id is worse than a loud failure.
 */
export function uuidv7(options: UuidV7Options = {}): string {
  const now = options.now ?? Date.now()
  if (!Number.isFinite(now) || now < 0 || now > 0xffff_ffff_ffff) {
    throw new RangeError(`Timestamp ${now} is outside the 48-bit range UUIDv7 can encode`)
  }

  const bytes = new Uint8Array(16)
  const ts = Math.floor(now)

  // 48-bit big-endian timestamp. Split at 2^32 to stay inside safe integers and
  // avoid the sign-flipping that bitwise ops would cause above 2^31.
  const high = Math.floor(ts / 2 ** 32) // top 16 bits
  const low = ts >>> 0 // bottom 32 bits
  bytes[0] = (high >>> 8) & 0xff
  bytes[1] = high & 0xff
  bytes[2] = (low >>> 24) & 0xff
  bytes[3] = (low >>> 16) & 0xff
  bytes[4] = (low >>> 8) & 0xff
  bytes[5] = low & 0xff

  const random = (options.randomBytes ?? defaultRandomBytes)(new Uint8Array(10))
  bytes.set(random, 6)

  // Version 7 in the high nibble of byte 6; RFC 4122 variant in byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const h = (i: number) => HEX[bytes[i] ?? 0]
  return (
    `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-` +
    `${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`
  )
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function isUuidV7(value: string): boolean {
  return isUuid(value) && value[14] === '7' && '89abAB'.includes(value[19] ?? '')
}

/** Recover the embedded creation time. Useful for retention sweeps and debugging. */
export function uuidV7Timestamp(value: string): Date {
  if (!isUuidV7(value)) throw new TypeError(`"${value}" is not a UUIDv7`)
  const hex = value.replace(/-/g, '').slice(0, 12)
  return new Date(Number.parseInt(hex, 16))
}
