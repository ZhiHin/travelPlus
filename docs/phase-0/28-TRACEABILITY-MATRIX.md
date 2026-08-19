# Requirement traceability matrix

**Status:** Phase 0 · 2026-08-19 · **166 requirements** (133 from the master prompt + 33 Phase-0 deliverables)

Every requirement in the master development prompt is listed here with a phase, a design document
and a verification method. Nothing was dropped. Where something is deferred, the deferral is
explicit and appears in `03-SCOPE.md` §3 — never absorbed silently.

Verification methods: **U** unit · **I** integration · **C** contract · **E** end-to-end ·
**A** accessibility · **V** visual regression · **P** property-based · **M** manual audit ·
**S** static/CI check.

---

## Truth and feasibility — the eleven non-negotiable rules

These override everything else. Each maps to the correspondingly numbered rule in the prompt.

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| TRUTH-01 | Provider-based regional architecture; no assumption of one global provider | 3 | ADR-0002, coverage model | I, M |
| TRUTH-02 | Global means "any region with an installed pack", not every city | 2 | 07-COVERAGE-STRATEGY §1–2 | M |
| TRUTH-03 | OSM + GTFS/GTFS-RT + OTP for multimodal routing | 3 | ADR-0002 | I, C |
| TRUTH-04 | **LLM never invents transport steps, numbers, lines, platforms, fares, hours, times or delays** | 5 | ADR-0005 | U, E |
| TRUTH-05 | All transport facts carry provenance and retrieval time | 3 | ADR-0006, DATA-MODEL §4.5 | U, I |
| TRUTH-06 | Missing/stale/incomplete data stated clearly with fallbacks offered | 3 | ERROR-CODES, SCREEN-INVENTORY | E, V |
| TRUTH-07 | Realtime only when a realtime feed supplied it; else labelled scheduled | 6 | ADR-0006, ARCHITECTURE §7 | U, I |
| TRUTH-08 | Estimates never labelled as confirmed fares, platforms, hours or availability | 3 | 01-PRODUCT-VISION §6, 02-FR §FR-12 | U, V |
| TRUTH-09 | UTC storage with IANA zone retained for local display | 1 | ADR-0007 | U, P |
| TRUTH-10 | No flight search, hotel booking, ticketing, visa decisions or turn-by-turn in MVP | — | 03-SCOPE §3 | M |
| TRUTH-11 | "Free" means no billable key on the local path — not free production | 8 | 07-COVERAGE-STRATEGY §5 | M |

---

## Account and onboarding

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| AUTH-01 | Email/password with Argon2id, verified sessions, throttling, reset, CSRF | 1 | THREAT-MODEL §3 | I, E |
| AUTH-02 | OAuth adapters kept separate from the default path | later | DATA-MODEL §4.1 | S |
| AUTH-03 | Progressive onboarding, skippable and editable later | 1 | SCREEN-INVENTORY #5 | E |
| AUTH-04 | Locale, units, time format, currency, home zone, accessibility settings | 1 | DATA-MODEL §4.1 | I |
| AUTH-05 | Privacy controls for location, analytics, AI retention, shared trips | 1 | DATA-MODEL §4.1 | I |
| AUTH-06 | Account export and deletion workflow | 1 | DATA-MODEL §4.1 | E |

## Trip spaces

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| TRIP-01 | Create, duplicate, archive, restore, delete | 2 | API §3 | I, E |
| TRIP-02 | Title, cover, destinations, dates, travellers, status, notes, tags, visibility | 2 | DATA-MODEL §4.2 | I |
| TRIP-03 | Folder-like home: upcoming, planning, past, archived, shared | 2 | WIREFRAMES §5 | E, V |
| TRIP-04 | Nine sections without a permanent sidebar | 2 | ADR-0018 | E, A |
| TRIP-05 | Autosaved drafts with visible sync state | 2 | INTERACTION-MODEL | E |
| TRIP-06 | Versioned itinerary with compare and restore | 2 | API §6 | I, E |
| TRIP-07 | Trip preferences override profile defaults, with the winner explained | 2 | API §4 | U, E |

