# Architecture decision log

Format: context → decision → consequences → alternatives rejected.
Status values: `Accepted` (binding), `Provisional` (accepted but revisit at the named gate), `Superseded`.

---

## ADR-0001 — Modular monolith with one separate worker process

**Status:** Accepted · 2026-08-19

**Context.** The product needs long-running work (AI planning, region graph sync, feed ingestion,
notification fan-out) that cannot run inside a request handler. It does not need independent
scaling of a dozen services, and premature service boundaries would make transactional
consistency between itinerary versions, route snapshots and audit events much harder.

**Decision.** One deployable Next.js application (`apps/web`) plus one deployable worker
(`apps/worker`), sharing typed packages. Infrastructure services (Postgres, OTP, Ollama) are
separate containers because they are separate products, not because we split our own domain.

**Consequences.** A single database transaction can span "apply change set + write route snapshot
references + write audit event", which the master prompt requires. Deployment is two processes,
not one — serverless-only hosting is therefore not sufficient, and this is stated in the cost
document.

**Rejected.** Microservices per bounded context (unjustified operational cost at this size);
running jobs in serverless request handlers (cannot hold a persistent worker, cannot stream
progress reliably, and the master prompt explicitly forbids pretending otherwise).

---

## ADR-0002 — OpenTripPlanner 2 as the routing engine, one router per region

**Status:** Accepted · 2026-08-19

**Context.** No free provider offers complete worldwide multimodal transit routing. OTP is
open source, consumes OSM + GTFS + GTFS-Realtime, and is the engine behind real production
transit deployments.

**Decision.** Self-hosted OTP 2 in its own container. One OTP router serves one region graph.
A `routing_regions` table maps a bounding geometry to a router ID; the routing package resolves
the region from request coordinates before calling OTP.

Verified against OTP documentation on 2026-08-19: current release 2.8.1 (2.9 on master), requires
Java 25, serves on port 8080 by default, official image `opentripplanner/opentripplanner` on
Docker Hub, data mounted at `/var/opentripplanner/`, build with `--build --save` then serve with
`--load --serve`, heap set via `JAVA_TOOL_OPTIONS`. Inputs are an OSM PBF extract plus a GTFS zip
whose filename must contain `gtfs`.

**Consequences.** Coverage is exactly the set of regions we have built graphs for, and the product
must show that honestly. Adding a country is an operational task — obtain OSM extract, obtain
licensed GTFS, build graph, validate, register region — not a code change. OTP exposes GraphQL
APIs (GTFS GraphQL and Transmodel) plus a legacy REST API; the adapter targets the GTFS GraphQL
API and normalizes its response, so a future OTP API change is contained in one module.

**Rejected.** Valhalla (excellent road routing, weaker GTFS transit story); a hosted transit API
(all viable ones are paid, violating the free-default rule); a single planet-wide graph (memory
and build time make it infeasible).

---

## ADR-0003 — PostgreSQL + PostGIS is the only source of truth; pg-boss is the queue

**Status:** Accepted · 2026-08-19

**Context.** We need spatial queries, strong transactional guarantees, a job queue, and no
billable infrastructure in the default path.

**Decision.** Postgres with PostGIS holds everything. Jobs use pg-boss in the same database.
No Redis and no separate broker in the MVP.

**Consequences.** One backup covers data and job state. Queue throughput is bounded by Postgres,
which is far above MVP need. If job volume ever justifies it, pg-boss sits behind a `JobQueue`
port and can be replaced.

**Rejected.** Redis/BullMQ (an extra service and an extra backup story for no MVP benefit);
a managed cloud queue (billable, violates the free-default rule).

---

## ADR-0004 — Drizzle ORM with reviewable SQL migrations; raw SQL where PostGIS or RLS requires it

**Status:** Accepted · 2026-08-19

**Context.** PostGIS column types, GiST indexes, RLS policies, partial and expression indexes,
and check constraints are not fully expressible in a TypeScript schema DSL.

