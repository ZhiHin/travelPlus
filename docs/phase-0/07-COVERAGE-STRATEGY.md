# Coverage model and the honest cost statement

**Status:** Phase 0 · 2026-08-19

This document exists to stop two specific lies: "works anywhere in the world" and "free".

---

## 1. What "global" means here

TravelPlus is **global by architecture, regional by data**. The application code has no country
knowledge baked in. What determines whether a city works is whether someone has installed a region
pack for it.

A region pack is:

1. An OpenStreetMap extract covering the area
2. Zero or more GTFS feeds whose licence permits our use, whose service dates cover the trip, and
   whose coverage overlaps the extract
3. Optionally, GTFS-Realtime feeds from the same agencies
4. A built OTP graph and a registered router
5. A `routing_regions` row with a bounding geometry, and `transit_feeds` rows recording licence,
   attribution, service window, health and update cadence

Nobody gets transit routing in a city without step 2. That is not a limitation to be worked around;
it is the shape of the open transit data world.

## 2. Coverage tiers

Every destination resolves to exactly one tier, and the tier is shown to the user before they plan.

| Tier | What exists | What the user gets | Badge |
| --- | --- | --- | --- |
| **T0 — No coverage** | Nothing installed | Manual itinerary entry, external navigation deep links, coordinates and notes | "No routing data" |
| **T1 — Street only** | OSM extract, no transit feed | Walking, cycling, driving routes and geometry | "Walking and driving only" |
| **T2 — Scheduled transit** | OSM + valid GTFS | Everything in T1 plus transit routing with `SCHEDULED` status | "Scheduled transit" |
| **T3 — Realtime transit** | OSM + GTFS + live GTFS-RT inside its freshness window | Everything in T2 plus `REALTIME` departures, delays and service alerts | "Live transit" |

A trip may span tiers. A two-city trip can be T3 in one and T1 in the other, and the itinerary
labels each leg by the tier that produced it — not by the trip's best tier.

**T3 degrades to T2 automatically** when a realtime feed goes quiet past its freshness window. That
transition is computed from `retrieved_at`, not from a stored label (ADR-0006, R-15).

## 3. What this means for the product surface

- The landing page states the coverage model. It does not say "anywhere".
- Destination entry shows the tier before the user commits to planning there.
- The AI planner is told the tier and does not propose transit-dependent structures in T0/T1.
- Trip settings has a data-source status screen listing every feed backing this trip, its version,
  its licence, its last successful sync and its health.
- `UNAVAILABLE` is a designed state with offered fallbacks, not an error page.

## 4. Planned coverage sequence

| Phase | Coverage |
| --- | --- |
| 3 | **Pilot: Kuala Lumpur / Klang Valley at T2 (scheduled transit)** — four feeds, one graph (`09-PILOT-REGION.md`) |
| 3 (end) | Portland (TriMet) registered as a realtime-validation region — engineering asset, not user-facing |
| 6 | Realtime hardened and validated on Portland; KL gains a labelled vehicle-position layer; stale detection and feed health |
| 8 | Repeatable region-onboarding workflow, multi-region router selection, catalog operations |
| later | **KL promoted T2 → T3** when Malaysian GTFS-RT TripUpdates ship — configuration change only |

The pilot ships at T2 rather than T3 because of data, not effort: Malaysia publishes GTFS-Realtime
**VehiclePosition only**, and vehicle positions contain no predicted stop times (ADR-0022). The
promotion path being a configuration change rather than a code change is the region-pack
architecture proving itself.

Region onboarding after Phase 8 is an operational runbook, not an engineering project. That is the
point of the architecture.

---

## 5. The cost statement

### 5.1 What is genuinely free

The default local development path requires **no billable API key**:

- All software in the stack is open source: Next.js, PostgreSQL, PostGIS, OpenTripPlanner,
  Ollama, MapLibre GL JS
- OpenFreeMap requires no registration and no key, and states no request limits
  (verified 2026-08-19)
- Public Nominatim requires no key (verified 2026-08-19) — subject to the strict policy compliance
  in ADR-0011
- Open-Meteo's free tier requires no key for non-commercial use (verified 2026-08-19)
- TriMet's static GTFS requires no application ID (verified 2026-08-19)
- Ollama runs locally; no hosted model bill
- OSM extracts, GTFS feeds and Wikimedia content are openly licensed subject to attribution

You can develop, test and run this product on one machine without giving anyone a payment method.

### 5.2 What is not free, and never was

**Free software is not free operation.** Producing this list is part of the deliverable, not a
disclaimer bolted on afterwards.

| Cost | Why it exists | Rough shape |
| --- | --- | --- |
| Compute for the web app | Needs a persistent process, not just serverless — ADR-0001 | Small always-on instance |
| Compute for the worker | AI jobs and feed sync need a persistent process | Small always-on instance |
| **OTP memory** | A graph is held in RAM. OTP documents ~1 GB minimum for a TriMet-sized dataset and recommends 2 GB (verified 2026-08-19). Larger metros need more, **per region served simultaneously** | The dominant infrastructure cost |
| Database storage | Route snapshots and itinerary versions accumulate by design (ADR-0006) | Grows with usage; retention policy required |
| **Tile bandwidth** | OpenFreeMap's public instance is generous but is someone else's donated infrastructure. A serious product self-hosts | Egress-dominated; the largest variable cost at scale |
| Geocoding at scale | Public Nominatim explicitly runs on donated servers with very limited capacity. Any real traffic requires self-hosting | A server plus a periodic import |
| LLM inference | Local Ollama is free of bills and not free of hardware. Serving many users needs real GPUs or a paid API | Scales with planning volume |
| Weather beyond non-commercial | Open-Meteo's free tier excludes commercial products (ADR-0020) | Paid tier or self-host |
| Backups, monitoring, egress, domain, certificates | Ordinary operations | Small but non-zero |

### 5.3 The three statements that must never be made

1. "TravelPlus is free to run in production."
2. "TravelPlus works in any city in the world."
3. "TravelPlus is production-ready" — on the evidence that it runs locally.

### 5.4 Scaling shape

The cost that surprises people is not per-user; it is **per-region-served**. Each simultaneously
served region needs its graph resident in memory. Ten regions is not ten times the users, it is ten
times the memory floor before the first user arrives.

This has a product consequence worth deciding early: serving regions on demand (load a graph when a
trip needs it, evict when idle) trades first-request latency for memory. A capacity model
quantifying that trade is a Phase 8 deliverable.

### 5.5 Attribution obligations (not optional, and not free of design cost)

Attribution is a licence condition, and it occupies screen space on a map-first mobile product.
Designed for in `23-DESIGN-DIRECTION.md`, not appended as a footnote.

- Map: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (verified wording, 2026-08-19)
- Geocoding: OpenStreetMap contributors, per ODbL guidelines
- Weather: CC-BY 4.0 attribution to Open-Meteo
- Transit: per-feed attribution rendered from `transit_feeds` metadata
- Imagery: author, licence and source URL preserved per Wikimedia asset — never hotlinked contrary
  to its licence
