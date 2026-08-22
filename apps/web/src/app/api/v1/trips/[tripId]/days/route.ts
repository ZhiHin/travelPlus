import { NextResponse } from 'next/server'
import { guard } from '../../../../../../server/http/context.js'
import { mapItineraryError } from '../../../../../../server/itinerary/http.js'
import { ensureDays } from '../../../../../../server/itinerary/service.js'

/**
 * `/api/v1/trips/{tripId}/days`
 *
 * GET materialises one day per date in the trip range and returns them. It is
 * idempotent, so the canvas calls it on load rather than a separate "create
 * days" step the user would have to discover.
 */

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ tripId: string }> }

export async function GET(request: Request, { params }: Params) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response
  const { tripId } = await params

  const zone = new URL(request.url).searchParams.get('zone') ?? 'UTC'
  const result = await ensureDays(guarded.actor.userId, tripId, zone)
  if (!result.ok) return mapItineraryError(result.error)
  return NextResponse.json({ items: result.value })
}
