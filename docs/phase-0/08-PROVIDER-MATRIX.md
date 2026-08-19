# Provider matrix — licensing, attribution, limits and fallback behaviour

**Check date:** 2026-08-19. **Method:** live fetch of each provider's own documentation or policy
page. Rows not confirmed that way are marked and carry blocking tasks.

> Verification status is per row and is load-bearing. Re-check every row at implementation time and
> update the check date. **If current documentation conflicts with anything here, follow the current
> official restriction**, record the difference, and choose the safest compliant implementation.

---

## 1. Summary

| Need | Provider | Key? | Verified | Fallback when it fails |
| --- | --- | --- | --- | --- |
| Map rendering | MapLibre GL JS | No | library | none needed |
| Tiles / style | OpenFreeMap | No | ✅ | Self-hosted PMTiles; then non-map list view |
| Tile policy constraint | OSMF tile policy | — | ✅ | — |
| Geocoding | Public Nominatim via server proxy | No | ✅ | Cache → saved places → manual pin |
| Routing | Self-hosted OpenTripPlanner 2 | No | ✅ | Walking estimate → manual entry → external deep link |
| Pilot static GTFS | data.gov.my (Prasarana, KTMB) | **No** | ✅ | Last good feed version, labelled `STALE` |
| Pilot GTFS-RT | data.gov.my vehicle-position | **No** | ✅ **position only** | Scheduled data, labelled `SCHEDULED` |
| Realtime validation | TriMet (Portland) | static No / RT **yes, free** | ⚠️ | Scheduled path unaffected |
| Weather | Open-Meteo free tier | No | ✅ | Omit weather entirely; never blocks planning |
| Place content | Wikimedia APIs | No | ✅ | Omit description and image |
| Feed discovery | Mobility Database | sign-up | ⚠️ | Agency sources directly |
| AI | Local Ollama | No | ✅ | `AI_UNAVAILABLE`; trip fully usable |
| Time zones | Local IANA dataset package | No | ❌ | none — must be local, no network call |
| Pilot data licence | data.gov.my terms | — | ❌ **404** | **Blocks ingestion** |

---

## 2. Verified rows

### 2.1 OpenFreeMap — tiles and styles ✅

Fetched from `https://openfreemap.org/`.

| Property | Verified |
| --- | --- |
| Key / registration | None. "No registration, no user database, no API keys." |
| Limits | "No limits on the number of map views or requests." |
| Commercial use | Permitted — "Yes." |
| Attribution | **"OpenFreeMap © OpenMapTiles Data from OpenStreetMap"**. The OpenFreeMap portion is optional but requested; the rest is not |
| Self-hosting | Weekly full-planet downloads in Btrfs and MBTiles; MIT-licensed source |

**Rules.** Style URL is one config value (`MAP_STYLE_URL`) used through one map-config module.
Attribution presence is asserted by test, not assumed from MapLibre defaults.
**Fallback:** self-hosted PMTiles; if tiles are unavailable entirely, the map area renders the
designed non-map state and route steps stay fully readable.

### 2.2 OSM Foundation tile policy ✅ — constrains the PWA

Fetched from `https://operations.osmfoundation.org/policies/tiles/`.

| Requirement | Verified |
| --- | --- |
| Prefetching | Prohibited — no pre-emptive fetching beyond what a user is actively viewing, no pre-seeding areas or zoom levels, no building tile archives |
| Offline | "offline use is not permitted on `tile.openstreetmap.org`"; "Download city/country for offline use" features are prohibited |
| User-Agent | Clear and unique, naming the app; library defaults are blocked |
| Referer | Web pages must send a valid Referer; proxies must not strip it |
| Caching | Honour HTTP cache headers or keep ≥7 days locally; never send no-cache by default |
| Attribution | "© OpenStreetMap contributors", clearly on the map, not hidden behind a toggle |
| Thresholds | None published; access may be blocked without notice |

**Consequence:** ADR-0012. The PWA never prefetches tiles, and offline maps are out of MVP scope.

### 2.3 Nominatim policy ✅ — the strictest constraint we operate under

Fetched from `https://operations.osmfoundation.org/policies/nominatim/`.

| Requirement | Verified |
| --- | --- |
| Rate limit | Absolute maximum **1 request per second** |
| Bulk geocoding | Discouraged; where done, 4 req/min, single thread, "no distributed scripts" |
| Identification | Valid Referer or User-Agent identifying the application; library defaults insufficient |
| **Autocomplete** | **Explicitly prohibited** — "you must not implement such a service on the client side using the API" |
| Caching | "Results must be cached on your side"; repeated identical queries may be classified as faulty and blocked |
| Attribution | Clearly displayed per ODbL guidelines |
| Capacity | "runs on donated servers and has a very limited capacity" |

