# Risk register

**Last updated:** 2026-08-19 (Phase 0)

Severity = Likelihood × Impact on a 1–5 scale. Anything scoring ≥ 12 is a gate blocker for the
phase in which it lands.

| ID | Risk | L | I | Score | Phase it bites |
| --- | --- | --- | --- | --- | --- |
| R-01 | Global transit coverage is far narrower than "global" implies | 5 | 5 | **25** | 3, 8 |
| R-02 | AI fabricates transport facts that reach a user | 3 | 5 | **15** | 5 |
| R-03 | Nominatim policy breach gets the app IP-blocked | 3 | 4 | **12** | 2 |
| R-04 | Hosting cost is not zero and the product implies it is | 4 | 3 | 12 | 8 |
| R-05 | GTFS feed licences forbid the redistribution we assume | 3 | 4 | 12 | 3, 8 |
| R-06 | Time-zone and DST arithmetic produces wrong itinerary times | 3 | 4 | 12 | 4 |
| R-07 | Open-Meteo free tier excludes commercial use | 4 | 3 | 12 | 6, launch |
| R-08 | OTP graph build fails or is too slow for the dev loop | 3 | 3 | 9 | 3 |
| R-09 | Prompt injection via place descriptions or notes | 3 | 3 | 9 | 5 |
| R-10 | Scope is very large; phases slip and quality is traded away | 4 | 4 | **16** | all |
| R-11 | Local LLM output quality is too low to be useful | 3 | 3 | 9 | 5 |
| R-12 | Floating-navigation UI fails WCAG 2.2 AA | 3 | 4 | 12 | 1, 4 |
| R-13 | Offline expectations exceed what tile policy permits | 3 | 3 | 9 | 6 |
| R-14 | Docker is absent on the development host | 5 | 3 | **15** | 1 |
| R-15 | Realtime data shown as current when the feed has gone stale | 3 | 5 | **15** | 6 |
| R-16 | Collaborative edits silently overwrite each other | 2 | 4 | 8 | 7 |
| R-17 | **Pilot feed licence unverified — ingestion blocked** | 4 | 5 | **20** | 3 |
| R-18 | Multi-feed graph fails to link inter-operator transfers, silently | 4 | 4 | **16** | 3 |
| R-19 | Structured LLM output is best-effort, not guaranteed | 4 | 3 | 12 | 5 |
| R-20 | Vehicle positions mistaken for predictions | 3 | 5 | **15** | 6 |

---

## R-01 — "Global" is a promise the data cannot keep

**What actually goes wrong.** A user in a city with no ingested GTFS feed asks for a plan, gets no
transit routes, and concludes the product is broken rather than that the data does not exist.

**Trigger to watch for.** Any UI copy, marketing page or AI response that says "worldwide",
"anywhere" or "every city" without qualification.

**Mitigation.** Coverage is a first-class data model (`routing_regions`, `transit_feeds`,
`transit_feed_versions`), not an assumption. Every destination entry resolves against the region
catalog before planning, and the trip surface shows a coverage badge with what is available:
transit, walking only, or driving only. The landing page states the coverage model plainly.
Fallbacks (walking, cycling, driving, manual entry, external deep link) are built in Phase 3, not
retrofitted. See `phase-0/07-COVERAGE-STRATEGY.md`.

**Residual.** Real. The product is honest about a narrow footprint rather than dishonest about a
wide one. This is a positioning decision the user should confirm.

---

## R-02 — The model invents a bus number

**What actually goes wrong.** A user boards the wrong service in a country whose language they do
not read, on the strength of a route number the product printed with full confidence.

**Trigger.** Any code path where a field rendered as a transport fact can be traced back to model
output rather than a provider response.

**Mitigation.** ADR-0005 constrains the model's output schema so it is structurally incapable of
emitting a route step. Enforcement is layered: (1) the `CandidateActivity` Zod schema has no
transport fields, so an attempt to emit one fails validation; (2) route legs are only ever
constructed by the routing package from an OTP response; (3) a rendering-level test asserts that
every transit label in the UI is sourced from a `route_snapshots` row; (4) place resolution
excludes unresolved candidates from automatic application.

**Verification.** A dedicated test suite feeds the fake provider deliberately malicious output —
an itinerary containing invented bus numbers and platform codes — and asserts that none of it
survives to the rendered plan.

---

## R-03 — Getting blocked by the geocoder

**What actually goes wrong.** The public Nominatim instance classifies the app as abusive and
blocks it, breaking search for everyone.

**Trigger.** Any per-process rate limiter, any client-side search-as-you-type, any repeated
identical uncached query, any missing identifying User-Agent.

**Mitigation.** ADR-0011. The limiter is application-wide and database-backed so it holds across
processes. There is no autocomplete anywhere in the product — the policy verified on 2026-08-19
explicitly forbids it. All results cached. Identifying User-Agent with contact address enforced by
configuration validation at startup, so the app refuses to boot without one.

