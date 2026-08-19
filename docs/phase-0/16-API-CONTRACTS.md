# API contracts — v1

**Status:** Phase 0 · 2026-08-19

Route handlers are thin: validate, resolve actor, call one application service, map to response.
No domain logic and no direct database access in a handler (ADR-0001).

## 1. Conventions

| Concern | Rule |
| --- | --- |
| Base path | `/api/v1`; health endpoints at `/api/health/*` (unversioned by design) |
| Auth | Session cookie — `httpOnly`, `SameSite=Lax`, `Secure` outside local dev |
| CSRF | Double-submit token plus origin validation on every cookie-authenticated write |
| Content type | `application/json; charset=utf-8` |
| Validation | Zod at the boundary; unknown fields rejected, not silently ignored |
| Pagination | Cursor only. `?cursor=&limit=` (default 25, max 100). Never offset |
| Idempotency | `Idempotency-Key` **required** on the writes listed in §9 (ADR-0016) |
| Concurrency | `If-Match: "<version>"` on updates to versioned resources; mismatch → 409 |
| Correlation | Every response carries `X-Correlation-Id`; echoed in logs and audit events |
| Errors | Envelope in §10; stable codes in `17-ERROR-CODES.md` |
| Rate limits | `X-RateLimit-Limit` / `-Remaining` / `-Reset` on limited endpoints |

**Time in payloads.** Instants are ISO-8601 UTC with `Z`. Wall-clock intentions send
`{ localDate, localTime, ianaZone }` as a triple (ADR-0007). A bare local datetime without a zone
is rejected — it is precisely the ambiguity that produces missed trains.

## 2. Shared types

```ts
type DataStatus = 'REALTIME' | 'SCHEDULED' | 'ESTIMATED' | 'MANUAL' | 'STALE' | 'UNAVAILABLE'
type CoverageTier = 'T0' | 'T1' | 'T2' | 'T3'
type TripRole = 'OWNER' | 'EDITOR' | 'VIEWER'

interface Provenance {
  status: DataStatus
  retrievedAt: string
  routerRegion?: string
  feeds?: { feedId: string; version: string; agency: string; licence: string; attribution: string }[]
}

interface Page<T> { items: T[]; nextCursor: string | null }
```

Every response object that carries a real-world fact carries `provenance`. It is not optional and
it is not a debug field — the UI renders the confidence badge from it.

## 3. Trips

### `GET /api/v1/trips`
`?status=PLANNING|UPCOMING|PAST|ARCHIVED|SHARED&cursor=&limit=` → `200 Page<TripSummary>`
Returns trips where the caller is a member. `SHARED` means member but not owner.

### `POST /api/v1/trips`
```jsonc
{ "title": "Lisbon in spring", "startDate": "2026-04-10", "endDate": "2026-04-17",
  "travelerCount": 2, "destinations": [{ "name": "Lisbon", "coord": [-9.1393, 38.7223] }] }
```
→ `201 Trip`. Each destination resolves to a `coverageTier` server-side; the client never sets it.
`400 VALIDATION_FAILED` if `endDate < startDate`.

### `GET /api/v1/trips/:tripId`
→ `200 Trip` including members, destinations with coverage tiers, counts and `version`.
`404 NOT_FOUND` for a non-member — **not** `403`, so membership cannot be probed.

### `PATCH /api/v1/trips/:tripId`
Requires `If-Match`. Writable: `title`, `coverAssetId`, `status`, `dates`, `travelerCount`, `tags`,
`visibility`, `notes`. Not writable: `ownerId`, `version`, any coverage field.
→ `200 Trip` · `409 VERSION_CONFLICT` with current server state · `403 INSUFFICIENT_ROLE` for a viewer.

### `DELETE /api/v1/trips/:tripId`
Soft delete. Owner only. → `204`.

### `POST /api/v1/trips/:tripId/duplicate`
Copies structure, places and preferences. **Does not copy** route snapshots (they are answers to
questions about specific dates — ADR-0006) or bookings. → `201 Trip`.

## 4. Preferences

### `GET /api/v1/trips/:tripId/preferences`
Returns the resolved set **and its provenance**, so the UI can explain which value won:
```jsonc
{ "resolved": { "pace": "RELAXED", "maxWalkMetersPerLeg": 800 },
  "sources":  { "pace": "TRIP_OVERRIDE", "maxWalkMetersPerLeg": "PROFILE_DEFAULT" } }
```

### `PUT /api/v1/trips/:tripId/preferences`
Sets trip-level overrides. `null` on a field clears the override and restores inheritance.
→ `200`. Changing preferences never mutates an existing itinerary; it affects the next plan or
replan, and the response says so via `affectsNextPlanOnly: true`.

## 5. Days and items

### `GET /api/v1/trips/:tripId/days`
`?include=items` → `200 { days: TripDay[] }`, items ordered by `ordinal`, each with its inbound
route summary and provenance.

