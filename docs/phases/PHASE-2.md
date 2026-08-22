# Phase 2 — Trip spaces and place foundations

**Status:** Complete · 2026-08-21
**Gate:** Met — see §7
**Commits:** `c82d9c8` → `c8426bc` (8 commits)
**Tests:** 403 passing, 0 skipped (288 unit + 115 integration)

---

## 1. What Phase 2 was for

Phase 1 built a foundation nobody could see. Phase 2 makes the product's central
honesty claim *operational*: a traveller now learns what TravelPlus can actually
do for a destination **before** committing to plan there, and every provider call
obeys its licence by construction rather than by discipline.

Three things had to become real rather than documented:

- **Coverage is a data property.** A destination resolves to a tier by a PostGIS
  containment query against the installed region catalog — not a lookup table
  someone maintains by hand.
- **The Nominatim policy is enforced by shape.** One shared request-per-second
  budget across all processes, caching before the limiter, and no autocomplete
  entry point anywhere to call.
- **Attribution cannot be removed by a redesign.** The strings live in the
  domain with tests around them.

## 2. Stories delivered

| ID | Story | State | Evidence |
| --- | --- | --- | --- |
| P2-01 | Trip CRUD, duplicate, archive, soft delete | Done | 24 integration tests |
| P2-02 | Destinations with coverage-tier resolution | Done | Derived by PostGIS containment; T2 for the pilot |
| P2-03 | Trip preferences with inheritance | Done (schema) | Nullable-means-inherit; UI lands with the preference studio |
| P2-04 | Members and roles, server-side authorization | Done | Viewer refused at service **and** RLS |
| P2-05 | Itinerary version storage | Deferred to Phase 4 | Needs itinerary items to version |
| P2-06 | Geocoder abstraction + compliant Nominatim adapter | Done | 17 unit + 14 limiter integration tests |
| P2-07 | MapLibre + OpenFreeMap with attribution | Done | Attribution is a required, tested domain value |
| P2-08 | Places, sources, saved places, duplicate detection | Done | 20 integration tests |

## 3. File inventory

### `packages/domain` — new rules

| File | Purpose | Tests |
| --- | --- | --- |
| `coverage.ts` | Tier derivation from region and feed facts. T3 requires `tripUpdates`, so a positions-only feed can never reach it | 24 |
| `attribution.ts` | Licence-condition strings, frozen, each recording *why* it is required | 12 |

### `packages/integrations` — the provider boundary

| File | Purpose | Tests |
| --- | --- | --- |
| `rate-limit.ts` | Database-backed token bucket. One row per provider under `SELECT … FOR UPDATE` | 14 (itest) |
| `http.ts` | SSRF-safe client: host allow-list, DNS checked against private ranges, redirects refused | 19 |
| `cache.ts` | Shared provider cache. Caching is a policy requirement, not an optimisation | — |
| `geocoder.ts` | Nominatim adapter. No autocomplete method exists to call | 17 |

### `packages/db` — schema

| File | Purpose | Tests |
| --- | --- | --- |
| `0002_trips_and_places.sql` | 13 tables: regions, feeds, places, destinations, cache, limiter | via services |
| `0003_fix_trip_insert_policies.sql` | Repairs the unsatisfiable INSERT policy — see §5 | 5 new RLS tests |

### `apps/web` — services and UI

| File | Purpose | Tests |
| --- | --- | --- |
| `server/trips/service.ts` | Trip CRUD, coverage resolution, optimistic concurrency | 24 (itest) |
| `server/places/service.ts` | Two-stage duplicate detection, saved places, spatial search | 20 (itest) |
| `server/http/context.ts` | Shared guard: session → CSRF → service; error mapping | 13 |
| `app/api/v1/trips/route.ts` | List and create trips | via guard tests |
| `app/api/v1/places/search/route.ts` | Submit-triggered search; 202 when queued | via guard tests |
| `components/MapCanvas.tsx` | MapLibre with non-collapsible attribution | build + a11y |
| `components/PlaceSearch.tsx` | Submit-triggered search with local suggestions | build |
| `components/TripCard.tsx` | Coverage badge and mini-ribbon | build |

## 4. The decisions that carry the most weight

### 4.1 The rate limiter lives in the database

Nominatim caps the **whole application** at 1 req/s. A per-process limiter
breaches that the moment a second container starts, and the penalty is an IP
block that takes search down for every user.

