# Phase 0 completion report

**Project:** TravelPlus Global AI Travel Planner
**Phase:** 0 — Discovery and specification
**Date:** 2026-08-19
**Status:** **Complete, awaiting approval.** Phase 1 not started.

---

## 1. Repository inspection

| Check | Finding |
| --- | --- |
| Directory | `C:\workspace\travelPlus` |
| Git repository | **No.** `git status` → `fatal: not a git repository` |
| Application code | **None.** Zero source files, no `package.json`, no lockfile, no `.env` |
| Existing agent instructions | None — no `CLAUDE.md`, `AGENTS.md` or equivalent |
| Pre-existing content | 23 markdown files from an earlier Phase 0 pass by this agent. No third-party or user-authored work |

Because there was no user work at risk, the earlier documents were **migrated by moving, not
deleting**, into the numbered `docs/phase-0/` layout this specification requires. No content was
lost; four documents were superseded by rewrites and are listed in §7.

### Host toolchain (probed 2026-08-19)

| Tool | Status | Needed for | Action |
| --- | --- | --- | --- |
| Node.js | ✅ v24.18.0 | web + worker | Pin via `.nvmrc` in Phase 1 |
| pnpm | ❌ absent | workspace | `corepack enable pnpm` |
| **Docker** | ❌ **absent** | PostGIS, OTP, Ollama | **Blocks all of Phase 1 — user action** |
| Java JDK | ❌ absent | — | **Not needed**; OTP runs from its container image |
| psql | ❌ absent | manual inspection | Optional; DBeaver covers it |

---

## 2. Deliverables

31 documents under `docs/phase-0/`, plus 3 living documents at `docs/`, plus the repository README.

| Required deliverable | Document | State |
| --- | --- | --- |
| Product vision and objectives | `01-PRODUCT-VISION.md` | ✅ |
| Complete functional requirements | `02-FUNCTIONAL-REQUIREMENTS.md` — FR-1…FR-12 | ✅ |
| MVP / post-MVP / excluded scope | `03-SCOPE.md` | ✅ |
| Personas and user journeys | `04-PERSONAS-AND-JOURNEYS.md` | ✅ |
| Roles and permissions | `05-ROLES-AND-PERMISSIONS.md` | ✅ |
| Business and validation rules | `06-BUSINESS-RULES.md` | ✅ |
| Global transport-data coverage strategy | `07-COVERAGE-STRATEGY.md` | ✅ |
| Free/open provider matrix | `08-PROVIDER-MATRIX.md` | ✅ |
| Licensing, attribution, limits, fallback | `08-PROVIDER-MATRIX.md` §1 col 5, §2–6 | ✅ |
| Pilot region proposal | `09-PILOT-REGION.md` | ✅ |
| System architecture | `10-ARCHITECTURE.md` | ✅ |
| Module boundaries | `11-MODULE-BOUNDARIES.md` | ✅ |
| AI generation and verification workflow | `12-AI-PLANNING-WORKFLOW.md` | ✅ |
| OTP / GTFS / GTFS-RT integration design | `13-ROUTING-INTEGRATION.md` | ✅ |
| Database ERD and data dictionary | `14-DATA-MODEL.md` — 48 tables | ✅ |
| PostgreSQL/PostGIS and RLS strategy | `15-DATABASE-STRATEGY.md` | ✅ |
| API contracts and normalized routing schemas | `16-API-CONTRACTS.md`, `17-ERROR-CODES.md` | ✅ |
| Security threat model | `18-THREAT-MODEL.md` | ✅ |
| Privacy and data-retention design | `19-PRIVACY-AND-RETENTION.md` | ✅ |
| Screen inventory (desktop/tablet/mobile) | `20-SCREEN-INVENTORY.md` | ✅ |
| Low-fidelity wireframes | `21-WIREFRAMES.md` | ✅ |
| Living Journey Canvas interaction spec | `22-INTERACTION-SPEC.md`, `23-DESIGN-DIRECTION.md` | ✅ |
| Accessibility requirements | `24-ACCESSIBILITY.md` | ✅ |
| Testing strategy | `25-TESTING-STRATEGY.md` | ✅ |
| Deployment and local Docker architecture | `26-DEPLOYMENT-AND-DOCKER.md`, `27-OBSERVABILITY.md` | ✅ |
| Risks, assumptions, decisions | `../RISKS.md`, `../DECISIONS.md` | ✅ |
| Requirements traceability matrix | `28-TRACEABILITY-MATRIX.md` | ✅ |
| Phase 1 backlog with acceptance criteria | `29-PHASE-1-BACKLOG.md` | ✅ |
| Phase 0 completion report | this document | ✅ |
| `docs/phase-0/README.md` | ✅ | |
| `docs/PROJECT_STATUS.md`, `DECISIONS.md`, `RISKS.md` | ✅ | |

