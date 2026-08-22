# Phase 3 — Regional routing: the Klang Valley graph

**Status:** Complete · 2026-08-23
**Gate:** Met — see §7
**Commits:** `f916a5c` → `29a7fae`, completed by the Phase 3 close commit (see §9)
**Tests:** 552 passing, 0 skipped (391 unit + 161 integration, of which 5 run against the live router)

---

## 1. What Phase 3 was for

Phases 1 and 2 could describe a route's confidence. Phase 3 is where a route
actually comes from. A real multi-operator transit graph for the pilot region,
a router we control, an adapter that refuses to invent what the feed did not
say, and a snapshot that records what the traveller was shown so it can never
be quietly recalculated out from under them.

Four things had to become real:

- **The feeds are legally ingestible.** R-17 was open at the start of the
  phase. It is now resolved: data.gov.my publishes under CC BY 4.0, verified
  2026-08-21 at `developer.data.gov.my/faq`. The licence gate in the pipeline
  runs *before* any byte is downloaded.
- **Transfers between operators work.** A KTM Komuter → LRT journey is the
  phase's exit test, because a single-operator query passes while a broken
  inter-feed transfer graph stays invisible (R-18).
- **The normalizer preserves absences.** No platform, stop code, delay or
  accessibility fact appears in a result that the feed did not supply.
- **Kuala Lumpur stays SCHEDULED.** The feeds publish VehiclePositions only.
  Every provenance in this phase is `SCHEDULED`; nothing can reach `REALTIME`
  without a TripUpdates feed (ADR-0022).

## 2. Stories delivered

| ID | Story | State | Evidence |
| --- | --- | --- | --- |
| P3-01 | Licence-gated GTFS ingestion | Done | 30 unit tests; gate is the first statement in `ingestFeed` |
| P3-02 | OTP 2.8.1 container, pinned | Done | `docker-compose.yml` profile `routing`, healthy |
| P3-03 | Klang Valley graph build from 4 feeds + OSM | Done | `graph.obj` 104 MB, 5,993 stops, 38,806 transfers, 2m01s |
| P3-04 | OTP GraphQL adapter with SSRF-safe client | Done | `createOtpClient`, three-way outcome |
| P3-05 | Route normalizer (absence-preserving) | Done | 33 unit tests |
| P3-06 | Immutable route snapshots, status derived on read | Done | 17 integration tests; no UPDATE/DELETE grant |
| P3-07 | Inter-operator transfer proven live | Done | Komuter → LRT at Abdullah Hukum, 93 min, `realTime=false` on every leg |
| P3-08 | Region/router registry | Done (schema) | `routing_regions`, `transit_feeds`, `feed_versions` |

## 3. File inventory

### `packages/routing` — new package

| File | Purpose | Tests |
| --- | --- | --- |
| `ingest.ts` | `assertLicenceVerified` → `validateFeed` → `ingestFeed`. The licence check is the first line and throws before the fetch. `KLANG_VALLEY_FEEDS` pins the 4 data.gov.my feeds with their CC BY 4.0 record. `otpFilenameFor` enforces OTP's `*gtfs*.zip` naming requirement, which it otherwise fails silently | 30 |
| `normalize.ts` | `normalizeItinerary` turns an OTP itinerary into a `NormalizedRoute`. Every optional field is requested explicitly so absence is observable; `feedIdFor` attributes each leg to the feed that ran it | 33 |
| `otp.ts` | `createOtpClient` over GraphQL. Outcome is `routes` / `no-route` / `unavailable` — "we could not ask" is never reported as "no journey exists". `localDateTime` converts instants to the router's zone | 4 |
| `otp.itest.ts` | **Live** tests against the built graph. Skips with a loud notice if the router is down; ran green for this record | 5 |

### `apps/web/src/server/routes`

| File | Purpose | Tests |
| --- | --- | --- |
| `snapshots.ts` | Write a `NormalizedRoute` as an immutable `route_snapshots` row; read it back with status derived from `retrieved_at` and feed health, never from the stored value | 17 (itest) |

### `packages/db/migrations`

| File | Purpose |
| --- | --- |
| `0004_route_snapshots.sql` | `routing_regions`, `transit_feeds` (licence NOT NULL), `feed_versions`, `route_requests`, `route_snapshots` with **no `updated_at` column** and **no UPDATE/DELETE grant** to the app role |

### `infra/otp`

| File | Purpose |
| --- | --- |
| `build-graph.mjs` | Fetch the pinned Geofabrik extract and 4 feeds (16 s gaps for the 4 req/min portal budget), **clip OSM to the Klang Valley with osmium**, write `build-config.json`, run the pinned OTP build container, record `manifest.json` with checksums |
| `data/` | Gitignored: raw OSM, clipped OSM, GTFS archives, `graph.obj`. Reproducible from the manifest |

