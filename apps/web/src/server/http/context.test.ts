import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapTripError, parseCookies } from './context.js'

describe('parseCookies', () => {
  it('parses a normal cookie header', () => {
    expect(parseCookies('tp_session=abc; tp_csrf=def')).toEqual({
      tp_session: 'abc',
      tp_csrf: 'def',
    })
  })

  it('returns nothing for an absent header', () => {
    expect(parseCookies(null)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })

  it('handles values containing an equals sign', () => {
    // base64url tokens can end in '=' padding; splitting on every '=' would
    // truncate the token and silently invalidate the session.
    expect(parseCookies('tp_session=abc=def==')).toEqual({ tp_session: 'abc=def==' })
  })

  it('decodes percent-encoded values', () => {
    expect(parseCookies('k=a%20b')).toEqual({ k: 'a b' })
  })

  it('ignores malformed segments rather than throwing', () => {
    expect(parseCookies('novalue; k=v')).toEqual({ k: 'v' })
  })
})

describe('mapTripError', () => {
  it('maps not-found to 404', () => {
    expect(mapTripError({ kind: 'not-found' }).status).toBe(404)
  })

  it('maps forbidden to 403 and conflict to 409', () => {
    expect(mapTripError({ kind: 'forbidden', required: 'OWNER' }).status).toBe(403)
    expect(mapTripError({ kind: 'conflict', currentVersion: 3 }).status).toBe(409)
  })

  it('maps invalid to 400', () => {
    expect(mapTripError({ kind: 'invalid', problems: ['bad'] }).status).toBe(400)
  })

  it('falls back to 500 for an unknown kind rather than leaking it', () => {
    expect(mapTripError({ kind: 'something-new' }).status).toBe(500)
  })

  it('sets a correlation id header on every response', async () => {
    const response = mapTripError({ kind: 'not-found' })
    expect(response.headers.get('x-correlation-id')).toBeTruthy()
  })

  it('never includes a stack trace or internals in the body', async () => {
    const body = await mapTripError({ kind: 'not-found' }).text()
    expect(body).not.toMatch(/stack|at Object|node_modules|postgres:\/\//i)
  })
})

/**
 * Phase 2 gate: "no autocomplete endpoint exists".
 *
 * The Nominatim policy forbids implementing autocomplete against the API. The
 * adapter has no such method, but a route could still be added later by someone
 * who "just needs type-ahead" — so the route tree itself is asserted.
 *
 * This walks the real app directory rather than checking a list, so a new route
 * added anywhere is covered without anyone remembering to update a test.
 */
describe('no autocomplete route exists anywhere in the app', () => {
  const APP_DIR = join(process.cwd(), 'apps', 'web', 'src', 'app')
  const FORBIDDEN = ['autocomplete', 'suggest', 'typeahead', 'type-ahead', 'complete']

  function walk(dir: string, found: string[] = []): string[] {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return found
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        found.push(entry.toLowerCase())
        walk(full, found)
      }
    }
    return found
  }

  it('has no route segment named after an incremental-search endpoint', () => {
    const segments = walk(APP_DIR)
    for (const forbidden of FORBIDDEN) {
      expect(
        segments,
        `a route segment "${forbidden}" would breach the Nominatim policy`,
      ).not.toContain(forbidden)
    }
  })

  it('found the app directory, so the check above is meaningful', () => {
    // Guards against the walk silently returning [] and the assertion passing
    // for the wrong reason.
    expect(walk(APP_DIR)).toContain('api')
  })
})