**No application code created. No dependencies installed. No git repository initialised. Nothing
committed.**

---

## 3. External verification performed

Every claim below was obtained by fetching the provider's own documentation on **2026-08-19**.

| Source | Outcome |
| --- | --- |
| Nominatim usage policy | ✅ 1 req/s; identifying User-Agent required; caching required; **autocomplete explicitly prohibited** |
| OSM Foundation tile policy | ✅ Prefetching prohibited; **offline use not permitted**; attribution must not be hidden |
| OpenFreeMap | ✅ No key, no stated limits, commercial use permitted; attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" |
| OpenTripPlanner docs + tutorial + container | ✅ v2.8.1, Java 25, port 8080, `opentripplanner/opentripplanner`, `/var/opentripplanner/`, GTFS filename must contain `gtfs` |
| Open-Meteo terms | ✅ <10k/day, 5k/hour, 600/min; CC-BY 4.0; **commercial use excluded** |
| **data.gov.my GTFS static** | ✅ Prasarana `rapid-rail-kl` / `rapid-bus-kl` / `rapid-bus-mrtfeeder` + KTMB; **no API key** |
| **data.gov.my GTFS-Realtime** | ✅ 30-second cadence, no key, **VehiclePosition only**; TripUpdates "in our pipeline for 2026" |
| **GTFS-Realtime reference** | ✅ TripUpdate carries predicted stop times; **VehiclePosition excludes them** |
| Wikimedia API etiquette | ✅ Descriptive User-Agent mandatory; **requests must be serial, not parallel**; cache locally |
| Ollama structured outputs | ✅ `format` parameter; **no validation guarantee**; temperature 0 and in-prompt schema recommended |
| TriMet developer site | ⚠️ Feeds and URLs confirmed; **licence text not on the page** |
| Mobility Database | ⚠️ 6000+ feeds, 99+ countries; **catalog terms not on the page** |
| **data.gov.my terms** | ❌ **HTTP 404 on three URLs** |
| HSL / Digitransit | ❌ HTTP 403 — moot, since Helsinki is no longer proposed |

---

## 4. Pilot region: Kuala Lumpur / Klang Valley

**Selected.** The instruction was to consider KL first and select it only if the required data is
legally and technically available, so it was tested rather than assumed.

**Data sources**

| Feed | URL | Key | Modes |
| --- | --- | --- | --- |
| Prasarana rail | `api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl` | none | LRT, MRT, Monorail |
| Prasarana bus | `.../prasarana?category=rapid-bus-kl` | none | Bus, BRT |
| Prasarana MRT feeder | `.../prasarana?category=rapid-bus-mrtfeeder` | none | Feeder bus |
| KTMB | `api.data.gov.my/gtfs-static/ktmb` | none | Commuter rail |
| Realtime | `api.data.gov.my/gtfs-realtime/vehicle-position/<agency>` | none | **positions only** |
| Street network | OSM extract, Klang Valley bbox | none | walking, cycling, driving |

**Why KL over Portland:** richer multimodality, genuine multi-operator transfers, no key required
even for realtime, Malay-language i18n pressure, and direct relevance to the stated market. Portland
wins only on OTP tutorial familiarity — a first-week convenience.

**The one thing KL cannot do.** Malaysia publishes VehiclePosition only, and VehiclePosition
contains no predicted stop times. **The pilot therefore ships at coverage tier T2 (scheduled), not
T3 (live).** This produced ADR-0022: feed capability is now a first-class data concept, `REALTIME`
requires `tripUpdates === true`, and a Phase 3 test asserts no KL route can return that status.
Vehicle positions still ship as an explicitly labelled position-only map layer.

**Portland is retained** as a narrow engineering asset — it publishes all three GTFS-RT feed types,
so it is where the `SCHEDULED → REALTIME → STALE` code paths get validated honestly in Phase 6. It
is not user-facing and not a market.

When Malaysian TripUpdates ship, KL is promoted T2 → T3 by a **configuration change with no
product-code change**.

---

## 5. Unresolved risks and assumptions

### Blocking — needs a human

