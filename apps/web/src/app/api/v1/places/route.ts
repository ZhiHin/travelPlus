import { NextResponse } from 'next/server'
import { guard, problem } from '../../../../server/http/context.js'
import { jsonBody } from '../../../../server/itinerary/http.js'
import { upsertPlace } from '../../../../server/places/service.js'

/**
 * `POST /api/v1/places`
 *
 * Turn a geocoder result into a place record. A possible duplicate is returned
 * with 409 and the candidate, so the user — not the server — decides whether
 * two pins 40 m apart are the same café (places doc §3).
 */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response

  const parsed = await jsonBody(request)
  if (!parsed.ok) return parsed.response
  const b = parsed.body

  const lat = Number(b.lat)
  const lon = Number(b.lon)
  if (
    typeof b.name !== 'string' ||
    !b.name.trim() ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return problem(400, 'VALIDATION_FAILED', 'Some fields need attention.', {
      problems: ['A place needs a name and coordinates.'],
    })
  }
  const provider = b.provider === 'USER' ? 'USER' : 'NOMINATIM'
  const sourceId = typeof b.sourceId === 'string' && b.sourceId ? b.sourceId : `${lat},${lon}`

  try {
    const outcome = await upsertPlace(
      guarded.actor.userId,
      {
        name: b.name.trim(),
        lat,
        lon,
        ...(typeof b.ianaZone === 'string' ? { ianaZone: b.ianaZone } : {}),
        source: {
          provider,
          sourceId,
          ...(typeof b.licence === 'string' ? { licence: b.licence } : {}),
          ...(typeof b.attribution === 'string' ? { attribution: b.attribution } : {}),
        },
      },
      { allowDuplicate: b.allowDuplicate === true },
    )

    if (outcome.kind === 'possible-duplicate') {
      return problem(409, 'POSSIBLE_DUPLICATE', 'This looks like a place you already have.', {
        candidate: outcome.candidate,
      })
    }
    return NextResponse.json(outcome.place, { status: outcome.kind === 'created' ? 201 : 200 })
  } catch (error) {
    if (error instanceof RangeError) {
      return problem(400, 'VALIDATION_FAILED', error.message)
    }
    throw error
  }
}