So the budget is one row per provider, taken under `SELECT … FOR UPDATE`. Proven
with two independent connection pools standing in for two processes: exactly one
of ten concurrent callers wins, and a ten-second window at 1/s yields at most
eleven grants.

The refill is persisted on the **refusal** path too — without that, a
continuously polling caller restarts the clock on every rejected attempt and
starves indefinitely.

### 4.2 No autocomplete, enforced three ways

The policy states plainly that autocomplete "must not" be implemented against
the API. Rather than document that:

1. The `Geocoder` port has no `suggest`/`autocomplete`/`typeahead` method. Two
   tests assert the shape stays that way.
2. A test **walks the real app directory** and asserts no route segment is named
   after an incremental-search endpoint — so a route added anywhere is covered
   without anyone remembering to update a list.
3. The UI's type-ahead affordance is served from *local* recents and saved
   places, which cost no provider request. The feel users expect survives
   exactly where it is legitimate.

### 4.3 Duplicate detection reports; it does not merge

Exact provider identity is certain, so a repeat resolves silently. Spatial
proximity plus trigram similarity is a **heuristic**, so it reports and writes
nothing. Auto-merging on a guess is how two distinct places quietly become one
and a user's saved note lands on the wrong pin.

### 4.4 Attribution is a domain value, not markup

The strings live in `packages/domain` with tests asserting the OSM line is
present, the arrays are frozen, and `attributionFor()` never returns empty when
a map is shown. MapLibre's own control is **disabled**, because it is collapsible
and the OSMF policy forbids hiding attribution behind a toggle.

Feed attribution is derived from stored metadata rather than a constant: the text
must match the feed actually backing the route, and a constant drifts the moment
a second operator is added.

## 5. Problems found and how they were resolved

### 5.1 An unsatisfiable RLS policy blocked all trip creation

**The bug.** Phase 1 gave `trips` a single `FOR ALL` policy gated on
`app.trip_role(id) = 'OWNER'`. That role is read from `trip_members`, which does
not exist yet when the trip row is inserted. The `WITH CHECK` was unsatisfiable:

```
new row violates row-level security policy for table "trips"
```

**Why 22 passing RLS tests missed it.** Every one seeded its fixtures through the
**migrator** role, which owns the tables and therefore bypasses RLS. Cross-user
*reads* were exercised thoroughly; the authenticated *write* path was never
exercised at all. The suite checked that policies keep the wrong people out, and
never that they let the right people in.

**The lesson, which generalises.** Read-only RLS fixtures hide write-path policy
bugs. Any future migration adding a policy needs a test that writes **as the app
role, under policy** — not just one that reads.

**The fix.** `FOR ALL` split into per-verb policies. INSERT is authorised by the
row's own `owner_id` — a fact present in the row being written — while UPDATE and
DELETE stay role-gated. Five new RLS tests now exercise authenticated writes.

### 5.2 A latent infinite loop in the rate limiter

`acquire` bounded its retry loop on a wall-clock deadline alone, which silently
assumes the clock advances. Under a frozen clock — a test, a suspended VM, a
stepped debugger — it spins forever. Found by a test that injected a fixed clock.
Fixed with an attempt cap so the loop terminates on its own terms.

### 5.3 Three test failures that were the test's fault

Worth recording together, because the tempting fix each time was to loosen the
assertion:

| Failure | Reality |
| --- | --- |
| Argon2 timing comparison flaked | Measuring a cold first call. Fixed with warmup and median-of-N, not a wider bound |
| "no tier promises live departures below T3" | T2's honest sentence *"Live departures are not available here"* contains the phrase. Assertion moved to the `available` list |
| Places flagged unrelated fixtures as duplicates | Every fixture shared an `ITEST ` prefix at one coordinate. The detector was right; the fixtures were wrong |

Loosening any of the three would have left a suite that proves less while looking
the same.

### 5.4 Environment

Docker Desktop stopped between sessions (restarted, no code involved). A native
`postgresql-x64-17` service holds port 5432 on this machine, so TravelPlus maps
to **5433**; the existing installation was left untouched.

## 6. Deliberate limitations