**Decision.** Drizzle for schema definition, typed queries and the migration runner. Migrations
are plain, reviewable SQL files. Spatial columns, RLS policies, triggers and non-trivial
constraints are hand-authored SQL in the same migration sequence.

**Consequences.** Every migration is readable in review and in DBeaver. Drizzle's types and the
hand-written SQL can drift, so CI runs a migrate-from-clean and asserts the resulting schema
matches the Drizzle definition.

**Rejected.** Prisma (weaker raw-SQL and PostGIS ergonomics for this workload); ORM-generated
opaque migrations (unreviewable, and the master prompt requires reviewable migrations).

---

## ADR-0005 — The model proposes; deterministic services decide

**Status:** Accepted · 2026-08-19 · **Load-bearing. May not be relaxed without a new ADR.**

**Context.** The single largest product risk is a confident, wrong itinerary: an invented bus
number, an invented platform, an invented opening time. Users act on those in a foreign city
where they cannot easily detect the error.

**Decision.** The LLM may emit only: candidate activity names, a rationale, a desired time window,
an estimated visit duration, a priority, and an uncertainty flag. It may not emit route steps,
route numbers, stop names, departure or arrival times, fares, platforms, opening hours, or delay
information. Every such field is populated from a provider response or left absent. Scheduling
arithmetic is performed by a deterministic scheduler, not by the model.

**Consequences.** A candidate that cannot be resolved to a real place record is excluded from
automatic application and shown as unresolved. Plans are sometimes smaller than a pure-LLM
competitor's. That is the intended trade, and the product principle "reality before magic" exists
to defend it.

**Rejected.** Letting the model draft a full itinerary and post-validating it — validation cannot
detect a plausible invented bus number without doing the routing anyway, and partial acceptance of
invented content leaks into the UI.

---

## ADR-0006 — Route results are immutable, provenance-stamped snapshots

**Status:** Accepted · 2026-08-19

**Context.** A route is a statement about the world at a moment. Re-rendering an itinerary tomorrow
must not silently present yesterday's answer as current, and must not lose what was actually shown
when the user made a decision.

**Decision.** Every routing call persists a `route_snapshots` row: normalized legs, geometry,
router region, feed identifiers and versions, `retrieved_at`, and a status of `REALTIME` /
`SCHEDULED` / `ESTIMATED` / `MANUAL` / `STALE` / `UNAVAILABLE`. Itinerary items reference a
snapshot; they never store denormalised route text. Snapshots are never updated in place — a
recalculation writes a new snapshot.

**Consequences.** Storage grows with replanning. A retention policy trims snapshots not referenced
by a live itinerary version after a documented window. Freshness is derived from `retrieved_at`
plus a per-status TTL, so `STALE` is computed rather than guessed.

**Rejected.** Caching routes by origin/destination pair alone — it ignores departure time and feed
version, which is precisely how stale transit answers get presented as current.

---

## ADR-0007 — Time is stored three ways on purpose

**Status:** Accepted · 2026-08-19

**Context.** "Dinner at 19:00 in Lisbon" is a wall-clock intention. "The train departed" is an
instant. Daylight-saving transitions and multi-country trips break any model that stores only one.

**Decision.** Instants use `timestamptz` (UTC). Future wall-clock intentions additionally store a
local `date`, a local `time`, and an IANA zone identifier resolved from the place coordinates.
The UI formats in the destination's zone by default, with an explicit control to view in home zone.
Coordinate-to-zone resolution uses a local dataset package, never a network call.

**Consequences.** Two representations must be kept consistent. A single domain helper owns the
conversion and is unit-tested against DST transitions in both hemispheres, a zero-offset zone, and
a half-hour-offset zone (for example `Asia/Kolkata`).

**Rejected.** Storing only UTC (a plan pinned to 19:00 local drifts across a DST boundary);
storing only local time (cannot order events across zones).

---

## ADR-0008 — Money is `numeric` with an ISO 4217 code; never a float

**Status:** Accepted · 2026-08-19