## Discovery and places

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| PLACE-01 | Search cities, addresses, stops, landmarks, food, shopping, culture, nature, saved | 2 | API §8 | I, E |
| PLACE-02 | Map-bounds search only where supported and policy-compliant | 2 | ADR-0011 | I |
| PLACE-03 | Filters: category, price hint, accessibility, indoor/outdoor, distance, open confidence | 2 | SCREEN-INVENTORY #9 | E |
| PLACE-04 | Place cards with source, coordinates, licensed imagery, hours confidence, visit duration | 2 | DATA-MODEL §4.4 | I, V |
| PLACE-05 | **No invented reviews, popularity, prices, phone numbers or opening hours** | 2 | DATA-MODEL §4.4 (no such columns exist) | S, U |
| PLACE-06 | Custom places; duplicate detection by source ID and spatial+name similarity | 2 | API §8 | U, I |

## AI planning

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| AI-01 | Trip-scoped conversation aware of trip, preferences, locks and prior versions | 5 | DATA-MODEL §4.6 | I, E |
| AI-02 | Guided creation plus free-form requests | 5 | SCREEN-INVENTORY #11 | E |
| AI-03 | Structured preview before destructive edits | 5 | API §7 | E |
| AI-04 | Accept all, accept selected, edit, or reject | 5 | WIREFRAMES §4 | E |
| AI-05 | Streamed progress without exposing chain-of-thought | 5 | INTERACTION-MODEL §5 | E, M |
| AI-06 | Show sources checked and constraints not satisfied | 5 | API §7 | I, E |
| AI-07 | **Never claim a source was checked unless the application called it** | 5 | projected from `ai_tool_events` | U, I |
| AI-08 | Ten-stage pipeline with the eight named schemas | 5 | ARCHITECTURE §5 | U, I |
| AI-09 | Validate every response; one structured retry; never regex model prose | 5 | ADR-0013 | U, S |

## Itinerary editor

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| ITIN-01 | Timeline with time, duration, place, notes, cost status, booking state, travel leg | 4 | WIREFRAMES §1 | E, V |
| ITIN-02 | Drag/reorder within and across days | 4 | INTERACTION-MODEL §3 | E |
| ITIN-03 | **Keyboard-accessible reorder of equal power** | 4 | WIREFRAMES §9 | A, E |
| ITIN-04 | Lock time, place, or whole item | 4 | DATA-MODEL §4.3 | U, I |
| ITIN-05 | Eight block types | 4 | DATA-MODEL §4.3 | I |
| ITIN-06 | Detect all 13 conflict classes | 4 | ERROR-CODES | U |
| ITIN-07 | Recalculate only impacted legs | 4 | ARCHITECTURE §6 | U, I |
| ITIN-08 | Undo/redo, version snapshots, list/timeline/map-story modes | 4 | API §6 | E |

## Directions and public transport

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| ROUTE-01 | Origin/destination by coordinates or provider ID | 3 | API §8 | I |
| ROUTE-02 | Depart-at / arrive-by in the correct local zone | 3 | ADR-0007 | U, I |
| ROUTE-03 | Walking, cycling, driving, transit, mixed where the graph supports them | 3 | ADR-0002 | I, C |
| ROUTE-04 | Preferences: max walk, transfers, accessibility, bicycle, time/cost trade-off | 3 | API §8 | I |
| ROUTE-05 | Multiple comparable alternatives | 3 | SCREEN-INVENTORY #16 | I, E |
| ROUTE-06 | Full normalized schema — all 12 required field groups | 3 | ARCHITECTURE §4 | U, C |
| ROUTE-07 | Six explicit status values | 3 | 01-PRODUCT-VISION §6, 02-FR §FR-12 | U |
| ROUTE-08 | **Render only fields the response contained; omit rather than fill** | 3 | ARCHITECTURE §4 (optional fields) | U, V |

