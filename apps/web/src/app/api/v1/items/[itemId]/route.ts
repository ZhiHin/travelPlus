import { NextResponse } from 'next/server'
import { guard } from '../../../../../server/http/context.js'
import {
  jsonBody,
  mapItineraryError,
  requireVersion,
  routingDeps,
} from '../../../../../server/itinerary/http.js'
import { routeBoundaries } from '../../../../../server/itinerary/routing.js'
import { removeItem, setLocks } from '../../../../../server/itinerary/service.js'

/**
 * `/api/v1/items/{itemId}`
 *
 * PATCH changes locks; DELETE soft-deletes. Both demand the version the caller
 * last saw — a mutation without one is a 400, not a silent last-writer-wins.
 */

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ itemId: string }> }

export async function PATCH(request: Request, { params }: Params) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response
  const { itemId } = await params

  const parsed = await jsonBody(request)
  if (!parsed.ok) return parsed.response
  const version = requireVersion(parsed.body)
  if (typeof version !== 'number') return version

  const b = parsed.body
  const result = await setLocks(
    guarded.actor.userId,
    itemId,
    {
      ...(typeof b.lockTime === 'boolean' ? { lockTime: b.lockTime } : {}),
      ...(typeof b.lockPlace === 'boolean' ? { lockPlace: b.lockPlace } : {}),
      ...(typeof b.lockItem === 'boolean' ? { lockItem: b.lockItem } : {}),
    },
    version,
  )
  if (!result.ok) return mapItineraryError(result.error)
  return NextResponse.json(result.value)
}

export async function DELETE(request: Request, { params }: Params) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response
  const { itemId } = await params

  const parsed = await jsonBody(request)
  if (!parsed.ok) return parsed.response
  const version = requireVersion(parsed.body)
  if (typeof version !== 'number') return version

  const result = await removeItem(guarded.actor.userId, itemId, version)
  if (!result.ok) return mapItineraryError(result.error)

  // Removing b from a,b,c creates one new adjacency a->c.
  const routed =
    result.value.affectedBoundaries.length > 0 && typeof parsed.body.dayId === 'string'
      ? await routeBoundaries(
          routingDeps(),
          guarded.actor.userId,
          parsed.body.dayId,
          result.value.affectedBoundaries,
          new Date(),
        )
      : []
  return NextResponse.json({ ...result.value, routed })
}
