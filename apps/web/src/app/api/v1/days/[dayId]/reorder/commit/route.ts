import { NextResponse } from 'next/server'
import { guard, problem } from '../../../../../../../server/http/context.js'
import { jsonBody, mapItineraryError } from '../../../../../../../server/itinerary/http.js'
import { commitMove } from '../../../../../../../server/itinerary/service.js'

/** `/api/v1/days/{dayId}/reorder/commit` — bind the commit to a preview token. */

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

  const result = await commitMove(guarded.actor.userId, previewToken, new Date())
  if (!result.ok) return mapItineraryError(result.error)
  return NextResponse.json(result.value)
}
