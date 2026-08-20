/**
 * Validated environment configuration.
 *
 * This is the ONLY file in the workspace permitted to read `process.env`
 * (module boundary MB-3, asserted by a CI grep). Everything else imports the
 * parsed, typed result, so a missing variable is a startup failure with a clear
 * message rather than an `undefined` surfacing during a user's request.
 */

import { z } from 'zod'

/**
 * Provider policy requires an identifying User-Agent carrying a real contact
 * address — a stock library default is explicitly insufficient for both
 * Nominatim and Wikimedia. Enforcing the contact here means the app refuses to
 * boot misconfigured rather than quietly breaching the policy in production
 * (ADR-0011, and docs/phase-0/08-PROVIDER-MATRIX.md §2.3 and §2.8).
 */
const identifyingUserAgent = z
  .string()
  .min(1)
  .refine((v) => /\S+@\S+\.\S+/.test(v) || /https?:\/\//.test(v), {
    message:
      'must identify the app AND include a contact email or URL, e.g. "TravelPlus/0.1 (contact: you@example.com)" — provider policy requires it',
  })
  .refine((v) => !/replace@example\.com/i.test(v), {
    message: 'still contains the placeholder contact address from .env.example',
  })

const urlish = z.string().url()

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- core ---------------------------------------------------------------
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  APP_URL: urlish.default('http://localhost:3000'),

  // Secrets. Length floors are cheap insurance against a placeholder shipping.
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),

  // --- routing ------------------------------------------------------------
  OTP_BASE_URL: urlish.default('http://localhost:8080'),
  OTP_ROUTER_ID: z.string().min(1).default('klang-valley'),

  // --- AI -----------------------------------------------------------------
  // Configurable by URL so a native Windows Ollama and a containerised one are
  // both supported without a code change.
  OLLAMA_BASE_URL: urlish.default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).default('llama3.1:8b'),
  /** `fake` is the CI default: no model, no paid API, deterministic (ADR-0013). */
  AI_PROVIDER: z.enum(['ollama', 'fake']).default('fake'),

  // --- map and geocoding --------------------------------------------------
  MAP_STYLE_URL: urlish.default('https://tiles.openfreemap.org/styles/positron'),
  GEOCODER_PROVIDER: z.enum(['nominatim', 'photon', 'pelias']).default('nominatim'),
  NOMINATIM_BASE_URL: urlish.default('https://nominatim.openstreetmap.org'),
  NOMINATIM_USER_AGENT: identifyingUserAgent,
  /** Policy maximum is 1 req/s for the WHOLE application, not per process. */
  NOMINATIM_MAX_RPS: z.coerce.number().positive().max(1).default(1),

  // --- other providers ----------------------------------------------------
  OPEN_METEO_BASE_URL: urlish.default('https://api.open-meteo.com'),
  WIKIMEDIA_USER_AGENT: identifyingUserAgent,

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export type Env = z.infer<typeof envSchema>

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}\n\n` +
        `Copy .env.example to .env and fill in the values above.`,
    )
    this.name = 'ConfigError'
  }
}

/**
 * Parse a raw environment. Exported separately from `loadEnv` so tests can
 * exercise it without touching the real process environment.
 */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues.map((i) => {
      const path = i.path.join('.') || '(root)'
      return `${path}: ${i.message}`
    })
    throw new ConfigError(issues)
  }
  return result.data
}

let cached: Env | undefined

/**
 * Load and validate the process environment, failing loudly and once.
 *
 * The result is cached so validation runs a single time per process and every
 * consumer sees the same values.
 */
export function loadEnv(): Env {
  // The one permitted read of process.env in the entire workspace (MB-3).
  cached ??= parseEnv(process.env)
  return cached
}

/** Test-only: clear the cache between cases. */
export function resetEnvCache(): void {
  cached = undefined
}

/**
 * Values safe to expose to the browser.
 *
 * An explicit allow-list rather than a prefix convention: a secret cannot leak
 * by being named carelessly, because anything not listed here never crosses the
 * boundary.
 */
export function publicConfig(env: Env): { mapStyleUrl: string; appUrl: string } {
  return { mapStyleUrl: env.MAP_STYLE_URL, appUrl: env.APP_URL }
}

export * from './logger.js'