| Limitation | Why | When it changes |
| --- | --- | --- |
| Itinerary versioning deferred | Nothing to version until itinerary items exist | Phase 4 |
| Preference studio UI not built | Schema and inheritance rules are done; the screen is Phase 4 work | Phase 4 |
| Trip-space home page not assembled | Components exist and build; page composition follows the itinerary work | Phase 4 |
| Cursor pagination returns `nextCursor: null` | Envelope shape is in place so adding it is not breaking | When list sizes justify it |
| Email delivery throws | Failing loudly beats pretending a message was sent | Phase 6 notification worker |
| KL pilot feeds still un-ingestible | `transit_feeds.licence` is NOT NULL and data.gov.my's terms are unverified (R-17) | Blocks Phase 3 |

## 7. Gate verification

The Phase 0 gate for this phase was: *rate limiter holds across two processes;
attribution asserted; no autocomplete endpoint exists.*

```
pnpm verify             exit 0    format + lint + typecheck + 288 unit tests
pnpm test:integration   exit 0    115 tests, real PostgreSQL (stable ×2)
next build              exit 0    compiled successfully
pnpm db:migrate         exit 0    0002 and 0003 applied
```

| Gate condition | Met | Evidence |
| --- | --- | --- |
| **Rate limiter holds across two processes** | ✅ | Two independent pools; exactly one of ten concurrent callers wins |
| **Attribution asserted** | ✅ | Domain tests; `attributionFor()` never empty with a map |
| **No autocomplete endpoint exists** | ✅ | Route-tree walk asserts no such segment anywhere |
| No skipped tests | ✅ | 403 run, 0 skipped |
| Migrations forward-only from clean | ✅ | 0002, 0003 applied in sequence |
| No secrets committed | ✅ | Scanned each commit |

## 8. Test distribution

| Suite | Tests | What it protects |
| --- | --- | --- |
| `domain/auth` | 26 | Session lifetimes, throttle, token replay |
| `domain/coverage` | 24 | **A positions-only feed can never reach T3** |
| `auth/http` | 23 | Cookie attributes, CSRF, throttle keys |
| `auth/crypto` | 22 | Argon2id, timing-oracle defence |
| `domain/money` | 20 | Unit conservation across ~1,000 combinations |
| `integrations/http` | 19 | SSRF: private ranges, IPv4-mapped IPv6, redirects |
| `integrations/geocoder` | 17 | **Policy compliance: no autocomplete, cache before limiter** |
| `config/logger` | 16 | Redaction at depth, coordinate coarsening |
| `config/env` | 13 | Startup refuses a contact-less User-Agent |
| `domain/status` | 13 | Confidence derivation |
| `domain/time` | 13 | DST both hemispheres, half-hour offsets |
| `http/context` | 13 | **Route-tree walk: no autocomplete segment** |
| `domain/attribution` | 12 | Licence lines present and frozen |
| `domain/route` | 12 | Live-badge gate; absent fields stay absent |
| `domain/id` | 10 | UUIDv7 ordering across 2³² ms |
| `db/session` | 8 | Transaction-local `set_config` |
| `test-utils/boundaries` | 13 | Hostile imports rejected |
| **`auth.itest`** | **30** | Enumeration resistance — real database |
| **`rls.itest`** | **27** | Security gate, now including write-path |
| **`trips.itest`** | **24** | Coverage resolution, concurrency, 404-not-403 |
| **`places.itest`** | **20** | Duplicate detection over real PostGIS |
| **`rate-limit.itest`** | **14** | Cross-process budget |
| | **403** | |

## 9. Commits

| Commit | Content |
| --- | --- |
| `c82d9c8` | Schema, rate limiter, SSRF-safe client |
| `41a4596` | Compliant Nominatim geocoder with shared cache |
| `e395f32` | Coverage tier derivation |
| `aeb9602` | **Fix: unsatisfiable RLS INSERT policy** + trip services |
| `2830147` | Places with two-stage duplicate detection |
| `6afcf92` | Map canvas with enforced attribution |
| `6475b3b` | Place search and trip cards |
| `c8426bc` | API route handlers with a shared request guard |

## 10. What Phase 3 inherits

- Coverage tiers that resolve against a real region catalog
- A provider boundary where the licence rules are structural
- Trips and places with authorization proven at service **and** database
- 403 tests that will catch a regression in any of it

**Phase 3 is blocked on R-17** before it can ingest anything: `transit_feeds.licence`
is `NOT NULL` with a `CHECK` rejecting placeholder values, and data.gov.my's terms
returned HTTP 404 on three URLs. That is deliberate — the schema makes an
unverified feed un-ingestible rather than trusting a reminder. A human with a
browser needs to confirm the licence before the Kuala Lumpur pilot can be built.