## Live trip mode

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| LIVE-01 | Today view with next activity and next verified leg | 6 | WIREFRAMES §7 | E |
| LIVE-02 | Scheduled vs live badge with refresh state and last-updated time | 6 | INTERACTION-MODEL §6 | U, E |
| LIVE-03 | Delay and service-alert display where feeds exist | 6 | DATA-MODEL §4.5 | I |
| LIVE-04 | One-tap external navigation deep link | 6 | WIREFRAMES §7 | E |
| LIVE-05 | Mark done, skip, running late, replan remaining day | 6 | 29-PHASE-1-BACKLOG §4 | E |
| LIVE-06 | Geolocation only after explicit action; never continuous | 6 | THREAT-MODEL §6 | M, E |

## Saved items, bookings, notes

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| SAVE-01 | Saved places in collections and tags | 2 | DATA-MODEL §4.4 | I |
| SAVE-02 | Booking records across eight kinds with manual detail | 7 | DATA-MODEL §4.7 | I, E |
| SAVE-03 | **No payment-card data stored, ever** | 7 | DATA-MODEL §4.7 (no column exists) | S |
| SAVE-04 | No passport or identity-document images in MVP | 7 | 03-SCOPE §3 | S, M |
| SAVE-05 | Portable notes and checklists with sanitised rich text | 7 | THREAT-MODEL §3 | U, I |

## Budget

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| BUDGET-01 | Budget by category and currency | 7 | DATA-MODEL §4.7 | I |
| BUDGET-02 | Planned vs actual | 7 | API §9 | I |
| BUDGET-03 | Splits between travellers | 7 | ADR-0008 | **P**, U |
| BUDGET-04 | Manual exchange rate with date and source; never implied live | 7 | ADR-0008 | U, V |
| BUDGET-05 | Cost warning when edits exceed budget — warning, not rejection | 7 | ERROR-CODES | U, E |

## Sharing and collaboration

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| SHARE-01 | Invite by exact email with owner/editor/viewer roles | 7 | API §9 | I, E |
| SHARE-02 | Membership and authorization resolved server-side | 7 | RLS-POLICY | **I (authz suite)** |
| SHARE-03 | Comments, suggestions, activity log, voting | 7 | DATA-MODEL §4.8 | I |
| SHARE-04 | Share links read-only, revocable, unguessable, excluding private bookings | 7 | RLS-POLICY §4 | I, E |

## Offline and resilience

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| OFF-01 | Installable PWA | 6 | ADR-0017 | E |
| OFF-02 | Cache app shell and a selected trip summary | 6 | ADR-0017 | E |
| OFF-03 | Cache itinerary, route instructions, coordinates with expiry markers | 6 | ADR-0017 | E |
| OFF-04 | Offline state obvious; safe edits queued and reconciled | 6 | WIREFRAMES §8 | E |
| OFF-05 | **No token caching; no tile prefetch from a public provider** | 6 | ADR-0012 | **S**, M |

## Database

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| DATA-01 | All 48 required tables modelled | 1–7 | DATA-MODEL | S |
| DATA-02 | UUIDv7 consistently | 1 | ADR-0015 | S |
| DATA-03 | `timestamptz` for instants; local date/time + zone where needed | 1 | ADR-0007 | S, U |
| DATA-04 | `numeric` for money; ISO 4217 codes | 1 | ADR-0008 | S, P |
| DATA-05 | PostGIS geography types with GiST indexes | 1 | DATA-MODEL §5 | S, I |
| DATA-06 | Uniqueness, FKs, checks and deletion behaviour explicit | 1 | DATA-MODEL | S, I |
| DATA-07 | Optimistic concurrency on collaborative records | 4 | ADR-0019 | I |
| DATA-08 | Seed data marked development-only, never presented as live | 1 | LOCAL-DEV-PLAN §6 | S, V |

