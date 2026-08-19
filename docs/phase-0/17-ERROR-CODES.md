# Error code taxonomy

**Status:** Phase 0 · 2026-08-19

Codes are stable and machine-readable. Messages are safe for display, carry no internals, and are
localised through `next-intl` keyed by code. **A code is never removed or repurposed** — retiring
one means never reusing the string.

## Envelope

```jsonc
{ "error": { "code": "…", "message": "…", "correlationId": "…", "details": { } } }
```

`details` is structured and typed per code — never a free-text dump.

## Authentication and session — 401 / 403

| Code | HTTP | Message shown | Notes |
| --- | --- | --- | --- |
| `UNAUTHENTICATED` | 401 | Sign in to continue. | No session or expired |
| `SESSION_EXPIRED` | 401 | Your session expired. Sign in again. | Distinct so the client can preserve unsaved work |
| `INVALID_CREDENTIALS` | 401 | Email or password is incorrect. | Identical response and comparable timing whether or not the account exists |
| `ACCOUNT_LOCKED` | 429 | Too many attempts. Try again later. | Includes `retryAfterSeconds` |
| `EMAIL_NOT_VERIFIED` | 403 | Verify your email to continue. | |
| `CSRF_FAILED` | 403 | Your request could not be verified. Reload and retry. | |
| `INSUFFICIENT_ROLE` | 403 | You have view-only access to this trip. | Only for a **confirmed member** with the wrong role |

## Authorization and existence — 404

| Code | HTTP | Message | Notes |
| --- | --- | --- | --- |
| `NOT_FOUND` | 404 | We couldn't find that. | **Returned for a non-member requesting a real trip.** Distinguishing "exists but forbidden" from "does not exist" would let an attacker enumerate trips |
| `SHARE_LINK_INVALID` | 404 | This link is no longer available. | Revoked, expired and never-existed are indistinguishable in shape and timing |

## Validation — 400 / 422

| Code | HTTP | Message | `details` |
| --- | --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Some fields need attention. | `{ fieldErrors: { path: string[] } }` |
| `UNSUPPORTED_FIELD` | 400 | That field can't be set. | Mass-assignment attempt, or a field that deliberately does not exist (e.g. payment card) |
| `INVALID_DATE_RANGE` | 400 | The end date must be on or after the start date. | |
| `MISSING_TIMEZONE` | 400 | A time zone is required for this time. | A bare local datetime is rejected (ADR-0007) |
| `AMBIGUOUS_LOCAL_TIME` | 422 | That time occurs twice on this date because clocks change. | DST fall-back; `details.candidates` lists both instants |
| `NONEXISTENT_LOCAL_TIME` | 422 | That time doesn't exist on this date because clocks change. | DST spring-forward; `details.suggested` offers the nearest valid time |

`AMBIGUOUS_LOCAL_TIME` and `NONEXISTENT_LOCAL_TIME` exist because silently picking one
interpretation is how a traveller misses a flight.

## Concurrency and idempotency — 409 / 410

| Code | HTTP | Message | `details` |
| --- | --- | --- | --- |
| `VERSION_CONFLICT` | 409 | Someone else changed this trip. Review the differences. | `{ currentVersion, currentState }` — enough to render a diff, never a silent overwrite |
| `IDEMPOTENCY_KEY_REUSE` | 409 | This request was already made with different content. | |
| `PLAN_IN_PROGRESS` | 409 | A plan is already being generated for this trip. | `{ jobId }` |
| `CHANGE_SET_EXPIRED` | 410 | These suggestions are out of date. Generate a new plan. | The itinerary moved underneath a proposal |
| `PREVIEW_EXPIRED` | 410 | Your preview expired. Try the change again. | |

## Planning and constraints — 422

`PLANNING_FAILED` (422) carries a `violations[]` array. These are not errors in the request; they
are truths about the world, and the UI renders them as explanations.

