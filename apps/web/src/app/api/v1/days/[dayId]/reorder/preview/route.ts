import { DEFAULT_DAY_CONSTRAINTS } from '@travelplus/domain'
import { NextResponse } from 'next/server'
import { guard, problem } from '../../../../../../../server/http/context.js'
import { jsonBody, mapItineraryError } from '../../../../../../../server/itinerary/http.js'
import { previewMove } from '../../../../../../../server/itinerary/service.js'

/**
 * `/api/v1/days/{dayId}/reorder/preview`
 *
 * Nothing is persisted. The response carries a token the client sends back to
 * commit exactly what it saw (BR-I6, BR-I7).
 */

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ dayId: string }> }

export async function POST(request: Request, { params }: Params) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response
  const { dayId } = await params

  const parsed = await jsonBody(request)
  if (!parsed.ok) return parsed.response
  const { itemId, toIndex } = parsed.body
  if (typeof itemId !== 'string' || typeof toIndex !== 'number' || !Number.isInteger(toIndex)) {
    return problem(400, 'VALIDATION_FAILED', 'Some fields need attention.', {
      problems: ['Send itemId and an integer toIndex.'],
    })
  }

  const result = await previewMove(
    guarded.actor.userId,
    dayId,
    itemId,
    toIndex,
    DEFAULT_DAY_CONSTRAINTS,
    new Date(),
  )
  if (!result.ok) return mapItineraryError(result.error)
  return NextResponse.json(result.value)
}
