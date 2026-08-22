import { NextResponse } from 'next/server'
import { guard, mapTripError } from '../../../../../server/http/context.js'
import { getTrip } from '../../../../../server/trips/service.js'

/** `/api/v1/trips/{tripId}` — one trip, as the caller's role sees it. */

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ tripId: string }> }

export async function GET(request: Request, { params }: Params) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response
  const { tripId } = await params

  const result = await getTrip(guarded.actor.userId, tripId, new Date())
  if (!result.ok) return mapTripError(result.error)
  return NextResponse.json(result.value)
}
