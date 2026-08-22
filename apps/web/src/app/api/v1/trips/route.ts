import { NextResponse } from 'next/server'
import { createTrip, listTrips, type TripStatus } from '../../../../server/trips/service.js'
import { guard, mapTripError, problem } from '../../../../server/http/context.js'

/**
 * `/api/v1/trips`
 *
 * Thin by design: parse, authorise, call one service, map the result. No domain
 * logic and no direct database access here (ARCHITECTURE §2).
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response

  const status = new URL(request.url).searchParams.get('status') as TripStatus | null
  const trips = await listTrips(guarded.actor.userId, new Date(), status ? { status } : undefined)

  // Cursor pagination lands with the list screen; the shape is already an
  // envelope so adding `nextCursor` is not a breaking change.
  return NextResponse.json({ items: trips, nextCursor: null })
}

export async function POST(request: Request) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return problem(400, 'VALIDATION_FAILED', 'Send a JSON body.')
  }

  const input = body as Record<string, unknown>
  if (typeof input.title !== 'string') {
    return problem(400, 'VALIDATION_FAILED', 'Some fields need attention.', {
      problems: ['A trip needs a name.'],
    })
  }

  const result = await createTrip(
    guarded.actor.userId,
    {
      title: input.title,
      ...(typeof input.startDate === 'string' ? { startDate: input.startDate } : {}),
      ...(typeof input.endDate === 'string' ? { endDate: input.endDate } : {}),
      ...(typeof input.travelerCount === 'number' ? { travelerCount: input.travelerCount } : {}),
      ...(Array.isArray(input.destinations) ? { destinations: input.destinations as never } : {}),
    },
    new Date(),
  )

  if (!result.ok) return mapTripError(result.error)
  return NextResponse.json(result.value, { status: 201 })
}