### `POST /api/v1/trips/:tripId/items` · `PATCH /api/v1/trips/:tripId/items/:itemId`
```jsonc
{ "tripDayId": "…", "kind": "ACTIVITY", "placeId": "…", "title": "Jerónimos Monastery",
  "localStartTime": "10:00", "localDate": "2026-04-11", "ianaZone": "Europe/Lisbon",
  "plannedDurationSeconds": 5400, "lockTime": false }
```
→ `201`/`200 { item, affectedLegs: RouteSummary[], violations: ConstraintViolation[] }`

The response always reports what else moved. A write that silently reshuffles a day without saying
so violates the "explain changes" principle.

### `POST /api/v1/trips/:tripId/items/reorder`
```jsonc
{ "preview": true, "moves": [{ "itemId": "…", "toDayId": "…", "toOrdinal": 2 }], "version": 7 }
```
→ `200 { previewToken, affectedLegs, violations, scheduleDelta }`

`preview: true` computes and returns without persisting; the client commits by replaying the same
body with `preview: false` and the `previewToken`. **Only legs adjacent to a move are recalculated**
— a reorder touches at most four leg boundaries, never the whole day.

`409 VERSION_CONFLICT` carries current server state so the client can render a diff.
`410 PREVIEW_EXPIRED` if the token is older than its window.

### `DELETE /api/v1/trips/:tripId/items/:itemId`
Soft delete. → `200 { affectedLegs, violations }`.

## 6. Versions

### `GET /api/v1/trips/:tripId/versions` → `200 Page<VersionSummary>`
### `GET /api/v1/trips/:tripId/versions/:versionNumber` → `200 { snapshot }`
### `POST /api/v1/trips/:tripId/versions/:versionNumber/restore`
Creates a **new** version whose content matches the old one. History is never rewritten.
→ `201 { versionNumber }`.
### `GET /api/v1/trips/:tripId/versions/:a/diff/:b` → `200 { changes: ChangeOperation[] }`

## 7. AI planning

### `POST /api/v1/trips/:tripId/ai/plan`
Requires `Idempotency-Key`.
```jsonc
{ "scope": { "kind": "DAY", "tripDayId": "…" },
  "instruction": "make this less rushed",
  "respectLocks": true }
```
→ `202 { jobId, conversationId }`

Enqueues; never plans inline. Replay with the same key returns the same `jobId`.
`409 PLAN_IN_PROGRESS` if another plan job is active for this trip.

### `GET /api/v1/jobs/:jobId`
→ `200`
```jsonc
{ "id": "…", "status": "RUNNING", "stage": "ROUTING",
  "progress": { "routedLegs": 6, "totalLegs": 9 },
  "sourcesChecked": [ { "provider": "OTP", "calls": 6 }, { "provider": "NOMINATIM", "calls": 4 } ],
  "changeSetId": null }
```

`sourcesChecked` is projected from `ai_tool_events` rows — the claim cannot be rendered unless the
call actually happened. No chain-of-thought is ever exposed; `stage` and counters only.
`DELETE /api/v1/jobs/:jobId` cancels.

### `GET /api/v1/trips/:tripId/ai/changes/:changeSetId`
→ `200`
```jsonc
{ "status": "PROPOSED",
  "changes": [ { "id": "c1", "op": "REMOVE_ITEM", "itemId": "…", "rationale": "…" },
               { "id": "c2", "op": "MOVE_ITEM", "itemId": "…", "toOrdinal": 1,
                 "affectedLegs": [ /* with provenance */ ] } ],
  "unresolvedCandidates": [ { "name": "Café do Mercado", "reason": "NO_MATCHING_PLACE" } ],
  "unmetConstraints": [ { "code": "MAX_WALK_EXCEEDED", "detail": "…" } ],
  "confidence": { "routedLegs": 8, "estimatedLegs": 1, "unavailableLegs": 0 } }
```

`unresolvedCandidates` are shown and **never applied automatically** (ADR-0005). Surfacing them is
honest; applying them would be fabrication.

### `POST /api/v1/trips/:tripId/ai/changes/:changeSetId/apply`
Requires `Idempotency-Key`.
```jsonc
{ "acceptChangeIds": ["c1", "c2"], "version": 7 }
```
Applies **only** the listed changes, in one transaction with the version bump and audit event.
→ `200 { versionNumber, appliedChangeIds, rejectedChangeIds, affectedLegs, violations }`
`409 VERSION_CONFLICT` · `410 CHANGE_SET_EXPIRED`.

## 8. Places and routes

### `GET /api/v1/places/search`
`?q=&near=lon,lat&bbox=&categories=&limit=`
→ `200 Page<Place>` — each with `sources[]` carrying provider, licence and attribution.

**Submit-triggered only.** There is no autocomplete endpoint, and building one against public
Nominatim is prohibited (ADR-0011). Requests queue behind the global 1 req/s limiter; when queued,
the response is `202 { retryAfterMs }` rather than a failure, so the UI can show a waiting state.
`429 RATE_LIMITED` only when the queue depth is exceeded.

