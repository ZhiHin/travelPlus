import type { NextResponse } from 'next/server'
import { mapTripError, problem } from '../http/context.js'
import type { ItineraryError } from './service.js'

/**
 * Map an itinerary-service error to its documented HTTP shape.
 *
 * Only `locked` is new here; everything else shares the trip mapping so a 404
 * for a day, an item and a trip all look identical (roles doc R4).
 */
export function mapItineraryError(error: ItineraryError): NextResponse {
  if (error.kind === 'locked') {
    return problem(409, 'ITEM_LOCKED', error.reason, { itemId: error.itemId })
  }
  return mapTripError(error)
}

/** Parse a JSON body or return the 400 the contract promises. */
export async function jsonBody(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  try {
    const body = (await request.json()) as unknown
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, response: problem(400, 'VALIDATION_FAILED', 'Send a JSON object.') }
    }
    return { ok: true, body: body as Record<string, unknown> }
  } catch {
    return { ok: false, response: problem(400, 'VALIDATION_FAILED', 'Send a JSON body.') }
  }
}

/** A version is required on every mutation: optimistic concurrency is not optional (ADR-0019). */
export function requireVersion(body: Record<string, unknown>): number | NextResponse {
  const v = body.version
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return problem(400, 'VALIDATION_FAILED', 'Some fields need attention.', {
      problems: ['Send the version you last saw so we can detect conflicts.'],
    })
  }
  return v
}