**Early warning.** Alert on geocoder 429/403 rates and on cache hit ratio falling below a
documented threshold.

---

## R-04 — The cost story

**What actually goes wrong.** "Free" is read as "free to run in production", the product ships,
and bandwidth for tiles plus compute for OTP and the LLM produce a real bill.

**Mitigation.** `phase-0/07-COVERAGE-STRATEGY.md` states what free covers (local development, open
source, no billable key) and what it does not (production compute, storage, egress, worldwide data
hosting). A capacity model with a per-region resource estimate is a Phase 8 deliverable. The
product never claims free hosting in user-facing copy.

---

## R-05 — Feed licensing

**What actually goes wrong.** We ingest a GTFS feed, derive a graph and serve routes from it, and
the feed's licence did not permit that use or required attribution we did not give.

**Mitigation.** No feed is ingested until its licence, service dates, health, coverage and update
cadence are recorded in `transit_feeds`. Ingestion is blocked by a required licence field — there
is no "unknown" value. Attribution is rendered from feed metadata rather than hard-coded. The
Mobility Database catalog is a discovery aid; the authoritative licence is the agency's own terms.

**Status.** Mobility Database's own catalog terms were not readable in the 2026-08-19 fetch and
carry a blocking backlog item before Phase 3.

---

## R-06 — Time-zone arithmetic

**What actually goes wrong.** A trip crossing a DST boundary or a country border shows activity
times an hour off, and a user misses a train.

**Mitigation.** ADR-0007's three-way storage, one shared conversion helper, and a unit suite that
covers spring-forward, fall-back, southern-hemisphere DST, a zero-offset zone, a half-hour offset
zone, and a trip that crosses zones mid-day. Property-based tests assert that ordering is stable
under zone conversion.

---

## R-07 — Weather provider commercial terms

Covered by ADR-0020. Verified 2026-08-19: Open-Meteo's free tier excludes ad-supported,
subscription and commercial-product use. Decision required from the user before any commercial
launch. Mitigation is a provider port plus caching; the product degrades cleanly without weather.

---

## R-08 — OTP build ergonomics

**What actually goes wrong.** A 20-minute graph build lands in the inner development loop and
Phase 3 velocity collapses.

**Mitigation.** Graph artifacts are built once and cached as a mounted volume, using OTP's
`--build --save` then `--load --serve` split, verified in the 2026-08-19 documentation check.
The OSM extract is trimmed to the Klang Valley by bounding box, the same approach OTP's own tutorial
recommends for Portland, rather than loading all of Peninsular Malaysia. Build is a documented script, not a manual ritual,
and the built graph is reused across container restarts.

---

## R-09 — Prompt injection

**What actually goes wrong.** A place description from OSM, or a note written by a collaborator,
contains instructions the model follows — exfiltrating trip data or corrupting a plan.

**Mitigation.** `architecture/THREAT-MODEL.md` §5. Provider text, notes, filenames and web content
are inserted as clearly delimited untrusted data, never in the instruction channel. The model has
a small explicit set of typed tools; each tool re-validates input and re-checks authorization
server-side, so a compromised model cannot reach another user's trip. Secrets are redacted and
personal data minimised before every model call.

---

## R-10 — Scope

**What actually goes wrong.** The specification is genuinely large. The failure mode is not
stopping, it is quietly shipping a phase with skipped tests and calling it done.

**Mitigation.** The phase completion definition in the master prompt is treated as binding, and
`REQUIREMENTS.md` traces every requirement to a phase and a verification method so a silent drop
is visible. Phases stop for approval. Deferrals are written down in `PRD.md` §Non-MVP, never
absorbed silently.

---

## R-11 — Local model quality

**Mitigation.** The pipeline is designed to be useful even with a mediocre model: candidate
generation is a small structured task, and correctness comes from resolution, routing and
constraint validation. The repair loop returns only minimal structured failures, which small models
handle better than open-ended rewriting. If a model cannot produce a valid candidate set in two
attempts, the product fails safely with a useful message rather than degrading quietly.

---

## R-12 — Accessibility of the floating UI

**What actually goes wrong.** A design language built on floating islands, peek sheets and a map
canvas fails keyboard navigation, focus management and screen-reader use — and it is discovered in
Phase 8 when it is expensive.

**Mitigation.** ADR-0018a makes the semantic list a first-class requirement rather than a fallback.
axe-core runs in CI from Phase 1, on the shell itself, before there is much to fix. Every phase
gate includes an accessibility check on that phase's flows. Focus management for dock, sheets and
command palette is specified in `ux/INTERACTION-MODEL.md`, not improvised.

---

## R-13 — Offline expectations

**Mitigation.** ADR-0017 and ADR-0012. Offline map tiles are stated as out of scope in the UI, and
the tile policy verified 2026-08-19 makes prefetching against a public service a compliance
violation rather than merely a large download.

---

## R-14 — Docker absent on the host

**Status:** Confirmed present risk, not hypothetical. The 2026-08-19 toolchain probe found no
Docker, no pnpm, no Java and no psql on this machine; only Node v24.18.0.

