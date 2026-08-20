import { NextResponse } from 'next/server'

/**
 * Readiness, with per-check detail.
 *
 * `degraded` is a valid 200. The product must keep serving a saved trip when
 * weather, imagery, AI or even routing is unavailable, so only the database and
 * the queue are hard dependencies. Treating a weather outage as a failed deploy
 * is exactly the mistake this shape prevents.
 */
export const dynamic = 'force-dynamic'

type CheckState = 'ok' | 'degraded' | 'down' | 'unconfigured'

interface ReadyReport {
  status: 'ok' | 'degraded' | 'down'
  checks: Record<string, CheckState | Record<string, CheckState>>
}

export function GET() {
  // Phase 1: the dependency probes land with their subsystems in Phase 2-5.
  // Reporting `unconfigured` is honest; reporting `ok` would not be.
  const report: ReadyReport = {
    status: 'degraded',
    checks: {
      database: 'unconfigured',
      queue: 'unconfigured',
      otp: 'unconfigured',
      ai: 'unconfigured',
      geocoder: 'unconfigured',
    },
  }

  const hardDependencies: CheckState[] = [
    report.checks.database as CheckState,
    report.checks.queue as CheckState,
  ]
  const status = hardDependencies.includes('down') ? 503 : 200

  return NextResponse.json(report, { status })
}
