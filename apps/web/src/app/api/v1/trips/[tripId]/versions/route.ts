import { NextResponse } from 'next/server'
import { guard } from '../../../../../../server/http/context.js'
import { mapItineraryError } from '../../../../../../server/itinerary/http.js'
import { listVersions } from '../../../../../../server/itinerary/service.js'

/** `/api/v1/trips/{tripId}/versions` — the append-only history, newest first. */

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ tripId: string }> }

export async function GET(request: Request, { params }: Params) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response
  const { tripId } = await params

  const result = await listVersions(guarded.actor.userId, tripId)
  if (!result.ok) return mapItineraryError(result.error)
  return NextResponse.json({ items: result.value })
}
