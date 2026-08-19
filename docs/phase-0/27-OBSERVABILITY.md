# Observability, health and service levels

**Status:** Phase 0 · 2026-08-19

Local-first and cost-free: OpenTelemetry-compatible structured output to stdout, with no vendor
required. A collector can be attached later without touching application code.

## 1. Correlation

One ID follows a unit of work from browser to database. Generated at the edge, echoed in
`X-Correlation-Id`, carried into every job through the pg-boss payload, attached to every provider
call, and written to `audit_events.correlation_id`.

This is what makes "the user says planning failed at 14:03" a two-minute investigation: one ID
recovers the request, the job, every provider call and the audit trail.

## 2. Structured logs

```jsonc
{ "ts": "2026-08-19T12:04:01.221Z", "level": "info", "msg": "route.plan.completed",
  "correlationId": "01J…", "userId": "01J…", "tripId": "01J…",
  "provider": "otp", "routerRegion": "klang-valley",
  "durationMs": 412, "status": "SCHEDULED", "legCount": 4 }
```

Event names are dotted and stable, so they can be aggregated: `route.plan.*`, `ai.job.*`,
`provider.call.*`, `auth.*`, `feed.sync.*`, `rls.denied`.

**Never logged:** passwords, tokens or their hashes, session identifiers, full AI prompts,
booking confirmation references, precise private coordinates, provider credentials, request bodies
containing personal data. A redaction layer strips known-sensitive keys before serialisation, so
this holds even when someone logs an object carelessly.

Coordinates, when logged at all, are rounded to ~1 km. Knowing a route was planned in Lisbon is
operationally useful; knowing which building someone stood in front of is not, and is a liability.

## 3. Traces

Spans: HTTP request → application service → repository → provider call. Job spans link to the
request span that enqueued them, so an async planning job is not an orphan.

Attributes worth carrying: `provider`, `routerRegion`, `dataStatus`, `cacheHit`,
`circuitState`, `feedVersion`.

## 4. Metrics

| Metric | Why it matters |
| --- | --- |
| `route.plan.duration` (p50/p95/p99) by region | The dominant user-visible latency |
| `route.plan.status` by `DataStatus` | A rising `UNAVAILABLE` rate signals a data problem, not a code one |
| `provider.call.errors` by provider and class | Separates outage from empty result |
| `provider.circuit.state` | Open circuits are user-visible degradation |
| `geocoder.queue.depth` and `geocoder.wait.ms` | The 1 req/s global limiter is a real queue with a real wait |
| `geocoder.rate_limited.count` | **Approaching a policy breach.** Alert before we are blocked |
| `provider.cache.hit_ratio` | A falling ratio means we are hammering a donated service |
| `ai.job.duration`, `ai.job.repair_attempts`, `ai.job.failures` | Planner health |
| `ai.validation.failures` | Model output drifting from schema |
| `ai.tool.denied` | **Security signal** — an attempted unauthorized tool call |
| `feed.sync.last_success_age` by feed | Directly drives `REALTIME` vs `STALE` |
| `itinerary.reroute.legs_recalculated` | Should stay small; a spike means incremental recalculation regressed |
| `rls.denied.count` | Should be ~0 in normal operation; non-zero means a repository lost a predicate |

Two of these are unusual and deliberate. `rls.denied.count` treats the defence-in-depth layer as a
smoke alarm: if RLS is actually catching something, an application-layer check failed and that is a
bug worth waking up for. `geocoder.rate_limited.count` alerts *before* a policy breach becomes a
block, because being blocked is an outage we inflicted on ourselves (R-03).

## 5. Health endpoints

`GET /api/health/live` — process liveness. No dependency checks, so a provider outage never causes
a restart loop.

`GET /api/health/ready` — dependency readiness with per-check detail:

```jsonc
{ "status": "degraded",
  "checks": { "database": "ok", "queue": "ok",
              "otp": { "status": "degraded", "regions": { "klang-valley": "ok", "portland": "unbuilt" } },
              "ai": "ok", "geocoder": "ok" } }
```

**Hard dependencies: database and queue only.** Everything else degrades. `degraded` returns `200`,
because the product must serve an existing trip when weather, imagery, AI or even routing is
unavailable — that requirement is in the PRD, and encoding it here is what stops a deploy pipeline
from treating a weather outage as a failed release.

## 6. Service level objectives (proposed for Phase 8)

| SLO | Target | Rationale |
| --- | --- | --- |
| Trip view availability | 99.5% monthly | The core read path |
| Trip view p95 latency | < 1.5 s on a mid-range mobile | PRD non-functional requirement |
| Route plan p95 | < 2.5 s | Below the threshold where users retry |
| AI plan completion p95 | < 90 s | Jobs are async and show real progress |
| Data-integrity SLO | **100% of transport facts traceable to a provider response** | Not a percentage target. One violation is a defect, not a budget spend |

The last row is not an availability target and does not get an error budget. It is the product's
central claim, and there is no acceptable rate of breaking it.

## 7. Alerts

| Condition | Severity |
| --- | --- |
| `rls.denied.count > 0` sustained | High — an authorization bug is live |
| `ai.tool.denied > 0` | High — possible prompt injection in the wild |
| Geocoder 429/403 rate rising | High — approaching a block (R-03) |
| Feed `last_success_age` > freshness window ×3 | Medium — realtime silently degraded to stale |
| Circuit open > 5 min | Medium |
| `route.plan.status = UNAVAILABLE` rate above baseline | Medium — likely a graph or feed problem |
| Cache hit ratio below threshold | Medium — provider-policy risk |

## 8. Backup and restore

Nightly `pg_dump` including PostGIS geometry. **Restore is tested on a schedule, not assumed** — an
untested backup is a hope. The restore drill is documented with a measured recovery time and is
re-run each phase from Phase 3, when the data starts being expensive to rebuild.

Retention per `14-DATA-MODEL.md` §6. The OTP graph is *not* backed up: it is
reproducible from the recorded OSM extract and GTFS version, which is exactly why those are stored
with checksums.