| Violation code | Meaning |
| --- | --- |
| `OVERLAP` | Two items occupy the same time |
| `IMPOSSIBLE_TRANSFER` | Routed travel time exceeds the gap between items |
| `MAX_WALK_EXCEEDED` | Exceeds the per-leg or per-day walking preference |
| `PLACE_CLOSED` | Arrival falls outside opening hours — only raised when confidence is `FEED` |
| `MISSING_MEAL` | No meal within a configured meal window |
| `INSUFFICIENT_BUFFER` | Gap below the minimum transfer or buffer preference |
| `OUTSIDE_USER_HOURS` | Falls before earliest start or after latest finish |
| `LOCKED_ITEM_CONFLICT` | Resolution would require moving a locked item |
| `ACCESSIBILITY_UNSATISFIED` | No step-free route where step-free is required |
| `ACCESSIBILITY_UNKNOWN` | Feed does not state accessibility — **not** a failure, a disclosure |
| `BUDGET_EXCEEDED` | Estimated cost exceeds the trip budget — a warning, never a rejection |
| `NO_ROUTE_FOUND` | Router returned no path for this pair, time and modes |
| `UNRESOLVED_PLACE` | A candidate matched no real place record and was excluded |

`ACCESSIBILITY_UNKNOWN` is deliberately a distinct code from `ACCESSIBILITY_UNSATISFIED`. Telling a
wheelchair user "the feed doesn't say" is honest and actionable; telling them "no accessible route"
when we simply lack data is a different, and worse, statement.

## Provider and data availability — 424 / 503

The distinction below is the one the circuit breaker exists to preserve (ADR-0010). Conflating
"no route exists" with "router is down" is a correctness bug, not a cosmetic one.

| Code | HTTP | Message | Meaning |
| --- | --- | --- | --- |
| `PROVIDER_UNAVAILABLE` | 503 | We can't reach the routing service right now. | Provider down / circuit open. **Retryable** |
| `PROVIDER_TIMEOUT` | 504 | The routing service took too long. | Partial results may accompany this |
| `ROUTE_UNAVAILABLE` | 200 | No route found for that time and travel mode. | **Provider answered; no path exists. Not an error** — returned in the body with `status: 'UNAVAILABLE'` |
| `REGION_NOT_COVERED` | 200 | We don't have transit data for this area yet. | Coverage tier T0/T1; walking and driving offered |
| `FEED_EXPIRED` | 200 | Schedule data for this area has expired. | GTFS service dates do not cover the trip |
| `REALTIME_STALE` | 200 | Live data is out of date; showing scheduled times. | Derived from feed freshness (R-15) |
| `GEOCODER_QUEUED` | 202 | Searching… | Waiting behind the 1 req/s global limiter (ADR-0011) |
| `RATE_LIMITED` | 429 | Too many requests. Please wait. | `{ retryAfterSeconds }` |

Four of these return `200`. That is intentional: absence of data is a designed product state, not an
HTTP failure, and modelling it as an error pushes the UI toward error screens where it should be
showing a fallback.

## AI — 422 / 503

| Code | HTTP | Message |
| --- | --- | --- |
| `AI_UNAVAILABLE` | 503 | The planner is unavailable right now. Your trip is unaffected. |
| `AI_INVALID_OUTPUT` | 422 | The planner couldn't produce a usable plan. Try a simpler request. |
| `AI_REPAIR_EXHAUSTED` | 422 | We couldn't satisfy all your constraints. Here's what blocked it. |
| `AI_TOOL_DENIED` | 403 | *(internal — never surfaced)* |

`AI_REPAIR_EXHAUSTED` returns the `violations[]` that could not be resolved after two repair
attempts. Failing with an explanation beats succeeding with an invention.

`AI_TOOL_DENIED` is logged to `ai_tool_events` and never returned to a client — a model attempting
an unauthorized tool call is a security event, not a user-facing error.

## Server — 500

| Code | HTTP | Message |
| --- | --- | --- |
| `INTERNAL_ERROR` | 500 | Something went wrong on our side. | 

Includes `correlationId` and nothing else. Details are logged server-side only.

## Client mapping rules

1. **Never** render a raw code to a user; map to a localised message keyed by code.
2. A `200` carrying `ROUTE_UNAVAILABLE`, `REGION_NOT_COVERED`, `FEED_EXPIRED` or `REALTIME_STALE`
   renders a **designed empty or partial state with fallbacks**, never an error screen.
3. `VERSION_CONFLICT` renders a diff, never a silent overwrite and never a lost edit.
4. `PROVIDER_UNAVAILABLE` and `PROVIDER_TIMEOUT` are retryable with backoff; `ROUTE_UNAVAILABLE` is
   not — retrying it just asks the same answered question again.
5. Every error surface shows the correlation ID in a copyable form for support.
