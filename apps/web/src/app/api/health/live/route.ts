import { NextResponse } from 'next/server'

/**
 * Liveness: is the process up?
 *
 * Deliberately checks no dependencies. If this probed the database, a provider
 * outage would restart a perfectly healthy process and turn a degraded service
 * into a down one.
 */
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}