### `docker-compose.yml`

| Change | Why |
| --- | --- |
| `otp` service, profile `routing` | Pinned `2.8.1`; a graph is not portable across versions |
| `command: ['--load', '--serve']` | The image entrypoint appends the directory itself; naming it again fails with "single directory" |
| Healthcheck posts a GraphQL query | The actuator endpoint is off by default; probe the API we actually depend on |

## 4. The decisions that carry the most weight

### 4.1 The licence gate runs before the download

`ingestFeed` calls `assertLicenceVerified` as its first statement. A feed whose
`licence` is unverified throws before `safeFetch` is reached. This is the
structural form of "do not ingest legally unverified feeds into production": the
code path to an unlicensed byte on disk does not exist.

### 4.2 Clip the map before OTP sees it (§5.1)

OTP's build config has no OSM bounding box. The Geofabrik extract covers
Peninsular Malaysia, Singapore and Brunei (1.95 M ways), which a laptop's Docker
VM cannot hold. The clip is done with `osmium-tool` from Debian's package archive
inside the official `debian:bookworm-slim` image — nothing is installed on the
host, and no third-party image is trusted with the data directory.

### 4.3 Three outcomes, not two

`plan()` returns `routes`, `no-route`, or `unavailable`. A timeout, a 5xx, a
circuit open, malformed JSON — all are `unavailable` and retryable. Only a
successful empty answer is `no-route`. Collapsing them would let a router outage
render as "there is no way to get there", which is a fabrication.

### 4.4 Snapshots are immutable by grant, not by convention

`route_snapshots` has no `updated_at` column and the app role has no UPDATE or
DELETE privilege. A recalculation writes a new row. The record of what a
traveller was actually shown survives any later change in the feed.

### 4.5 `allowPrivateAddresses` is an explicit opt-in

The SSRF-safe client blocks private and loopback ranges by default — that is
the point of it. OTP, however, is *ours* and lives on the internal network by
design. Rather than weaken the default, `SafeFetchOptions` gained an explicit
`allowPrivateAddresses` flag that relaxes only the address check; the host
allow-list still fails closed. Only first-party services (OTP, later Ollama) set
it. Three unit tests pin the behaviour.

## 5. Problems found and how they were resolved

### 5.1 The full-country graph build thrashed at 67 %

The first build ran OTP against the unclipped extract with a 4 GB heap. Street
graph progress reached 1.32 M of 1.95 M ways over 26 minutes, then slowed to
~5,000 ways/min at 1,075 % CPU with the heap pinned at 4.3 GB — garbage
collection, not progress. The Docker VM has 7.6 GB total, so a larger heap was
not a fix.

The extract was clipped to the Klang Valley bbox (101.3, 2.8 → 102.0, 3.45):
238 MB → 47 MB, 20 M+ nodes → 5.4 M. The rebuild completed the street graph in
about a minute and the whole graph in 2m01s. The clip is now a step in
`build-graph.mjs`, keyed on the raw file's mtime so it reruns only when the
extract changes. The unrecognised `boundingBox` key that was in
`build-config.json` was removed — OTP never read it.

### 5.2 The client sent UTC to a router that reads local time

`createOtpClient` built `date` and `time` from `toISOString()`. OTP interprets
both in the router's zone, so a 09:00 Kuala Lumpur departure was being planned
at 01:00 local — a time at which nothing runs. Found by reading the query before
writing the live test, fixed with a required `routerZone` dep and
`localDateTime()`, pinned by 4 unit tests and a live test that asserts the first
departure is in the morning of the request.

### 5.3 Every leg was attributed to the first feed

`normalizeItinerary` stamped each transit leg with `context.feeds[0].feedId`.
In a single-feed graph this is invisible; in the four-feed Klang Valley graph
the Komuter leg of the exit-gate journey was attributed to Rapid Rail. The
**live cross-operator test caught it**: it looked for a route using both `ktmb`
and `prasarana-rapid-rail-kl` and found none. Fixed by deriving the feed from
OTP's scoped agency id (`<feedId>:<agencyId>`), only when it names a feed we
configured; otherwise the region is reported, never a guess. 3 unit tests added.

This is R-18 doing its job: "multi-feed graph fails to link inter-operator
transfers, silently." The transfer *linked* fine — it was our own attribution
that was silently wrong, and only a genuinely cross-feed assertion could see it.

### 5.4 Two container start-up errors

- OTP's entrypoint already appends `/var/opentripplanner/`; passing the
  directory again gives "You must supply a single directory name". Both the
  build script and the compose service now pass only the flags.
- `/otp/actuators/health` is 404 unless the actuator feature is enabled. The
  healthcheck now posts `{feeds{feedId}}` to the GraphQL endpoint and greps for
  a feed id. Container reports healthy.

