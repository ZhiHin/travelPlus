import { describe, expect, it } from 'vitest'
import { ConfigError, parseEnv, publicConfig } from './index.js'

const valid = {
  DATABASE_URL: 'postgres://travelplus_app:pw@localhost:5432/travelplus',
  AUTH_SECRET: 'a'.repeat(32),
  ENCRYPTION_KEY: 'b'.repeat(32),
  NOMINATIM_USER_AGENT: 'TravelPlus/0.1 (contact: dev@travelplus.example)',
  WIKIMEDIA_USER_AGENT: 'TravelPlus/0.1 (contact: dev@travelplus.example)',
}

describe('parseEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = parseEnv(valid)
    expect(env.APP_URL).toBe('http://localhost:3000')
    expect(env.OTP_ROUTER_ID).toBe('klang-valley')
    expect(env.NODE_ENV).toBe('development')
  })

  it('defaults the AI provider to the deterministic fake, so CI needs no model', () => {
    expect(parseEnv(valid).AI_PROVIDER).toBe('fake')
  })

  it('names the offending variable when one is missing', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = valid
    try {
      parseEnv(withoutDb)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).message).toContain('DATABASE_URL')
    }
  })

  it('rejects short secrets', () => {
    expect(() => parseEnv({ ...valid, AUTH_SECRET: 'too-short' })).toThrow(/AUTH_SECRET/)
    expect(() => parseEnv({ ...valid, ENCRYPTION_KEY: 'short' })).toThrow(/ENCRYPTION_KEY/)
  })
})

// ADR-0011: the Nominatim policy requires a User-Agent identifying the app,
// and states stock library defaults are insufficient. Refusing to boot without
// a contact address is cheaper than being IP-blocked (RISKS.md R-03).
describe('provider identification', () => {
  it('rejects a user agent with no contact detail', () => {
    expect(() => parseEnv({ ...valid, NOMINATIM_USER_AGENT: 'TravelPlus/0.1' })).toThrow(
      /contact email or URL/,
    )
  })

  it('rejects the unedited placeholder from .env.example', () => {
    expect(() =>
      parseEnv({ ...valid, NOMINATIM_USER_AGENT: 'TravelPlus/0.1 (contact: replace@example.com)' }),
    ).toThrow(/placeholder/)
  })

  it('accepts either a contact email or a contact URL', () => {
    expect(() =>
      parseEnv({ ...valid, WIKIMEDIA_USER_AGENT: 'TravelPlus/0.1 (https://travelplus.example)' }),
    ).not.toThrow()
  })

  it('applies the same rule to the Wikimedia user agent', () => {
    expect(() => parseEnv({ ...valid, WIKIMEDIA_USER_AGENT: 'node-fetch' })).toThrow(
      /contact email or URL/,
    )
  })
})

describe('geocoder rate limit', () => {
  it('defaults to the policy maximum of 1 request per second', () => {
    expect(parseEnv(valid).NOMINATIM_MAX_RPS).toBe(1)
  })

  it('refuses a rate above the published policy limit', () => {
    expect(() => parseEnv({ ...valid, NOMINATIM_MAX_RPS: '5' })).toThrow()
  })

  it('allows a more conservative rate', () => {
    expect(parseEnv({ ...valid, NOMINATIM_MAX_RPS: '0.5' }).NOMINATIM_MAX_RPS).toBe(0.5)
  })
})

describe('publicConfig', () => {
  it('exposes only browser-safe values', () => {
    const pub = publicConfig(parseEnv(valid))
    expect(Object.keys(pub).sort()).toEqual(['appUrl', 'mapStyleUrl'])
  })

  it('never leaks a secret', () => {
    const serialised = JSON.stringify(publicConfig(parseEnv(valid)))
    expect(serialised).not.toContain('a'.repeat(32))
    expect(serialised).not.toContain('b'.repeat(32))
    expect(serialised).not.toContain('travelplus_app')
  })
})
