import { hash, verify } from '@node-rs/argon2'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing and token generation.
 *
 * Kept out of `packages/domain`, which must stay platform-free (MB-1). The
 * domain owns the *rules*; this owns the primitives.
 */

/**
 * Argon2id parameters.
 *
 * Argon2id is the hybrid variant, resistant to both GPU and side-channel attack,
 * and is the recommended default. Memory cost dominates attacker economics far
 * more than iteration count, so 19 MiB with 2 passes is preferred over a low
 * memory / high iteration configuration of equivalent latency.
 *
 * These are stored inside the hash string, so raising them later does not
 * invalidate existing hashes — old passwords verify with their original
 * parameters and are rehashed on next successful sign-in (see `needsRehash`).
 */
const ARGON2_OPTIONS = {
  algorithm: 2, // Argon2id
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS)
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupted row must
 * fail closed, not crash the sign-in route and reveal that the row is unusual.
 */
export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password, ARGON2_OPTIONS)
  } catch {
    return false
  }
}

/**
 * A dummy hash used to spend the same CPU time when no account exists.
 *
 * Without this, "no such user" returns in microseconds while a real account
 * spends ~50 ms in Argon2 — a timing oracle that leaks exactly what the opaque
 * response text is designed to hide.
 */
let dummyHash: string | null = null

export async function dummyVerify(password: string): Promise<false> {
  dummyHash ??= await hashPassword('this-hash-is-never-a-real-password')
  await verifyPassword(dummyHash, password)
  return false
}

/** True when a stored hash used weaker parameters than we now require. */
export function needsRehash(hashed: string): boolean {
  const m = /\$m=(\d+),t=(\d+),p=(\d+)/.exec(hashed)
  if (!m) return true
  const [, mem, time, par] = m
  return (
    Number(mem) < ARGON2_OPTIONS.memoryCost ||
    Number(time) < ARGON2_OPTIONS.timeCost ||
    Number(par) < ARGON2_OPTIONS.parallelism
  )
}

// ---------------------------------------------------------------------------
// Opaque tokens
// ---------------------------------------------------------------------------

/**
 * 256 bits from a CSPRNG, base64url encoded.
 *
 * The raw token goes to the user exactly once; only its hash is stored, so a
 * database leak does not yield usable sessions or reset links.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * SHA-256, deliberately not Argon2.
 *
 * These tokens already have full entropy, so there is nothing to slow down a
 * guessing attack against — and a session lookup runs on every request, where
 * a deliberately slow hash would be a self-inflicted denial of service.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison for any secret compared in application code. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Hash an IP or user agent for correlation without retention.
 *
 * Keyed with the application secret so the digests are not reversible by
 * rainbow table — an IPv4 space is small enough to enumerate otherwise.
 */
export function hashIdentifier(value: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${value}`).digest('hex').slice(0, 32)
}
