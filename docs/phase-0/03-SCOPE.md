# Scope — MVP, post-MVP and explicitly excluded

**Status:** Phase 0 · 2026-08-19

Three tiers. The distinction between "post-MVP" and "excluded" matters: post-MVP is *scheduled*,
excluded is *refused* until a stated precondition changes.

---

## 1. MVP (Phases 1–7)

| Area | In the MVP |
| --- | --- |
| Auth | Email/password, sessions, reset, throttling, CSRF, export and deletion |
| Onboarding | Skippable, resumable; locale, units, currency, home zone, accessibility |
| Trip spaces | Full CRUD, duplicate, archive, restore, nine sections, versioning, autosave |
| Discovery | Submit-triggered search, filters, place cards with provenance, custom pins, duplicate detection |
| AI planning | Ten-stage pipeline, structured proposals, diff review, selective apply, repair loop |
| Itinerary | Timeline, drag + keyboard reorder, locking, eight block types, 13 conflict classes, incremental rerouting, undo/redo |
| Routing | Walking, cycling, driving, transit, mixed; alternatives; normalized schema with full provenance |
| Live mode | Today view, running late, replan, external deep link, opt-in geolocation |
| Bookings | Eight kinds, encrypted confirmation references, manual detail |
| Budget | Categories, planned vs actual, splits, manual FX with source |
| Collaboration | Invitations by exact email, three roles, read-only revocable share links |
| Offline | Installable PWA, one cached trip, queued edits, conflict diffs |
| Coverage | Four tiers, per-destination, shown before planning |

**Pilot coverage in the MVP is tier T2 — scheduled transit — for Kuala Lumpur.** Not T3. The reason
is data, not effort: the pilot's realtime feed publishes vehicle positions only
(`09-PILOT-REGION.md` §2.3).

---

## 2. Post-MVP (scheduled, Phase 8+)

| Item | Why it waits | Precondition to start |
| --- | --- | --- |
| KL promotion to T3 (live departures) | Malaysian GTFS-RT TripUpdates not yet published | data.gov.my ships TripUpdates |
| Additional region packs | Region-onboarding runbook must exist first | Phase 8 catalog workflow |
| On-demand region graph loading | Memory cost per resident graph needs measuring | Phase 8 capacity model |
| Self-hosted geocoder (Nominatim/Photon/Pelias) | Public instance is adequate for pilot volume | Real traffic, or a need for autocomplete |
| Self-hosted PMTiles pipeline | OpenFreeMap is adequate and permits commercial use | Production bandwidth planning |
| Private object storage for attachments | Local dev uses a safe adapter | Phase 8 |
| Comments, suggestions, voting | Roles and activity log come first | Phase 7 completion |
| Calendar export and print summary | Depends on stable itinerary versioning | Phase 7 |
| Multi-factor authentication | No payment data held in MVP | Before public launch |
| CSP tightened to nonces | Tailwind + MapLibre ergonomics | Phase 8 hardening |
| Offline map tiles | Requires licensed or self-hosted regional bundle — **never against a public tile service** | A self-hosted tile pipeline |
| Geocoder autocomplete | Prohibited against public Nominatim | A self-hosted geocoder |

---

## 3. Explicitly excluded from the MVP

Each is deferred because it requires a licensed provider, a payments relationship, or legal exposure
this product is not ready to accept. None is excluded because it is hard.

| Excluded | Why | What ships instead |
| --- | --- | --- |
| Flight search and live pricing | Requires a licensed GDS or aggregator | Manual flight booking records |
| Hotel booking and availability | Requires licensed inventory | Manual lodging records |
| Ticket or fare purchasing | Payments, PCI scope, agency agreements | External deep links |
| **Visa or entry eligibility decisions** | Legal exposure; a wrong answer strands someone | Nothing — the product does not hint at it |
| Turn-by-turn voice navigation | Continuous positioning plus a navigation licence | One-tap handoff to a native map app |
| Live currency exchange rates | No free licensed source | Manual rate with date and source, labelled `MANUAL` |
| Third-party reviews, ratings, popularity | No licensed source; inventing them is fraud | Nothing displayed; no such column exists |
| Fare amounts for transit legs | Rarely present in the pilot feeds | `UNAVAILABLE`, never estimated |

---

## 4. Never in scope

These are not deferrals. They are permanent product constraints, enforced structurally rather than
by policy.

| Never | Enforcement |
| --- | --- |
| Invented transport facts — routes, numbers, stops, times, platforms, fares, delays | `CandidateActivity` schema has no such fields (ADR-0005); `transit_segments` written only from provider responses |
| Invented opening hours, phone numbers, prices, reviews | No such columns exist on `places` (`14-DATA-MODEL.md` §4.4) |
| Storage of payment-card data | No column exists; the API rejects the field |
| Estimates labelled as confirmed facts | Six-status vocabulary applied uniformly |
| Tile prefetching against a public service | ADR-0012; asserted by test |
| Client-side geocoder autocomplete | ADR-0011; no such endpoint exists |
| Claiming a source was checked when it was not | "Sources checked" projected from `ai_tool_events` rows |

---

## 5. Scope-control rules

1. A deferral is written into this document with a reason and a precondition. Nothing is dropped
   silently.
2. A phase is not complete while tests are skipped — a skipped test is how a gate gets passed
   dishonestly.
3. Adding a provider to the required path needs an ADR and a provider-matrix row with a check date.
4. Anything moving from §3 to §1 requires re-running the threat model for that surface.