**Implementation (ADR-0011).** Server proxy only. One **database-backed** application-wide token
bucket at 1 req/s — a per-process limiter would breach the policy the moment a second container
starts. Submit-triggered search only. All results cached. Identifying User-Agent with contact
address, enforced at startup.
**Fallback chain:** cache → previously saved places → manual pin entry. Search degrades; it never
hard-fails the trip.

### 2.4 OpenTripPlanner 2 ✅

Fetched from the OTP documentation, Basic Tutorial and Container Image pages.

| Property | Verified |
| --- | --- |
| Version | 2.8.1 released; 2.9 on master |
| Java | "compatible with Java 25 or later"; Java 25 recommended (LTS) |
| Memory | ~1 GB minimum for a moderate dataset; `-Xmx2G` recommended |
| Inputs | OSM PBF extract + GTFS `.zip` whose **filename must contain `gtfs`** |
| Build / serve | `--build --save` then `--load --serve` |
| Port | 8080 by default |
| Container | `opentripplanner/opentripplanner`; data at `/var/opentripplanner/`; heap via `JAVA_TOOL_OPTIONS` |
| APIs | GTFS GraphQL, Transmodel GraphQL, legacy REST |

Self-hosted, so there is no third-party rate limit — the limit is our own hardware.
**Fallback:** circuit breaker distinguishes outage from no-route; on outage, walking estimates are
offered clearly labelled `ESTIMATED`, plus manual entry and an external deep link.

### 2.5 Malaysia data.gov.my — static GTFS ✅ (pilot region)

Fetched from `https://developer.data.gov.my/realtime-api/gtfs-static`.

| Property | Verified |
| --- | --- |
| Base | `https://api.data.gov.my/gtfs-static/` |
| Pilot feeds | `prasarana?category=rapid-rail-kl`, `rapid-bus-kl`, `rapid-bus-mrtfeeder`, plus `ktmb` |
| **API key** | **Not required** |
| Cadence | KTMB daily 00:01; Prasarana "as required" |
| Known quality issue | ~2% of `rapid-bus-kl` trips removed for operational reasons |

**Fallback:** the last successfully ingested feed version continues to serve, and once its service
dates lapse the UI reports `FEED_EXPIRED` rather than routing against dead data.

### 2.6 Malaysia data.gov.my — GTFS-Realtime ✅ **VehiclePosition only**

Fetched from `https://developer.data.gov.my/realtime-api/gtfs-realtime`.

| Property | Verified |
| --- | --- |
| Base | `https://api.data.gov.my/gtfs-realtime/vehicle-position/<agency>` |
| Cadence | Every 30 seconds |
| API key | Not required |
| **Published types** | **VehiclePosition only** |
| **TripUpdates / Alerts** | **Not available** — "in our pipeline for 2026" |

Cross-checked against the GTFS-Realtime reference (`https://gtfs.org/documentation/realtime/reference/`):
**TripUpdate** carries `StopTimeUpdate` predicted arrivals and departures; **VehiclePosition**
carries position, bearing, speed, congestion and occupancy and **excludes predicted stop times**.

**Therefore Kuala Lumpur cannot produce `REALTIME` departure predictions.** Vehicle positions may
power a position-only map layer, explicitly labelled as such. See `09-PILOT-REGION.md` §2.3.

### 2.7 Open-Meteo ✅ — free tier is non-commercial

Fetched from `https://open-meteo.com/en/terms`.

| Property | Verified |
| --- | --- |
| Limits | <10,000 calls/day · 5,000/hour · 600/minute |
| Non-commercial covers | Private/non-profit sites without subscriptions or ads, personal use, public research, education |
| **Excluded** | Subscription sites, ad-supported sites, integration into commercial products |
| Licence | CC-BY 4.0 |

**ADR-0020 / R-07: this row must change before any commercial launch.**
**Fallback:** weather is omitted entirely. No itinerary operation is ever blocked by its absence.

### 2.8 Wikimedia APIs ✅

Fetched from `https://www.mediawiki.org/wiki/API:Etiquette`.

| Requirement | Verified |
| --- | --- |
| User-Agent | **Mandatory and descriptive**, format `clientname/version (contact information) framework/version`. Browser UA strings are not acceptable |
| Browser JS | Use the `Api-User-Agent` header instead |
| Read rate | No hard speed limit, but **requests must be made serially, not in parallel** |
| Write rate | Rate-limited; retry with exponential backoff on `ratelimited` |
| Caching | Cache locally; prefer GET so responses are cacheable |