**Decision.** All monetary amounts are `numeric(18,4)` paired with a `char(3)` ISO 4217 code.
Multi-currency totals are never summed without an explicit conversion carrying a rate, a rate date
and a rate source. A manually entered rate is stored with source `MANUAL` and is never displayed
as live.

**Consequences.** Split arithmetic uses integer minor units internally so splits sum exactly to the
total; the remainder unit is assigned deterministically rather than dropped. Property-based tests
assert that no split set loses or invents a minor unit.

---

## ADR-0009 — Row-level security is defence in depth, not the primary control

**Status:** Accepted · 2026-08-19

**Decision.** Application services perform explicit authorization. Additionally, every
tenant-scoped table has RLS enabled and **forced**, keyed off a per-transaction
`app.current_user_id` setting applied by the request-scoped database session. The application
connects as a role that is neither superuser nor table owner, so `FORCE ROW LEVEL SECURITY`
genuinely applies to it.

**Consequences.** A repository that forgets a `WHERE trip_id = …` returns zero rows instead of
another user's trip. Migrations and the worker use separate roles with documented, narrower
privileges. Every policy has a test that attempts cross-user access and asserts zero rows.

**Rejected.** RLS as the only control — row counts and error shapes still leak information, and
RLS expresses role-based write rules (owner vs editor vs viewer) far less clearly than application
policy code.

---

## ADR-0010 — All provider calls are server-side, behind typed adapters, with an SSRF allowlist

**Status:** Accepted · 2026-08-19

**Decision.** No browser code calls a third-party API except the map tile and style endpoints,
which are designed for browser use. Every other provider is reached through a server adapter that
owns timeout, retry with jitter where safe, circuit breaking, cache policy, rate limiting, request
identification and instrumentation. Outbound HTTP goes through a client that resolves the host,
rejects private, loopback and link-local address ranges, and refuses cross-host redirects.

**Consequences.** Provider identifiers and contact user-agents never reach the client. The domain
layer sees only normalized types and never a provider payload shape. Circuit breakers distinguish
"provider is down" from "provider answered, no route exists" — these produce different UI states
and must never be conflated.

---

## ADR-0011 — Geocoding: server proxy, hard 1 req/s application-wide, no client-side autocomplete

**Status:** Accepted · 2026-08-19 · **Compliance-critical**

**Context.** Verified against the Nominatim usage policy on 2026-08-19. The policy requires a
maximum of one request per second; requires a valid identifying `User-Agent` or `Referer` (stock
library defaults are insufficient); requires results to be cached on the client side; warns that
clients repeatedly sending the same query may be classified as faulty and blocked; states the
service runs on donated servers with very limited capacity; and **explicitly forbids implementing
autocomplete search against the API** — "you must not implement such a service on the client side
using the API". Bulk geocoding, where permitted at all, is limited to 4 requests per minute,
single-threaded, with no distributed scripts.

**Decision.** Development geocoding uses public Nominatim through a server proxy only. A single
application-wide token bucket enforces 1 req/s across all users and all processes, backed by
`provider_rate_limit_state` in Postgres rather than per-process memory. Search is submit-triggered;
there is no keystroke autocomplete anywhere in the product. Results are cached in
`provider_cache_entries` with a documented TTL, and identical repeated queries are served from
cache. The app sends an identifying User-Agent including a contact address. Attribution is shown.
The provider is chosen by configuration so self-hosted Nominatim, Photon or Pelias can replace it
with no domain-code change.

**Consequences.** Search is submit-then-wait, not type-ahead. This is a deliberate compliance
choice, and the UI is designed around it rather than apologising for it — see
`ux/INTERACTION-MODEL.md` §Search. Any future type-ahead requires a self-hosted geocoder first.
Because the limit is global rather than per-user, the search endpoint must queue and surface a
"waiting for geocoder" state instead of failing.

---

## ADR-0012 — OpenFreeMap for tiles by default; PMTiles self-host documented; never prefetch tiles

