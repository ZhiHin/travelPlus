# Phase 0 — Discovery and specification

**TravelPlus Global AI Travel Planner** · completed 2026-08-19 · **awaiting approval**

Phase 0 produces specification only. Per the master prompt's working rule 4, no application code,
no dependencies and no scaffolding were created. The repository contains documents and nothing else.

**Start here:** [`00-COMPLETION-REPORT.md`](00-COMPLETION-REPORT.md)

---

## The rule that shapes every document below

The language model never authors a transport fact. It proposes candidate activities. Routes, times,
stop names, route numbers, fares, platforms, delays and opening hours come from a provider response,
carry provenance and a retrieval time, and are labelled with one of `REALTIME` / `SCHEDULED` /
`ESTIMATED` / `MANUAL` / `STALE` / `UNAVAILABLE`.

Where data is missing, the product says so. It does not fill the gap with plausible text.

---

## Reading order

### Orientation
| Doc | What it answers |
| --- | --- |
| [00-COMPLETION-REPORT](00-COMPLETION-REPORT.md) | What was done, what was verified, what is unresolved |
| [01-PRODUCT-VISION](01-PRODUCT-VISION.md) | Why this exists and what success looks like |

### Product
| Doc | What it answers |
| --- | --- |
| [02-FUNCTIONAL-REQUIREMENTS](02-FUNCTIONAL-REQUIREMENTS.md) | Everything the product must do — FR-1…FR-12 |
| [03-SCOPE](03-SCOPE.md) | MVP, post-MVP, excluded, and never |
| [04-PERSONAS-AND-JOURNEYS](04-PERSONAS-AND-JOURNEYS.md) | Who this is for and the seven critical journeys |
| [05-ROLES-AND-PERMISSIONS](05-ROLES-AND-PERMISSIONS.md) | Who may do what, and where it is enforced |
| [06-BUSINESS-RULES](06-BUSINESS-RULES.md) | Business and validation rules, with enforcement points |

### Data availability — read before believing any coverage claim
| Doc | What it answers |
| --- | --- |
| [07-COVERAGE-STRATEGY](07-COVERAGE-STRATEGY.md) | What "global" means here; the four coverage tiers; the honest cost statement |
| [08-PROVIDER-MATRIX](08-PROVIDER-MATRIX.md) | Every provider: licence, limits, attribution, **fallback**, check date |
| [09-PILOT-REGION](09-PILOT-REGION.md) | **Kuala Lumpur selected, with the evidence and the one thing it cannot do** |

### Engineering
| Doc | What it answers |
| --- | --- |
| [10-ARCHITECTURE](10-ARCHITECTURE.md) | System shape and sequence diagrams |
| [11-MODULE-BOUNDARIES](11-MODULE-BOUNDARIES.md) | Package contracts, each with a CI check |
| [12-AI-PLANNING-WORKFLOW](12-AI-PLANNING-WORKFLOW.md) | The ten-stage generate-and-verify pipeline |
| [13-ROUTING-INTEGRATION](13-ROUTING-INTEGRATION.md) | OTP, GTFS and GTFS-Realtime design |
| [14-DATA-MODEL](14-DATA-MODEL.md) | ERD and data dictionary — 48 tables |
| [15-DATABASE-STRATEGY](15-DATABASE-STRATEGY.md) | PostgreSQL, PostGIS and row-level security |
| [16-API-CONTRACTS](16-API-CONTRACTS.md) | Versioned HTTP contracts and normalized routing schemas |
| [17-ERROR-CODES](17-ERROR-CODES.md) | Stable error taxonomy |

### Security and privacy
| Doc | What it answers |
| --- | --- |
| [18-THREAT-MODEL](18-THREAT-MODEL.md) | STRIDE, prompt injection, SSRF, CSP |
| [19-PRIVACY-AND-RETENTION](19-PRIVACY-AND-RETENTION.md) | Classification, defaults, retention schedule, deletion cascade |

### Experience
| Doc | What it answers |
| --- | --- |
| [20-SCREEN-INVENTORY](20-SCREEN-INVENTORY.md) | Every screen and its full state matrix |
| [21-WIREFRAMES](21-WIREFRAMES.md) | Low-fidelity desktop and mobile layouts |
| [22-INTERACTION-SPEC](22-INTERACTION-SPEC.md) | The Living Journey Canvas interaction model |
| [23-DESIGN-DIRECTION](23-DESIGN-DIRECTION.md) | Visual language — palette, type, the stroke grammar |
| [24-ACCESSIBILITY](24-ACCESSIBILITY.md) | WCAG 2.2 AA requirements and verification |

### Delivery
| Doc | What it answers |
| --- | --- |
| [25-TESTING-STRATEGY](25-TESTING-STRATEGY.md) | Risk-based strategy and the adversarial suites |
| [26-DEPLOYMENT-AND-DOCKER](26-DEPLOYMENT-AND-DOCKER.md) | Local stack, Compose services, CI |
| [27-OBSERVABILITY](27-OBSERVABILITY.md) | Logging, tracing, health, SLOs, alerts |
| [28-TRACEABILITY-MATRIX](28-TRACEABILITY-MATRIX.md) | All 166 requirements → phase → document → test |
| [29-PHASE-1-BACKLOG](29-PHASE-1-BACKLOG.md) | Phase 1 stories, acceptance criteria, implementation order |

### Living documents (outside this directory, updated every phase)
- [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) — phase state and gates
- [`../DECISIONS.md`](../DECISIONS.md) — 23 architecture decision records
- [`../RISKS.md`](../RISKS.md) — 20 risks with triggers and mitigations

---

## The four findings that changed the design

Everything here was verified by fetching official documentation on 2026-08-19, not recalled.

1. **Nominatim explicitly prohibits client-side autocomplete** and caps at 1 request/second.
   → No autocomplete anywhere in the product; the limiter is database-backed so it holds across
   processes.
2. **The OSM tile policy forbids prefetching; offline use is not permitted.**
   → The PWA never caches tiles; offline maps are out of scope and stated as such.
3. **Malaysia publishes GTFS-Realtime VehiclePosition only** — and VehiclePosition contains no
   predicted stop times.
   → The pilot ships at *scheduled* confidence, feed capability became a first-class concept, and
   `REALTIME` is unreachable in Kuala Lumpur until TripUpdates arrive.
4. **Ollama's structured output is documented as best-effort, not guaranteed.**
   → Zod validation and the bounded repair loop are load-bearing, and temperature 0 plus in-prompt
   schema grounding are required configuration rather than tuning.

## What is blocked

The pilot region's feed licence could not be verified — `data.gov.my/terms`,
`/terms-of-use` and `developer.data.gov.my/terms-of-use` all returned HTTP 404. Because
`transit_feeds.licence` is `NOT NULL` with no "unknown" value, the pilot feeds are **structurally
un-ingestible** until a human confirms it. See `00-COMPLETION-REPORT.md` §5.
