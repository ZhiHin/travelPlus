import { NextResponse } from 'next/server'
import { guard, problem } from '../../../../../../../server/http/context.js'
import {
  jsonBody,
  mapItineraryError,
  routingDeps,
} from '../../../../../../../server/itinerary/http.js'
import { routeBoundaries } from '../../../../../../../server/itinerary/routing.js'
import { commitMove } from '../../../../../../../server/itinerary/service.js'

/**
 * `/api/v1/days/{dayId}/reorder/commit` — bind the commit to a preview token.
 *
 * After the order is written, only the boundaries the preview reported are
 * routed (BR-I6: at most four). Routing failures are returned per boundary,
 * not hidden: the order is saved either way, and an unrouted leg is a gap.
 */

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ dayId: string }> }

export async function POST(request: Request, { params }: Params) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response
  await params

  const parsed = await jsonBody(request)
  if (!parsed.ok) return parsed.response
  const { previewToken } = parsed.body
  if (typeof previewToken !== 'string') {
    return problem(400, 'VALIDATION_FAILED', 'Some fields need attention.', {
      problems: ['Send the previewToken from the preview response.'],
    })
  }

  const now = new Date()
  const result = await commitMove(guarded.actor.userId, previewToken, now)
  if (!result.ok) return mapItineraryError(result.error)

  const routed = await routeBoundaries(
    routingDeps(),
    guarded.actor.userId,
    result.value.dayId,
    result.value.affectedBoundaries,
    now,
  )
  return NextResponse.json({ ...result.value, routed })
}