### 5.5 A build log was committed by accident

`infra/otp/build.log.out` landed in `d7bb2d8`. Untracked in `980c06d` and
gitignored as `infra/otp/build.log*`. History was not rewritten.

### 5.6 A data quirk, recorded, not "fixed"

The KTMB feed types its Komuter routes as GTFS `route_type 0` (tram). OTP
therefore reports the mode as `TRAM`. The normalizer passes that through: it is
what the feed says, and correcting it by agency name would be exactly the kind
of silent substitution the product forbids. Logged as R-23 for a UI label
decision in Phase 8.

## 6. Deliberate limitations

| Limitation | Why | When it changes |
| --- | --- | --- |
| Street graph covers the Klang Valley bbox only | Memory; see §5.1. Stops outside it (Komuter to Seremban, Tanjung Malim) are in the transit graph but not street-linked | When a region outside the bbox is onboarded, its own graph |
| 120 stops remain isolated after island pruning | OSM gaps near some bus stops; OTP reports them, we do not paper over them | Feed/OSM improvements upstream |
| `REALTIME` unreachable in the pilot | Feeds publish VehiclePositions only (ADR-0022) | Never, unless a TripUpdates feed is published |
| Live tests skip when the router is down | A database-only CI machine must still run the rest of the suite | CI job with the graph cached, Phase 8 |
| Graph rebuild is manual | `node infra/otp/build-graph.mjs` | Scheduled feed refresh job, Phase 6 |

## 7. Gate verification

The Phase 0 gate for this phase was: *an LRT ↔ KTM Komuter transfer routes
correctly against the live graph; no fabricated fields; pilot stays SCHEDULED.*

```
pnpm verify             exit 0    format + lint + typecheck + 391 unit tests
pnpm test:integration   exit 0    161 tests, real PostgreSQL + live OTP 2.8.1
next build              exit 0    compiled successfully
docker compose ps       otp       Up (healthy)
node infra/otp/build-graph.mjs    graph.obj 104 MB in 2m01s
```

| Gate condition | Met | Evidence |
| --- | --- | --- |
| **Komuter ↔ LRT transfer routes live** | ✅ | Klang → Abdullah Hukum (KTM Port Klang Line) → Ampang Park (LRT KJL); `transferCount ≥ 1`, both feed ids present |
| **No fabricated fields** | ✅ | Live: `platform` undefined on every stop; `realtime` undefined on every leg. Unit: 33 normalizer tests |
| **Pilot stays SCHEDULED** | ✅ | Live: `provenance.status === 'SCHEDULED'` on every route |
| **Unreachable router ≠ no route** | ✅ | `unavailable` outcome, separate from `no-route` |
| Licence verified before ingest | ✅ | R-17 resolved; gate throws before fetch |
| Snapshots immutable | ✅ | Grant check in `snapshots.itest` |
| No skipped tests | ✅ | 552 run, 0 skipped (router was up) |
| Migrations forward-only from clean | ✅ | 0004 applied after 0001–0003 |
| No secrets or data files committed | ✅ | `infra/otp/data/` gitignored; scan per commit |

## 8. Test distribution (Phase 3 additions)

| Suite | Tests | What it protects |
| --- | --- | --- |
| `routing/normalize` | 33 | **Absence preserved; per-leg feed attribution** |
| `routing/ingest` | 30 | **Licence gate first; OTP filename rule** |
| `routing/otp` | 4 | Local-time conversion across zones |
| `integrations/http` | +3 | `allowPrivateAddresses` relaxes only the address check |
| **`routing/otp.itest`** | **5** | **Live cross-operator transfer; SCHEDULED only; no platform invented; no-route vs unavailable; local-time departure** |
| **`routes/snapshots.itest`** | **17** | Immutability by grant; status derived on read |

## 9. Commits

| Commit | Content |
| --- | --- |
| `f916a5c` | **R-17 resolved** — data.gov.my is CC BY 4.0; portal capped at 4 req/min (R-22) |
| `6177edc` | OTP adapter and normalized routing |
| `cd0be7e` | GTFS ingestion pipeline with a licence gate that runs first |
| `29a7fae` | Immutable route snapshots with derived status |
| `980c06d` | Untrack build log |
| `954e340` | (shared with Phase 4) OSM clip step in `build-graph.mjs` |
| *close* | Live transfer test, router-zone fix, per-leg feed attribution, healthcheck, this record |

## 10. What Phase 4 inherits

- A router that answers in under 500 ms for a cross-operator Klang Valley query
- A `NormalizedRoute` whose every field is either from the feed or absent
- Snapshots that cannot be edited, with status computed at read time
- 552 tests, 5 of which will fail the moment a feed stops linking