**Impact.** Phase 1 cannot bring up Postgres/PostGIS, and Phase 3 cannot run OTP.

**Mitigation.** Docker Desktop installation is a user action listed as a Phase 1 prerequisite in
`PROJECT_STATUS.md`. pnpm can be enabled via `corepack`. Java is not required on the host because
OTP runs from its container image.

---

## R-15 — Stale realtime presented as live

**What actually goes wrong.** A GTFS-Realtime feed stops updating. The last successful response is
still cached. The UI keeps showing a live badge, and a user trusts a departure time that is hours
old.

**Mitigation.** Status is derived, never stored as a static label. `REALTIME` requires a
successful realtime fetch within a per-feed freshness window; past that window the same data is
presented as `STALE` with its `retrieved_at` shown. Feed health is monitored and surfaced in the
trip's data-source status screen. A test freezes time forward past the window and asserts the badge
transitions without any new data arriving.

---

## R-16 — Collaborative overwrite

**Mitigation.** ADR-0019 optimistic concurrency, with conflicts surfaced as a diff. The offline
reconcile path reuses the same version fields rather than introducing a second, weaker mechanism.

---

## R-17 — The pilot region's feed licence could not be verified

**Status:** Confirmed open, not hypothetical. On 2026-08-19, `data.gov.my/terms`,
`data.gov.my/terms-of-use` and `developer.data.gov.my/terms-of-use` all returned **HTTP 404** to
automated fetches. The portal describes itself as Malaysia's official open data portal under a
"Public Sector Open Data" framework, but no licence text was retrievable.

**What actually goes wrong.** We build the pilot on four feeds, ship, and discover the terms did not
permit the derivative use a routing graph represents — or required attribution we never rendered.

**Mitigation.** Enforced by the schema rather than by discipline: `transit_feeds.licence` is
`NOT NULL` with no "unknown" value, so the pilot feeds are **structurally un-ingestible** until a
human confirms the licence. Attribution renders from feed metadata, so it cannot drift from the data
it describes. Tracked as X-01 and listed as a blocking prerequisite in the Phase 1 backlog.

**Why it scores 20.** It is likely (three URLs already failed) and its impact is total — an
unlicensed pilot means no pilot. It needs a human with a browser, which is why it is surfaced as a
user-facing open item rather than an engineering task.

---

## R-18 — Silent failure to link inter-operator transfers

**What actually goes wrong.** The Klang Valley graph merges four feeds with independent stop IDs.
LRT ↔ KTM Komuter interchange depends on OSM walk paths between station entrances. If those paths
are missing or mis-tagged, OTP returns "no route" for journeys that are trivially possible in real
life.

**Why this is the nastiest failure mode in Phase 3.** It does not look like a bug. It looks like
data — the product honestly reports `UNAVAILABLE`, the user believes there is no connection, and
nobody investigates. Every other routing failure announces itself; this one hides inside a correct-
looking answer.

**Mitigation.** A named Phase 3 acceptance criterion: an LRT ↔ KTM Komuter transfer must route
correctly. Graph builds smoke-test known origin-destination pairs as part of the build script, so a
graph that builds but cannot route is a **failed build**, not a deployable artifact. Stop-linking
quality is validated explicitly rather than assumed.

---

## R-19 — Structured model output is not guaranteed

**Status:** Verified 2026-08-19. Ollama's documentation offers no validation guarantee for the
`format` parameter, recommends grounding the schema in the prompt and setting temperature to 0, and
describes the feature as probabilistic. Ollama Cloud does not support it at all.

**What actually goes wrong.** The team treats `format` as a contract, skips defensive validation,
and malformed output reaches domain code.

**Mitigation.** ADR-0023. Zod validation at the boundary and the bounded repair loop are load-bearing
rather than defensive extras. Temperature 0 and in-prompt schema grounding are **required
configuration** (BR-AI9), recorded so nobody later "optimises" them away. `AI_INVALID_OUTPUT` is
treated as a normal operating case with its own tests, not an exceptional one.

---

## R-20 — Vehicle positions presented as predictions

**What actually goes wrong.** The pilot has a realtime feed. The obvious implementation reads
"realtime feed exists, therefore show live", and puts a live badge on data that contains no predicted
stop times. A traveller then trusts a departure time that was never predicted.

**Why it is easy to get wrong.** The feed genuinely is realtime — updated every 30 seconds. The gap
is not freshness but *content*: VehiclePosition carries position, bearing, speed, congestion and
occupancy, and excludes predicted stop times (verified against the GTFS-Realtime reference,
2026-08-19).

**Mitigation.** ADR-0022 makes feed capability a first-class data concept. `REALTIME` requires
`tripUpdates === true`. A Phase 3 test asserts no pilot route can return that status. Vehicle
positions ship as an explicitly labelled position-only map layer. This is the same class of error as
R-02 — confident wrongness — arriving through the infrastructure layer rather than through the model,
which is exactly why it needed its own control.