**Status:** Accepted · 2026-08-19 · **Compliance-critical**

**Context.** Verified on 2026-08-19. OpenFreeMap states no limits on map views or requests, no
registration and no API keys, permits commercial use, publishes weekly full-planet downloads for
self-hosting, and asks for the attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap".
Separately, the OSM Foundation tile usage policy verified the same day forbids pre-emptive fetching
of tiles beyond what a user is actively viewing, forbids building tile archives, and states that
offline use is not permitted on `tile.openstreetmap.org`.

**Decision.** MapLibre GL JS renders. The style URL is one configuration value consumed through a
single map-config module, never hard-coded across components. Default style is OpenFreeMap, with a
self-hosted Protomaps/PMTiles path documented for production. **The PWA never prefetches or bundles
map tiles.** Offline mode caches trip data, route instructions and place coordinates, and renders a
non-map fallback where tiles are unavailable. Attribution is visible at all times and cannot be
hidden behind a toggle.

**Consequences.** "Offline map" is explicitly out of scope and stated as such in the UI. Delivering
it later requires a licensed or self-hosted regional tile bundle — it is not a cache warm-up, and
must never be implemented as one against a public tile service.

---

## ADR-0013 — Ollama is the default AI provider behind an `AIProvider` port, with a deterministic fake for CI

**Status:** Accepted · 2026-08-19

**Decision.** `packages/ai` exposes an `AIProvider` interface. The default implementation targets a
local Ollama server using structured JSON output, and every response is parsed with Zod before it
reaches domain code. A second implementation, `FakeAIProvider`, returns fixture responses
deterministically. **CI uses the fake exclusively and must never require a local model or a paid
API.** An OpenAI-compatible adapter may be added later without changing domain logic.

**Consequences.** Model quality varies by local model; what makes output trustworthy is the
constraint engine and the repair loop, not the model choice. Prompts, schemas and the repair loop
are versioned so that changing a model is an observable, testable event rather than a silent
behavioural shift. Model responses are never parsed with regular expressions — validation failure
triggers one structured retry carrying the validation errors, then a safe user-facing failure.

---

## ADR-0014 — Portland, Oregon (TriMet) is the Phase 3 sample region

**Status:** ~~Provisional~~ **Superseded by ADR-0021** · 2026-08-19

Superseded the same day after Malaysian open transit data was verified directly. Portland is
retained, but as a narrow realtime-validation asset rather than the pilot — see ADR-0021 and
ADR-0022. The original reasoning (OTP's tutorial builds against Portland; TriMet static GTFS needs
no AppID; ~1 GB heap suffices) remains factually correct and is why Portland keeps a role at all.

---

## ADR-0015 — UUIDv7 primary keys

**Status:** Accepted · 2026-08-19

**Decision.** All primary keys are UUIDv7, generated in the application layer so identifiers exist
before insert (required for outbox and audit correlation). Time-ordering keeps index locality close
to a bigserial while remaining non-guessable and safe to expose in URLs.

**Rejected.** Bigserial (enumerable in URLs, and enumeration is exactly the attack the
authorization tests must defeat); UUIDv4 (index fragmentation on high-write tables such as
`route_snapshots` and `audit_events`).

---

## ADR-0016 — Idempotency keys on retry-prone writes

**Status:** Accepted · 2026-08-19

**Decision.** AI plan creation, change-set application, invitations, booking creation and expense
creation require an `Idempotency-Key` header. The key, a request fingerprint and the resulting
response are stored. A replay with the same key returns the stored response; the same key with a
different fingerprint is rejected as a conflict.

**Consequences.** A user double-tapping "Generate plan" on a flaky mobile connection gets one job,
not two, and one bill of compute rather than two.

---

## ADR-0017 — Offline scope is one trip snapshot, explicitly bounded

**Status:** Accepted · 2026-08-19