## API

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| API-01 | All 17 required endpoints, versioned and typed | 2–7 | API-CONTRACTS | C |
| API-02 | Thin handlers calling application services | 1 | ARCHITECTURE §2 | S (lint boundary) |
| API-03 | Idempotency keys on the five retry-prone writes | 5 | ADR-0016 | I |
| API-04 | Cursor pagination | 2 | API §1 | I |
| API-05 | Stable machine-readable error codes plus safe messages | 1 | ERROR-CODES | U, C |
| API-06 | No stack traces or provider secrets leaked | 1 | THREAT-MODEL §3 | S, I |

## UI and UX

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| UX-01 | No permanent sidebar; pill, dock, islands, ribbon, peek sheets | 1 | ADR-0018 | V, A |
| UX-02 | All six signature interactions | 4 | INTERACTION-MODEL §2–3 | E, V |
| UX-03 | Never hijack scrolling; no hover-only essential information | 1 | INTERACTION-MODEL | A, M |
| UX-04 | Honour `prefers-reduced-motion` with instant transitions | 1 | DESIGN-DIRECTION §6 | **V** |
| UX-05 | Designed light and dark themes, not mechanical inversion | 1 | DESIGN-DIRECTION §2 | V |
| UX-06 | Theme-aware standards-CSS scrollbar; never fully hidden | 1 | DESIGN-DIRECTION §7 | V, M |
| UX-07 | Desktop, tablet and mobile behaviours as specified | 1–4 | INTERACTION-MODEL §8 | V, E |
| UX-08 | All 22 screens with the full state matrix | 1–7 | SCREEN-INVENTORY | V, E |

## Accessibility

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| A11Y-01 | WCAG 2.2 AA on every core flow | all | ADR-0018a | **A** (CI, every phase) |
| A11Y-02 | Fully keyboard-accessible navigation, reorder, dialogs, map controls, focus | 1–4 | INTERACTION-MODEL §1 | A, E |
| A11Y-03 | **Map information also exists in a semantic list** | 3 | ADR-0018a | A, E |
| A11Y-04 | AI status and itinerary changes announced via live regions | 5 | INTERACTION-MODEL §5 | A |
| A11Y-05 | **Never rely on colour alone for transit status** | 3 | DESIGN-DIRECTION §4 | **V (greyscale)**, M |
| A11Y-06 | Text alternatives for destination imagery | 2 | SCREEN-INVENTORY | A |
| A11Y-07 | 200% zoom, text resizing, localized formats and pluralization | 1 | DESIGN-DIRECTION §3 | V, M |

## Security and privacy

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| SEC-01 | OWASP-aligned auth, sessions, access control, validation, SSRF, rate limiting | 1 | THREAT-MODEL | I, M |
| SEC-02 | Secure, httpOnly, SameSite cookies with environment-appropriate Secure | 1 | THREAT-MODEL §3 | I |
| SEC-03 | CSRF defence plus origin validation | 1 | THREAT-MODEL §3 | I |
| SEC-04 | **Server-side authorization on every trip resource; ID-changing attack fails** | 1 | RLS-POLICY §5 | **I (authz suite)** |
| SEC-05 | SSRF-safe allowlisted clients blocking private ranges and unsafe redirects | 2 | THREAT-MODEL §6 | U, I |
| SEC-06 | CSP compatible with map workers; sanitised rich text and provider HTML | 1 | THREAT-MODEL §7 | S, I |
| SEC-07 | Audit sensitive changes without logging secrets, tokens, precise locations or full prompts | 1 | OBSERVABILITY §2 | S, I |
| SEC-08 | AI receives only data required for the current plan; minimised and redacted | 5 | THREAT-MODEL §5 | U, I |
| SEC-09 | Prompt-injection defences: channel separation, typed tools, re-authorization | 5 | THREAT-MODEL §5 | **I (injection suite)** |