**Implementation.** Server-side only, serial queue per host (never a parallel fan-out over places),
cached in `provider_cache_entries`, User-Agent from `WIKIMEDIA_USER_AGENT` and validated at startup.
Author, licence, attribution and source URL preserved per asset; never hotlinked contrary to licence.
**Fallback:** place renders without description or image. Never blocking.

### 2.9 Ollama structured outputs ✅ — and why this validates ADR-0013

Fetched from `https://docs.ollama.com/capabilities/structured-outputs`.

| Property | Verified |
| --- | --- |
| Mechanism | JSON Schema passed via the `format` parameter; `/api/chat` supports it; OpenAI-compatible path uses `response_format` |
| **Guarantee** | **None.** Docs recommend also passing the schema in the prompt to ground the model, and setting temperature to 0 — the feature is described as probabilistic, not deterministic |
| Cloud | Ollama Cloud does not currently support structured outputs |
| Tooling | Pydantic / Zod examples provided |

This is the most consequential AI finding in Phase 0. Structured output is **best-effort, not
enforced**, which means Zod validation at the boundary and the bounded repair loop are load-bearing
rather than belt-and-braces. Temperature 0 and in-prompt schema grounding become required
configuration, not tuning suggestions.
**Fallback:** validation failure → one structured retry → `AI_INVALID_OUTPUT`. The trip is untouched.

---

## 3. Partially verified ⚠️

### 3.1 TriMet — realtime-validation region only

Fetched from `https://developer.trimet.org/GTFS.shtml`.

| Property | Status |
| --- | --- |
| Static GTFS | ✅ `http://developer.trimet.org/schedule/gtfs.zip` — no AppID |
| GTFS-RT TripUpdate / Alerts / VehiclePositions | ✅ all three published |
| Realtime auth | ✅ "An application id (AppID) is a required parameter to all TriMet web service calls" — free registration, not billable |
| **Licence text** | ⚠️ Not on the fetched page; linked Terms of Use not read |

**Blocking before Phase 6 realtime work:** read and record the terms. The scheduled path must work
without the AppID so registration never blocks development.

### 3.2 Mobility Database — discovery aid only

Fetched from `https://mobilitydatabase.org/`. Catalog of "over 6000 GTFS, GTFS Realtime, and GBFS
feeds in over 99 countries", web catalog plus an API with sign-up, validator-backed quality reports.
**Catalog terms not stated on the fetched page.**

Used for discovery only. The authoritative licence for any feed is **the agency's own terms**.

---

## 4. Unverified ❌ — blocking tasks

| Provider | Why | Blocks | Task |
| --- | --- | --- | --- |
| **data.gov.my terms / licence** | `data.gov.my/terms`, `/terms-of-use` and `developer.data.gov.my/terms-of-use` all returned **404** | **Phase 3 pilot ingestion** | X-01 |
| TriMet terms of use | Not on fetched page | Phase 6 realtime | X-02 |
| Mobility Database terms | Not on fetched page | Phase 8 catalog ops | X-03 |
| IANA time-zone package | Not fetched | Phase 1 | X-04 |
| Klang Valley OSM extract source | Not chosen | Phase 3 | X-05 |

`transit_feeds.licence` is `NOT NULL` with no "unknown" value, so X-01 is enforced by the schema:
the pilot feeds are **structurally un-ingestible** until a human confirms the licence.

---

## 5. Excluded from the required path

Google Maps / Places / Directions, Mapbox, HERE, any paid transit API, any paid hosted LLM. Optional
adapters may be documented but must be **disabled by default** and never required for a documented
local path.

---

## 6. Rules applying to every provider

1. Server-side only, except map tile and style endpoints.
2. Behind a typed adapter owning timeout, retry with jitter where safe, circuit breaking, caching,
   rate limiting, identification and instrumentation.
3. Outbound calls go through an SSRF-safe client rejecting private, loopback and link-local targets
   and refusing cross-host redirects.
4. Responses normalized at the boundary; the domain layer never sees a provider payload shape.
5. Every cached response records `retrieved_at`, provider, provider version and a TTL matching that
   data's real freshness semantics.
6. Circuit breakers **distinguish outage from empty result**. Different UI states; never conflated.
7. Attribution renders from stored metadata, so it cannot drift from the data it describes.
8. **Every provider has a defined fallback** (column 5 of §1). A provider that is down degrades one
   capability; it never makes a saved trip inaccessible.