**Decision.** The service worker caches the app shell plus a user-selected trip's itinerary,
normalized route instructions, place coordinates and notes — each stamped with a captured-at time
and shown with an offline badge. Session tokens and private attachments are not cached. Safe local
edits queue in IndexedDB and reconcile on reconnect using the same optimistic-concurrency version
fields as online writes; conflicts surface a diff rather than silently overwriting.

**Consequences.** Offline is genuinely useful for "what am I doing next and how do I get there",
and honestly useless for "find me somewhere new". The UI states which, rather than letting the user
discover it by failure.

---

## ADR-0018 — No permanent sidebar: the Living Journey Canvas navigation model

**Status:** Accepted · 2026-08-19

**Decision.** Navigation is a floating command pill (top), a centred Journey Dock (bottom, on both
desktop and mobile), contextual floating islands, and a Journey Ribbon that morphs between a
compact horizontal strip and a detailed vertical story. Place detail uses an expandable peek sheet
that never fully occludes the map.

**Consequences.** Every floating surface must be keyboard reachable with managed focus and must
have a documented mobile equivalent. That is a real accessibility cost this design owes, and it is
paid by ADR-0018a.

### ADR-0018a — The map is never the only access path

**Status:** Accepted · 2026-08-19

Every route, marker and geometry rendered on the map has an equivalent, complete,
keyboard-navigable list or step representation carrying the same information, including provenance
and status. Transit status is never conveyed by colour alone. WCAG 2.2 AA is a phase gate
condition, not a polish item.

---

## ADR-0019 — Optimistic concurrency on collaborative records

**Status:** Accepted · 2026-08-19

**Decision.** `trips`, `trip_days`, `itinerary_items` and `budgets` carry an integer `version`.
Writes send the version they read; a mismatch returns a conflict carrying current server state so
the client can present a diff. The version bump happens in the same transaction as the write.

**Consequences.** Two collaborators dragging the same day cannot silently overwrite each other.
The offline reconcile path reuses this mechanism rather than inventing a second one.

---

## ADR-0020 — Open-Meteo's free tier is non-commercial; commercial use requires a decision

**Status:** Provisional · 2026-08-19 · **Blocking before any commercial launch**

**Context.** Verified on 2026-08-19: the free API allows fewer than 10,000 calls per day, 5,000 per
hour and 600 per minute. Its non-commercial definition covers private and non-profit sites without
subscriptions or advertising, personal use, public research and education — and **excludes**
subscription sites, ad-supported sites and integration into commercial products. Data is offered
under CC-BY 4.0.

**Decision.** Development and non-commercial use consume the free tier through a server adapter
with coordinate-and-date caching, well inside the stated limits. Weather is advisory, never a safety
guarantee, and no itinerary operation is blocked by weather being unavailable. The provider sits
behind a port so a paid tier or self-hosted model can replace it.

**Consequences.** If TravelPlus becomes commercial, this row must change before launch. Tracked as
R-07 in `RISKS.md` and raised as an open item on the Phase 0 gate.

---

## ADR-0021 — Kuala Lumpur / Klang Valley is the pilot routing region

**Status:** Accepted · 2026-08-19 · supersedes ADR-0014

**Context.** The instruction was to consider Kuala Lumpur first and select it only if the required
data is legally and technically available. That is a test with a pass condition, so it was answered
by fetching Malaysian open-data documentation on 2026-08-19 rather than by preference.

Verified: `https://api.data.gov.my/gtfs-static/` publishes Prasarana feeds under categories
`rapid-rail-kl` (LRT, MRT, Monorail), `rapid-bus-kl`, `rapid-bus-mrtfeeder`, plus KTMB commuter rail
— **with no API key required**. That is a genuine multi-operator, multi-mode metropolitan network
available openly.

**Decision.** Kuala Lumpur is the pilot region. It beats Portland on modes exercised, multi-operator
transfers, absence of any key requirement, i18n pressure from Malay place names, and — decisively —
relevance to the stated market. Portland's only advantages are OTP tutorial familiarity, which is a
first-week convenience, and TripUpdates, which is handled by ADR-0022.