## Reliability and performance

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| PERF-01 | Usable on a mid-range mobile and constrained network | 8 | 01-PRODUCT-VISION §4 | M |
| PERF-02 | Lazy-load map and heavy planning modules | 4 | 01-PRODUCT-VISION §4 | S, M |
| PERF-03 | No layout shift: stable skeletons and image dimensions | 1 | SCREEN-INVENTORY | V |
| PERF-04 | Cluster markers, virtualize long lists where measured | 4 | 01-PRODUCT-VISION §4 | M |
| PERF-05 | Cache per freshness semantics and provider rules; honest SWR | 2 | PROVIDER-MATRIX §6 | I |
| PERF-06 | **Circuit breakers distinguish outage from "no route found"** | 3 | ADR-0010 | U, I |
| PERF-07 | Health checks for web, worker, database, OTP graph and AI | 1 | OBSERVABILITY §5 | I |

## Testing and delivery

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| TEST-01 | Unit tests: time zones, buffers, constraints, normalization, money, permissions, AI schemas | all | 25-TESTING-STRATEGY | U |
| TEST-02 | Property-based tests for ordering, overlap and currency totals | 4, 7 | 25-TESTING-STRATEGY | P |
| TEST-03 | Integration tests against real PostgreSQL/PostGIS | 1 | LOCAL-DEV-PLAN §9 | I |
| TEST-04 | OTP contract tests from captured, licence-safe fixtures | 3 | 13-ROUTING-INTEGRATION §9 | C |
| TEST-05 | Provider contract tests covering failure, timeout, empty, malformed, stale, rate-limited | 2–3 | 25-TESTING-STRATEGY | C |
| TEST-06 | **AI tests deterministic; CI needs no local model and no paid API** | 5 | ADR-0013 | S, U |
| TEST-07 | E2E across create → prefs → propose → apply → edit → transit → share → offline | 2–7 | 25-TESTING-STRATEGY | E |
| TEST-08 | Visual regression: desktop/mobile, light/dark, long translations, empty states, reduced motion | 1 | 25-TESTING-STRATEGY | V |

---

## Coverage check

| Prompt section | Requirements | Gaps |
| --- | --- | --- |
| Non-negotiable truth rules (11) | TRUTH-01…11 | none |
| Functional scope §1–11 | AUTH, TRIP, PLACE, AI, ITIN, ROUTE, LIVE, SAVE, BUDGET, SHARE, OFF | none |
| AI itinerary engine | AI-08, AI-09, SEC-08, SEC-09 | none |
| Database requirements | DATA-01…08 | none |
| API and server contract | API-01…06 | none |
| UI/UX direction | UX-01…08 | none |
| Accessibility | A11Y-01…07 | none |
| Security and privacy | SEC-01…09 | none |
| Reliability and performance | PERF-01…07 | none |
| Testing | TEST-01…08 | none |
| Screen inventory (22) | UX-08 → 20-SCREEN-INVENTORY | none |
| Delivery phases and gates | 29-PHASE-1-BACKLOG, ../PROJECT_STATUS.md | none |

**Deferred, explicitly and with reasons:** flights, hotels, ticketing, visa decisions, turn-by-turn,
offline tiles, autocomplete, live FX rates, third-party reviews. All listed in `03-SCOPE.md` §3
with the reason and the nearest capability that does ship.

---

## Phase-0-specific requirements added by the current specification

The instruction set for this Phase 0 named deliverables beyond the master prompt's own list. Those
are traced here.

