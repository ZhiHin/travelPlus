import { loadEnv } from '@travelplus/config'
import { systemDb } from '@travelplus/db'
import { uuidv7 } from '@travelplus/domain'
import { GeocoderBusyError, createNominatimGeocoder } from '@travelplus/integrations'
import { NextResponse } from 'next/server'
import { guard, problem } from '../../../../../server/http/context.js'

/**
 * `/api/v1/places/search`
 *
 * Submit-triggered only. There is deliberately no sibling `suggest` or
 * `autocomplete` route, because the Nominatim policy forbids it (ADR-0011) —
 * and a route that does not exist cannot be called by a future component that
 * "just needs type-ahead".
 *
 * Rate limiting, caching and the identifying User-Agent all live in the adapter,
 * so this handler cannot bypass them by construction.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response

  const params = new URL(request.url).searchParams
  const query = params.get('q')?.trim() ?? ''

  if (query.length === 0) {
    return problem(400, 'VALIDATION_FAILED', 'Enter something to search for.')
  }
  if (query.length > 200) {
    return problem(400, 'VALIDATION_FAILED', 'That search is too long.')
  }

  const env = loadEnv()
  const geocoder = createNominatimGeocoder({
    baseUrl: env.NOMINATIM_BASE_URL,
    userAgent: env.NOMINATIM_USER_AGENT,
    db: systemDb() as never,
    now: () => new Date(),
    newId: uuidv7,
    // Bounded: a caller waits briefly, then gets a documented "try again"
    // rather than holding a request open behind a busy shared budget.
    maxWaitMs: 4000,
  })

  const limitParam = Number(params.get('limit') ?? 5)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 10) : 5

  try {
    const outcome = await geocoder.search(query, { limit })

    return NextResponse.json({
      items: outcome.results.map((r) => ({
        providerId: r.providerId,
        name: r.displayName,
        lat: r.lat,
        lon: r.lon,
        category: r.category ?? null,
        // Licence condition: every rendered result carries its attribution.
        attribution: r.attribution,
        licence: r.licence,
      })),
      fromCache: outcome.fromCache,
      retrievedAt: outcome.retrievedAt.toISOString(),
    })
  } catch (error) {
    if (error instanceof GeocoderBusyError) {
      // 202 rather than 429: the request is queued behind a shared 1 req/s
      // budget, not rejected for abuse. The UI shows "waiting for the geocoder",
      // which is a designed state rather than an error.
      return NextResponse.json(
        { status: 'queued', retryAfterMs: error.retryAfterMs },
        { status: 202, headers: { 'retry-after': '1' } },
      )
    }
    return problem(503, 'PROVIDER_UNAVAILABLE', "We can't reach the search service right now.")
  }
}
