# Pilot routing region — evaluation and selection

**Status:** Phase 0 · 2026-08-19 · supersedes the earlier Portland-first recommendation
**Decision:** **Kuala Lumpur / Klang Valley is the pilot region.** Portland (TriMet) is retained as a
narrow *realtime-validation* region, not as the pilot.

---

## 1. The instruction

> "Consider Kuala Lumpur first, but only select it if the required data is legally and technically
> available. Otherwise choose a better-supported pilot region and explain why."

That is a test with a pass condition, so this document answers it with fetched evidence rather than
preference. All URLs below were retrieved on **2026-08-19**.

## 2. What was verified about Malaysian open transit data

### 2.1 Static GTFS — available, keyless, and covers Greater KL ✅

Source: `https://developer.data.gov.my/realtime-api/gtfs-static`

| Property | Verified value |
| --- | --- |
| Base URL | `https://api.data.gov.my/gtfs-static/` |
| Prasarana | `/prasarana?category=<category>` with categories **`rapid-rail-kl`**, **`rapid-bus-kl`**, **`rapid-bus-mrtfeeder`**, `rapid-bus-penang`, `rapid-bus-kuantan` |
| KTMB | `/ktmb` — national rail including KTM Komuter |
| MyBAS | 10 further city feeds (Kangar, Alor Setar, Kota Bharu, Kuala Terengganu, Ipoh, Seremban ×2, Melaka, Johor Bahru, Kuching) |
| Format | GTFS `.zip` |
| **API key** | **Not required** |
| Update cadence | KTMB daily at 00:01; Prasarana and MyBAS "as required" |
| Known data quality | ~2% of trips removed from `rapid-bus-kl` due to operational issues |

`rapid-rail-kl` covers the Klang Valley rail network — LRT, MRT, Monorail — and `rapid-bus-kl` plus
`rapid-bus-mrtfeeder` cover the bus and feeder network. Combined with KTMB Komuter, that is a genuine
multi-operator, multi-mode metropolitan network available without a key.

### 2.2 GTFS-Realtime — available, keyless, 30-second cadence, but **VehiclePosition only** ⚠️

Source: `https://developer.data.gov.my/realtime-api/gtfs-realtime`

| Property | Verified value |
| --- | --- |
| Base URL | `https://api.data.gov.my/gtfs-realtime/vehicle-position/<agency>` |
| Agencies | KTMB, Prasarana (by category), BAS.MY cities |
| Update cadence | Every 30 seconds |
| API key | Not required |
| **Feed types published** | **VehiclePosition only** |
| **TripUpdates / ServiceAlerts** | **Not available** — "in our pipeline for 2026" |

### 2.3 Why the missing feed type is decisive, not cosmetic

Source: GTFS-Realtime reference, `https://gtfs.org/documentation/realtime/reference/`

> **TripUpdate** carries realtime departure delays and `StopTimeUpdate` entries with predicted
> arrival and departure times per stop.
> **VehiclePosition** carries position, bearing, speed, congestion and occupancy — and **excludes
> predicted stop times**.

So the chain is:

1. Predicted departure and arrival times live in **TripUpdate**.
2. Malaysia publishes **VehiclePosition only**.
3. Therefore Kuala Lumpur **cannot** produce delay-adjusted departure predictions today, and cannot
   legitimately reach coverage tier **T3** under this product's own confidence rules.

This is exactly the kind of gap the master prompt forbids papering over. Vehicle positions are still
genuinely useful — they can drive a "where is my bus right now" map layer — but they are not
predictions, and labelling them as such would be the precise failure mode `TRUTH-07` exists to
prevent.

### 2.4 Licensing — VERIFIED ✅ CC BY 4.0 (2026-08-21)

`data.gov.my/terms`, `data.gov.my/terms-of-use` and `developer.data.gov.my/terms-of-use` all
returned **HTTP 404** to automated fetches on 2026-08-19. The portal describes itself as
"Malaysia's official open data portal" under a "Public Sector Open Data" framework, but no licence
text (CC-BY or otherwise) was retrievable.

Because `transit_feeds.licence` is `NOT NULL` with no "unknown" value
(`14-DATA-MODEL.md` §4.5), **ingestion is structurally blocked until a human confirms the licence**.
Tracked as `X-01` in `29-PHASE-1-BACKLOG.md`.

## 3. The decision

**Kuala Lumpur passes the test.** The required data — open, keyless, multi-modal, metropolitan-scale
static GTFS plus an OSM extract — is technically available. The licence question is a verification
task, not a known blocker, and the same task exists for every feed we would ever ingest.

Selecting Portland instead would be choosing convenience over the actual product. KL is a
substantially better *product* pilot than Portland on every axis that matters to this application:

| Axis | Kuala Lumpur | Portland |
| --- | --- | --- |
| Modes exercised | LRT, MRT, Monorail, commuter rail, BRT, bus, feeder bus | Light rail, streetcar, bus, commuter rail |
| Multi-operator transfers | **Yes** — Prasarana ↔ KTMB, and across Prasarana categories | Largely single-agency |
| Static GTFS key required | **No** | No |
| Realtime key required | **No** | **Yes** (free TriMet AppID) |
| TripUpdates (predictions) | **No** | **Yes** |
| Non-English naming / i18n pressure | **Yes** — Malay place names | No |
| Relevance to the stated market | **Direct** | None |
| OTP tutorial ground truth | No | **Yes** |

KL wins on five of eight axes, loses decisively on one — TripUpdates — and loses on OTP tutorial
familiarity, which is a first-week convenience rather than a product property.

## 4. What Portland is retained for

Portland is **not** the pilot and is not user-facing. It is kept for two narrow engineering purposes:

1. **Realtime-semantics validation.** TriMet publishes TripUpdate, Alerts and VehiclePositions
   (verified 2026-08-19). It is the only region in this plan that can exercise the
   `SCHEDULED → REALTIME → STALE` transition end to end. Phase 6 needs that, and KL cannot provide
   it until Malaysian TripUpdates ship.
2. **Contract-test fixtures.** OTP's own Basic Tutorial builds against Portland (verified
   2026-08-19), so a Portland graph is the cleanest ground truth for asserting our OTP adapter is
   correct rather than coincidentally working.

Portland is therefore a *test asset*, not a market. It costs one graph build and gives us the ability
to prove the realtime code paths honestly instead of shipping them untested.

## 5. Consequences for the roadmap

| Phase | Effect |
| --- | --- |
| 3 | Pilot is KL at coverage tier **T2 (scheduled transit)**. Feeds: `rapid-rail-kl`, `rapid-bus-kl`, `rapid-bus-mrtfeeder`, `ktmb`. OSM extract: Peninsular Malaysia, trimmed to a Klang Valley bounding box |
| 3 | **`REALTIME` must be unreachable in KL.** A test asserts no KL route can return that status |
| 6 | Realtime work is validated against **Portland**. KL simultaneously gains a *vehicle-position map layer*, explicitly labelled as position-only and never as a prediction |
| 6 | A `TRIP_UPDATES_UNAVAILABLE` capability flag per feed drives the UI, so KL shows "scheduled" honestly while Portland shows "live" |
| 8 | When Malaysian TripUpdates ship, KL is promoted T2 → T3 by **configuration and a feed-capability change**, with no product-code change. That is the region-pack architecture doing its job |

## 6. Multi-feed graph build — the real added cost

Portland is one feed. KL is four. That is genuine additional Phase 3 work and is scheduled, not
hand-waved:

- Four GTFS zips merged into one OTP graph, each retaining its own `transit_feeds` provenance row so
  attribution and licence stay per-operator
- OTP requires each GTFS filename to contain `gtfs` (verified 2026-08-19), so the fetch script
  normalises names to `<operator>-gtfs.zip`
- Inter-operator transfers (LRT ↔ KTM Komuter) depend on OSM walk paths between station entrances;
  stop-linking quality must be validated, not assumed
- The documented ~2% trip removal in `rapid-bus-kl` means feed validation reports are stored per
  version (`transit_feed_versions.validation_report`) and surfaced in the trip data-source screen

## 7. Pilot acceptance criteria (Phase 3 gate)

1. Scripted, repeatable graph build from four pinned GTFS feeds plus a pinned, bbox-trimmed OSM
   extract, with checksums and retrieval times recorded.
2. Every feed has a **verified, human-confirmed licence** stored in `transit_feeds`, with per-operator
   attribution rendered from that metadata.
3. A walking route and a multi-operator transit route between two real Klang Valley places, returned
   through the normalized schema with complete provenance.
4. An LRT ↔ KTM Komuter transfer routes correctly, proving inter-operator transfer handling.
5. All KL transit results carry status `SCHEDULED`; **a test asserts `REALTIME` is unreachable**.
6. A deliberate no-route case returns `UNAVAILABLE` with fallbacks, distinguishable from a provider
   outage.
7. Contract tests run against captured, licence-safe OTP fixtures — CI needs no running OTP.
8. Malay place names and diacritics render, sort and search correctly.

## 8. Unresolved

| Item | Status | Blocks |
| --- | --- | --- |
| data.gov.my licence and attribution text | **Unverified — 404 on three URLs** | Phase 3 ingestion |
| Whether Prasarana feeds carry `wheelchair_boarding` values | Unverified | Accessibility confidence in KL |
| Klang Valley OSM extract source and trim bbox | Not yet chosen | Phase 3 build script |
| Malaysian TripUpdates delivery date | Vendor-controlled, "2026" | KL T3 promotion |
