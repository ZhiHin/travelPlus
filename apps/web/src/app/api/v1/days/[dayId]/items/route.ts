import { ITEM_KINDS, type ItemKind } from '@travelplus/domain'
import { NextResponse } from 'next/server'
import { guard, problem } from '../../../../../../server/http/context.js'
import { jsonBody, mapItineraryError } from '../../../../../../server/itinerary/http.js'
import { addItem, listItems } from '../../../../../../server/itinerary/service.js'

/** `/api/v1/days/{dayId}/items` — list, and append to the end of the day. */

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ dayId: string }> }

export async function GET(request: Request, { params }: Params) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response
  const { dayId } = await params

  const result = await listItems(guarded.actor.userId, dayId)
  if (!result.ok) return mapItineraryError(result.error)
  return NextResponse.json({ items: result.value })
}

export async function POST(request: Request, { params }: Params) {
  const guarded = await guard(request)
  if (!guarded.ok) return guarded.response
  const { dayId } = await params

  const parsed = await jsonBody(request)
  if (!parsed.ok) return parsed.response
  const input = parsed.body

  const kind = typeof input.kind === 'string' ? input.kind : 'ACTIVITY'
  if (!(ITEM_KINDS as readonly string[]).includes(kind)) {
    return problem(400, 'VALIDATION_FAILED', 'Some fields need attention.', {
      problems: [`Unknown item kind "${kind}".`],
    })
  }
  if (typeof input.title !== 'string') {
    return problem(400, 'VALIDATION_FAILED', 'Some fields need attention.', {
      problems: ['Give the item a name.'],
    })
  }

  const desiredStart =
    typeof input.desiredStart === 'string' ? new Date(input.desiredStart) : undefined
  if (desiredStart && Number.isNaN(desiredStart.getTime())) {
    return problem(400, 'VALIDATION_FAILED', 'Some fields need attention.', {
      problems: ['desiredStart must be an ISO-8601 instant.'],
    })
  }

  const result = await addItem(guarded.actor.userId, dayId, {
    kind: kind as ItemKind,
    title: input.title,
    ...(typeof input.placeId === 'string' ? { placeId: input.placeId } : {}),
    ...(typeof input.plannedDurationSeconds === 'number'
      ? { plannedDurationSeconds: input.plannedDurationSeconds }
      : {}),
    ...(desiredStart ? { desiredStart } : {}),
    ...(typeof input.lockTime === 'boolean' ? { lockTime: input.lockTime } : {}),
    ...(typeof input.lockPlace === 'boolean' ? { lockPlace: input.lockPlace } : {}),
    ...(typeof input.lockItem === 'boolean' ? { lockItem: input.lockItem } : {}),
    ...(typeof input.notes === 'string' ? { notes: input.notes } : {}),
  })
  if (!result.ok) return mapItineraryError(result.error)
  return NextResponse.json(result.value, { status: 201 })
}