| ID | Item | Blocks |
| --- | --- | --- |
| **X-01** | **data.gov.my licence and attribution unverified** — three URLs returned 404. `transit_feeds.licence` is `NOT NULL`, so the pilot feeds are structurally un-ingestible until confirmed | Phase 3 |
| **X-00** | Docker Desktop absent on this host | All of Phase 1 |
| **X-06** | `git init` and commits not authorised | Phase 1 version control |
| **X-07** | Phase 0 approval | Phase 1 start |
| **X-09** | Commercial intent unconfirmed — Open-Meteo's free tier excludes commercial products | Launch |

### Engineering verification tasks

X-02 TriMet terms · X-03 Mobility Database terms · X-04 IANA package licence · X-05 Klang Valley OSM
extract source and bbox · X-10 whether Prasarana feeds populate `wheelchair_boarding`.

### Top risks (full register in `../RISKS.md`)

| ID | Risk | Score |
| --- | --- | --- |
| R-01 | Coverage is far narrower than "global" implies | 25 |
| R-17 | Pilot feed licence unverified | 20 |
| R-10 | Large scope; quality traded for pace | 16 |
| R-18 | Multi-feed graph silently fails inter-operator transfers | 16 |
| R-02 | AI fabricates transport facts | 15 |
| R-14 | Docker absent | 15 |
| R-15 | Stale realtime shown as live | 15 |
| R-20 | Vehicle positions mistaken for predictions | 15 |

### Assumptions made without blocking

Modular monolith over microservices; OTP GTFS-GraphQL over legacy REST; four KL feeds merged into a
single graph; submit-triggered search with local recents; UUIDv7 identifiers; pg-boss over a separate
broker. All recorded in `../DECISIONS.md`.

---

## 6. Internal consistency verification

Phase 0 produces documents, so verification is evidence and consistency checking, not test execution.

| Check | Method | Result |
| --- | --- | --- |
| Cross-document links resolve | Scripted walk of every relative `.md` link | **0 broken** |
| Required tables modelled | Cross-check against the master prompt | **48/48** |
| Required endpoints contracted | Cross-check against the master prompt | **17/17** |
| Required screens inventoried | Cross-check against the master prompt | **22/22** |
| Requirements traced to phase + verification | Matrix completeness | **166/166** |
| Pilot decision matches evidence | Manual re-read against fetched sources | Consistent |
| Superseded decisions marked | ADR-0014 status check | Marked, with reason |
| No stale region references | Scripted grep for Portland/Helsinki | All remaining uses intentional |
| No code or dependencies created | File-type scan | **Documents only** |
| No secrets committed | Content scan | Clean |

---

## 7. Documents superseded during this phase

| Superseded | Replaced by | Why |
| --- | --- | --- |
| `architecture/SAMPLE-REGION.md` | `09-PILOT-REGION.md` | Portland → Kuala Lumpur on new evidence |
| `architecture/PROVIDER-MATRIX.md` | `08-PROVIDER-MATRIX.md` | Five new verified rows; fallback column added |
| `product/PRD.md` | `01`, `02`, `03` | Split into vision, requirements and scope |
| `product/BACKLOG.md` | `29-PHASE-1-BACKLOG.md` | Refocused on Phase 1 with acceptance criteria |
| ADR-0014 (Portland pilot) | ADR-0021 | Superseded, retained with reason |

---

## 8. Recommended Phase 1 implementation order

```
1. P1-01  workspace + import-boundary lint   3d
2. P1-02  PostGIS container                  2d
3. P1-03  schema + migrations                3d
4. P1-06  RLS roles + policies               3d   ← before auth, deliberately
5. P1-04  auth + sessions + reset            5d
6. P1-05  preferences + privacy defaults     2d
7. P1-08  config + health + logging          2d
8. P1-07  tokens + shell + dock              4d   ← last, deliberately
                                            ────
                                             24d
```

Two orderings are deliberate. **RLS before auth**, so no repository is ever written against an
unprotected database — the intuitive order leaves a window in which bad habits form. **Shell last**,
so the axe-core and keyboard gates run against real auth and real data rather than a placeholder.

---

## 9. Phase 0 exit statement

All required deliverables are produced. All external technical assumptions that could be verified
were verified against official documentation, and every one that could not is marked, scored as a
risk, and assigned a blocking task. The pilot region was selected on evidence, including an honest
statement of the one capability it cannot deliver today.

**Phase 1 has not started. No code exists. Nothing is committed. Awaiting approval.**