| ID | Requirement | Phase | Design | Verify |
| --- | --- | --- | --- | --- |
| P0-01 | Product vision and objectives documented | 0 | `01-PRODUCT-VISION.md` | M |
| P0-02 | Complete functional requirements enumerated with IDs | 0 | `02-FUNCTIONAL-REQUIREMENTS.md` — FR-1…FR-12 | M |
| P0-03 | MVP, post-MVP and excluded scope stated separately | 0 | `03-SCOPE.md` | M |
| P0-04 | Personas and user journeys | 0 | `04-PERSONAS-AND-JOURNEYS.md` | M |
| P0-05 | Roles and permissions matrix | 0 | `05-ROLES-AND-PERMISSIONS.md` | M, I |
| P0-06 | Business rules and validation rules, with enforcement points | 0 | `06-BUSINESS-RULES.md` — BR-T, BR-TR, BR-P, BR-I, BR-TZ, BR-M, BR-PL, BR-R, BR-AI | U, I |
| P0-07 | Global transport-data coverage strategy | 0 | `07-COVERAGE-STRATEGY.md` | M |
| P0-08 | Free/open provider matrix with licensing, attribution, limits **and fallback behaviour** | 0 | `08-PROVIDER-MATRIX.md` §1 col 5 | M |
| P0-09 | **Pilot region selected on verified evidence, KL considered first** | 0 | `09-PILOT-REGION.md` | M |
| P0-10 | System architecture | 0 | `10-ARCHITECTURE.md` | M |
| P0-11 | Module boundaries, each with a CI check | 0 | `11-MODULE-BOUNDARIES.md` §4 | S |
| P0-12 | AI generation **and verification** workflow | 0 | `12-AI-PLANNING-WORKFLOW.md` | U, I |
| P0-13 | OTP / GTFS / GTFS-RT integration design | 0 | `13-ROUTING-INTEGRATION.md` | C, I |
| P0-14 | ERD and data dictionary | 0 | `14-DATA-MODEL.md` — 48 tables | S |
| P0-15 | PostgreSQL/PostGIS and RLS strategy | 0 | `15-DATABASE-STRATEGY.md` | I |
| P0-16 | API contracts and normalized routing schemas | 0 | `16-API-CONTRACTS.md`, `10-ARCHITECTURE.md` §4 | C |
| P0-17 | Security threat model | 0 | `18-THREAT-MODEL.md` | M, I |
| P0-18 | Privacy and data-retention design | 0 | `19-PRIVACY-AND-RETENTION.md` | I |
| P0-19 | Desktop, tablet and mobile screen inventory | 0 | `20-SCREEN-INVENTORY.md` | M |
| P0-20 | Low-fidelity wireframes | 0 | `21-WIREFRAMES.md` | M |
| P0-21 | "Living Journey Canvas" interaction specification | 0 | `22-INTERACTION-SPEC.md` | M, E |
| P0-22 | Accessibility requirements | 0 | `24-ACCESSIBILITY.md` | A |
| P0-23 | Testing strategy | 0 | `25-TESTING-STRATEGY.md` | M |
| P0-24 | Deployment and local Docker architecture | 0 | `26-DEPLOYMENT-AND-DOCKER.md` | M |
| P0-25 | Risks, assumptions and architecture decisions | 0 | `../RISKS.md`, `../DECISIONS.md` | M |
| P0-26 | Phase 1 backlog with acceptance criteria | 0 | `29-PHASE-1-BACKLOG.md` | M |
| P0-27 | Requirements traceability matrix | 0 | this document | S |
| P0-28 | Phase 0 completion report | 0 | `00-COMPLETION-REPORT.md` | M |
| P0-29 | External technical assumptions verified against official docs | 0 | `08-PROVIDER-MATRIX.md` check dates | M |
| P0-30 | **No assumption of complete worldwide free transit coverage** | 0 | `07-COVERAGE-STRATEGY.md` §1–2, TRUTH-01/02 | M |
| P0-31 | Default local path needs no paid API key | 0 | `08-PROVIDER-MATRIX.md` §1, `26-DEPLOYMENT-AND-DOCKER.md` | M |
| P0-32 | **AI cannot generate unverified transport facts** | 0 | ADR-0005, `12-AI-PLANNING-WORKFLOW.md` §2, BR-T1/T2 | U, E |
| P0-33 | UI without a permanent left sidebar; dock, ribbon, sheets, motion, scroll, hover, mobile, scrollbar | 0 | ADR-0018, `22-INTERACTION-SPEC.md`, `23-DESIGN-DIRECTION.md` | V, A |

**Totals: 133 master-prompt requirements + 33 Phase-0 deliverable requirements = 166 traced.**