**Consequences.** Four feeds merge into one Klang Valley graph, each retaining its own
`transit_feeds` provenance row so licence and attribution stay per-operator. Inter-operator
transfers (LRT ↔ KTM Komuter) depend on OSM walk paths between station entrances and must be
explicitly validated — a graph that silently fails to connect adjacent stations produces
plausible-looking "no route" answers, which is the worst failure mode because it reads as data
rather than as a bug. Phase 3 grows by roughly two days.

**Blocked on.** `data.gov.my/terms`, `/terms-of-use` and `developer.data.gov.my/terms-of-use` all
returned **HTTP 404** to automated fetches. Because `transit_feeds.licence` is `NOT NULL` with no
"unknown" value, the pilot feeds are **structurally un-ingestible** until a human confirms the
licence. Tracked as X-01.

**Rejected.** Portland as pilot (technically easier, strategically irrelevant); Helsinki (HSL and
Digitransit both returned HTTP 403, so nothing could be verified); Seoul (Korean transit data is not
openly licensed GTFS, contradicting the free-default rule).

---

## ADR-0022 — Feed capability flags, and why the pilot ships at scheduled confidence

**Status:** Accepted · 2026-08-19 · **load-bearing**

**Context.** Two facts verified on 2026-08-19 combine into a product constraint.

1. Malaysia publishes GTFS-Realtime **VehiclePosition only**, at a 30-second cadence with no API
   key. TripUpdates and ServiceAlerts are "in our pipeline for 2026".
2. The GTFS-Realtime reference states that **TripUpdate** carries `StopTimeUpdate` predicted arrivals
   and departures, while **VehiclePosition** carries position, bearing, speed, congestion and
   occupancy and **excludes predicted stop times**.

Therefore Kuala Lumpur cannot produce delay-adjusted departure predictions today.

**Decision.** Feed capability becomes a first-class data concept rather than an assumption:

```ts
interface FeedCapabilities { tripUpdates: boolean; vehiclePositions: boolean; serviceAlerts: boolean }
```

**`REALTIME` requires `tripUpdates === true`.** A region with vehicle positions alone can never
produce a `REALTIME` departure, and a Phase 3 test asserts no KL route returns that status. Vehicle
positions still ship as a labelled position-only map layer — genuinely useful, and clearly not a
prediction.

**Consequences.** The pilot ships at coverage tier **T2 (scheduled)**, not T3, and the product says
so. Realtime code paths are validated against Portland, which publishes all three feed types. When
Malaysian TripUpdates arrive, KL is promoted T2 → T3 by a configuration and feed-capability change
with **no product-code change** — which is the region-pack architecture proving itself.

**Why this is load-bearing.** Without the capability flag, the obvious implementation reads "we have
a realtime feed, so show live" and puts a live badge on data containing no predictions. That is
exactly the class of confident wrongness ADR-0005 and rule TRUTH-07 exist to prevent, arriving
through the infrastructure layer instead of through the model.

---

## ADR-0023 — Structured LLM output is best-effort, so validation and repair are load-bearing

**Status:** Accepted · 2026-08-19 · refines ADR-0013

**Context.** Verified from Ollama's structured-outputs documentation on 2026-08-19: a JSON Schema is
passed via the `format` parameter and the OpenAI-compatible path uses `response_format`, but the
documentation offers **no validation guarantee**. It recommends additionally grounding the schema in
the prompt text and setting temperature to 0, describing the feature as probabilistic. Ollama Cloud
does not currently support structured outputs at all.

**Decision.** Treat structured output as a hint, never a contract. Zod validation at the boundary and
the bounded repair loop are load-bearing components, not belt-and-braces. Temperature 0 and in-prompt
schema grounding become **required configuration**, recorded as BR-AI9, rather than tuning
suggestions someone may later "optimise" away.

**Consequences.** The `AI_INVALID_OUTPUT` path is a normal operating case that must be tested, not an
exceptional one. Model prose is never parsed with regular expressions. Because the repair loop is
bounded at two attempts, a persistently malformed model fails safely with a useful message rather
than looping.