### `GET /api/v1/places/reverse`
`?lon=&lat=` → `200 Place | 204` (204 = nothing found, which is not an error).

### `POST /api/v1/places` — user-created place by pin, name, address or coordinates.
Runs duplicate detection; `200 { place, duplicateOf }` when an existing match is found instead of
silently creating a second record.

### `POST /api/v1/routes/plan`
```jsonc
{ "origin": { "coord": [-9.1393, 38.7223] }, "destination": { "placeId": "…" },
  "departAt": "2026-04-11T09:00:00Z", "ianaZone": "Europe/Lisbon",
  "modes": ["WALK","TRANSIT"],
  "preferences": { "maxWalkMeters": 800, "maxTransfers": 2, "wheelchair": true },
  "alternatives": 3 }
```
→ `200 { routes: NormalizedRoute[], provenance }`

Exactly one of `departAt` / `arriveBy` is required.

Distinct outcomes, never conflated:
- `200` with `routes: []` and `status: 'UNAVAILABLE'` → **we asked, no route exists**
- `503 PROVIDER_UNAVAILABLE` → **the router is down**
- `200` with `coverageTier: 'T1'` and walking-only routes → region has no transit data

The circuit breaker distinguishes these (ADR-0010); the UI renders three different states.

### `GET /api/v1/routes/:routeSnapshotId`
→ `200 NormalizedRoute` with full provenance. Immutable; long-cacheable. `status` is **derived at
read time** from `retrievedAt` and feed freshness — a snapshot fetched an hour later may correctly
return `STALE` where it once returned `REALTIME`, with no data having changed (R-15).

## 9. Bookings, budget, share

### `GET|POST /api/v1/trips/:tripId/bookings` · `PATCH|DELETE .../bookings/:bookingId`
`POST` requires `Idempotency-Key`. Confirmation references are encrypted at rest and returned
masked unless explicitly requested by an owner or editor.
**No payment-card field exists in the schema**, so `400 UNSUPPORTED_FIELD` on any attempt.

### `GET|PUT /api/v1/trips/:tripId/budget` · `GET|POST .../budget/expenses`
Expense creation requires `Idempotency-Key`. Splits are validated to sum exactly to the total in
minor units. Cross-currency totals require an explicit `exchangeRateSnapshotId`; a manual rate
returns `rateSource: 'MANUAL'` and the UI must not present it as live.
→ `409 BUDGET_EXCEEDED` is **not** used — over-budget is a warning in the response body, not a
rejection. The product informs; it does not refuse the user's own money.

### `POST /api/v1/trips/:tripId/share`
```jsonc
{ "mode": "LINK", "includeBookings": false, "expiresAt": "2026-05-01T00:00:00Z" }
```
→ `201 { shareUrl, tokenId }`. Token shown once. `DELETE .../share/:tokenId` revokes immediately.
`GET /api/v1/shared/:token` returns the read-only projection, excluding private booking detail by
default.

### `POST /api/v1/trips/:tripId/invitations`
Requires `Idempotency-Key`. Invite by exact email with a role. No user search or discovery endpoint
exists — that is deliberate (threat model §3, Spoofing).

## 10. Health and errors

### `GET /api/health/live` → `200 { status: 'ok' }` — process is up. No dependency checks.
### `GET /api/health/ready`
```jsonc
{ "status": "degraded",
  "checks": { "database": "ok", "queue": "ok",
              "otp": { "status": "degraded", "regions": { "klang-valley": "ok", "portland": "unbuilt" } },
              "ai": "ok" } }
```
`200` when ready, `503` when not. **`degraded` is a valid ready state**: the app must serve trips
when weather, imagery or AI is unavailable (PRD §6). Only the database and queue are hard
dependencies.

### Error envelope

```jsonc
{ "error": { "code": "VERSION_CONFLICT",
             "message": "This trip changed since you loaded it.",
             "correlationId": "01J…",
             "details": { "currentVersion": 9 } } }
```

`code` is stable and machine-readable; `message` is safe for display and carries no internals.
No stack traces, no provider payloads, no secrets. Full taxonomy in `17-ERROR-CODES.md`.

## 11. Idempotency summary

| Endpoint | Reason |
| --- | --- |
| `POST /trips/:id/ai/plan` | Expensive job; retried on flaky mobile networks |
| `POST /trips/:id/ai/changes/:id/apply` | Non-idempotent state change |
| `POST /trips/:id/invitations` | Avoids duplicate emails |
| `POST /trips/:id/bookings` | Avoids duplicate records |
| `POST /trips/:id/budget/expenses` | Avoids double-counting money |

Same key + same fingerprint replays the stored response. Same key + different fingerprint →
`409 IDEMPOTENCY_KEY_REUSE`.
