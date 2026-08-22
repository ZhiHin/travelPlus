import { loadEnv, publicConfig } from '@travelplus/config'
import type { Metadata } from 'next'
import { TripCanvas } from '../../../components/TripCanvas'

/**
 * The Journey Canvas — map and ribbon, side by side.
 *
 * This server component does one thing: hand the client the public config it
 * is allowed to see. Everything the canvas shows comes through `/api/v1`, so
 * there is exactly one read path and RLS stands in front of all of it.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Trip' }

export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  const { mapStyleUrl } = publicConfig(loadEnv())
  return <TripCanvas tripId={tripId} mapStyleUrl={mapStyleUrl} />
}