**Why it matters here specifically.** A product whose central claim is "we do not invent transport
facts" cannot rest that claim on a provider feature documented as probabilistic. The claim rests on
the schema having no transport fields (ADR-0005) and on validation rejecting anything else.

---

## ADR-0024 — The product is named TravelPlus

**Status:** Accepted · 2026-08-20 · owner decision

**Context.** "TripWeave" was a working title carried through Phase 0, explicitly marked replaceable
in the master development prompt. The owner has now set the canonical product name.

**Decision.** The product is **TravelPlus**. The rename was applied across all Phase 0
documentation, the repository README, database role names, environment examples and provider
user-agent strings.

**Scope of the rename, applied 2026-08-20 (27 occurrences across 11 files):**

| Form | Before | After | Count |
| --- | --- | --- | --- |
| Product name | `TripWeave` | `TravelPlus` | 9 |
| Provider user agent | `TripWeave/0.1 (contact: …)` | `TravelPlus/0.1 (contact: …)` | 2 |
| Application DB role | `tripweave_app` | `travelplus_app` | 9 |
| Worker DB role | `tripweave_worker_sys` | `travelplus_worker_sys` | 4 |
| Migration DB role | `tripweave_migrator` | `travelplus_migrator` | 3 |

**Deliberately not renamed.** Third-party provider names (OpenTripPlanner, Nominatim, OpenFreeMap,
Prasarana, KTMB, TriMet, Open-Meteo, Wikimedia, Ollama); external source identifiers and feed
category slugs (`rapid-rail-kl`, `rapid-bus-kl`, `rapid-bus-mrtfeeder`, `ktmb`); and the directory
name `travelPlus`, which already matches.

**Why the database roles were renamed and why that is safe.** The role names are product-scoped
identifiers, and the master prompt's exclusion covers *migrations that have already been applied*.
No migration has been applied — no database exists, and no code exists — so there is no deployed
schema to break. Renaming now avoids permanently carrying a dead working title inside the security
model. Had a migration already run, the roles would have been left alone and the rename confined to
new migrations.

**Consequences.** Every future artifact uses `TravelPlus` and `travelplus_*`. The provider user-agent
strings carry the product name to third parties, so this change also satisfies the Nominatim and
Wikimedia identification requirements under the correct name rather than a retired one.

---

## ADR-0025 — Windows host baseline for local development

**Status:** Accepted · 2026-08-20

**Context.** Preflight inspection of the development host on 2026-08-20, before any system change.

| Property | Value |
| --- | --- |
| OS | Microsoft Windows 11 Home |
| Version / build | 10.0.26200.0 / build 26200 |
| Architecture | 64-bit (x64) |
| CPU | Intel Core i7-10750H, 6 cores / 12 threads |
| RAM | 15.8 GB |
| Disk C: free | 72.5 GB of 475.9 GB |
| Virtualization in firmware | **Enabled** (`VirtualizationFirmwareEnabled = True`) |
| Hypervisor running | No (`HypervisorPresent = False`) — expected before WSL 2 |
| WSL | **Not installed** |
| Docker Desktop | **Not installed** |
| winget | Available, v1.29.280 |
| Node.js | v24.18.0 |
| Git | 2.55.0.windows.2, with Git Credential Manager bundled |

**Decision.** The host meets every requirement for the Docker Desktop WSL 2 backend: build 26200 is
far above the 19041 minimum, virtualization is enabled in firmware, and RAM and disk are sufficient
for a PostGIS container plus an OpenTripPlanner graph needing ~2 GB heap.

**Consequences.** No BIOS/UEFI change is required — `VirtualizationFirmwareEnabled = True` confirms
VT-x is already on, so the firmware blocker anticipated in the Phase 0 backlog does not apply.
Installing WSL 2 does require **administrator elevation and a system restart**, per Microsoft's
current documentation retrieved 2026-08-20, which makes it a stop condition under the agreed blocker
policy rather than something to perform unattended.
