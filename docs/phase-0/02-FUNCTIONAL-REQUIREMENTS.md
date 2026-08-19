# Complete functional requirements

**Status:** Phase 0 · 2026-08-19

Requirement IDs here are the anchors used by `28-TRACEABILITY-MATRIX.md`. Scope classification
(MVP / post-MVP / excluded) is in `03-SCOPE.md`.

---

## FR-1 Account and onboarding

| ID | Requirement |
| --- | --- |
| FR-1.1 | Email/password authentication with Argon2id hashing |
| FR-1.2 | Verified session handling with idle and absolute expiry; only a token hash stored server-side |
| FR-1.3 | Throttling on authentication attempts, per account and per IP, returning a retry-after |
| FR-1.4 | Password reset flow with single-use, expiring tokens |
| FR-1.5 | CSRF protection on every cookie-authenticated write |
| FR-1.6 | Sign-up and reset responses must be identical whether or not the email exists |
| FR-1.7 | Optional OAuth adapters, kept separate from and not required by the default path |
| FR-1.8 | Progressive onboarding, skippable at every step and editable later |
| FR-1.9 | Locale, units, time format, currency, home time zone and accessibility settings |
| FR-1.10 | Privacy controls for location history, analytics, AI input retention and shared trips |
| FR-1.11 | Account data export |
| FR-1.12 | Account deletion with a documented cascade |

## FR-2 Trip spaces

| ID | Requirement |
| --- | --- |
| FR-2.1 | Create, duplicate, archive, restore and delete a trip |
| FR-2.2 | Trip carries title, cover, destinations, dates, travellers, status, notes, tags, visibility |
| FR-2.3 | Folder-like home grouped as upcoming, planning, past, archived, shared |
| FR-2.4 | Nine sections per trip: Overview, Plan, Map, Saved, Bookings, Budget, Checklist, Notes, Settings |
| FR-2.5 | Sections reached via floating dock, command palette, contextual tabs and mobile sheets — **no permanent sidebar** |
| FR-2.6 | Draft changes saved automatically with a visible sync state |
| FR-2.7 | Itinerary changes versioned, comparable and restorable |
| FR-2.8 | Duplicating a trip copies structure, places and preferences but **not** route snapshots or bookings |
| FR-2.9 | Each destination resolves to a coverage tier, shown before the user commits to planning there |

## FR-3 Destination and place discovery

| ID | Requirement |
| --- | --- |
| FR-3.1 | Search cities, addresses, transit stops, landmarks, food, shopping, culture, nature and saved places |
| FR-3.2 | Map-bounds search only where supported and policy-compliant |
| FR-3.3 | Filters: category, price hint, accessibility attributes, indoor/outdoor, distance, open-status confidence |
| FR-3.4 | Place cards show source, coordinates, licensed imagery with attribution, description, opening-hour confidence, typical visit duration, personal notes, tags, save state |
| FR-3.5 | **Never** show invented reviews, popularity scores, prices, phone numbers or opening hours |
| FR-3.6 | Add a custom place by pin, name, address or coordinates |
| FR-3.7 | Duplicate detection by provider source ID and by spatial + name similarity |
| FR-3.8 | Search is submit-triggered; **no keystroke autocomplete against the geocoder** (policy — ADR-0011) |
| FR-3.9 | Recent searches and saved places may be suggested as-you-type, since they are local |

## FR-4 AI planning conversation

| ID | Requirement |
| --- | --- |
| FR-4.1 | Trip-scoped conversation aware of the trip, preferences, locked items and prior versions |
| FR-4.2 | Guided plan creation and free-form requests such as "make day two less rushed" |
| FR-4.3 | Structured preview of proposed changes before any destructive edit |
| FR-4.4 | Accept all, accept selected, edit, or reject |
| FR-4.5 | Stream user-facing progress states without exposing chain-of-thought |
| FR-4.6 | Show which data sources were checked and which constraints could not be satisfied |
| FR-4.7 | **Never claim a source was checked unless the application actually called it** |
| FR-4.8 | Cancellable at every pipeline stage, retaining valid partial results |
| FR-4.9 | Unresolved candidates are displayed and are **not applicable automatically** |

## FR-5 Itinerary editor

| ID | Requirement |
| --- | --- |
| FR-5.1 | Day-by-day timeline with time, duration, place, notes, cost estimate status, booking state and travel leg |
| FR-5.2 | Drag and reorder within a day and between days |
| FR-5.3 | **Keyboard-accessible reorder of equal power**, with the same preview contract |
| FR-5.4 | Lock time, place, or an entire item |
| FR-5.5 | Block types: activity, meal, rest, lodging, meeting, transport, free time, booking |
| FR-5.6 | Detect overlaps, impossible transfers, excessive walking, closed-place conflicts, missing meals, insufficient buffers and travel outside user hours |
| FR-5.7 | Recalculate only impacted legs when an item changes |
| FR-5.8 | Undo/redo and version snapshots |
| FR-5.9 | List, timeline and map/story modes |
| FR-5.10 | Preview shows consequences before commit, including new conflicts |
| FR-5.11 | A drop creating an impossible transfer commits **with the conflict shown**, not auto-corrected |

## FR-6 Directions and public transport

| ID | Requirement |
| --- | --- |
| FR-6.1 | Origin and destination by coordinates or provider ID |
| FR-6.2 | Depart-at or arrive-by in the correct local time zone; exactly one of the two |
| FR-6.3 | Walking, cycling, driving, transit and mixed modes where the configured graph supports them |
| FR-6.4 | Preferences: maximum walking, transfer count, accessibility, bicycle allowance, time/cost trade-off |
| FR-6.5 | Multiple alternatives with consistent comparison |
| FR-6.6 | Normalized provider-neutral schema covering total duration, start/end, transfers, walk distance, geometry |
| FR-6.7 | Per-leg access, egress and transfer walks |
| FR-6.8 | Agency, route short name/number, long name, colour, headsign and mode |
| FR-6.9 | Boarding stop, alighting stop, intermediate stop count |
| FR-6.10 | Scheduled and realtime departure/arrival where available |
| FR-6.11 | Platform or stop code **only when present in source data** |
| FR-6.12 | Service alerts and delay status where available |
| FR-6.13 | Wheelchair/accessibility data and its confidence, with "feed does not say" distinct from "not accessible" |
| FR-6.14 | Source feed, source version, router region and `retrievedAt` on every result |
| FR-6.15 | Explicit status: `REALTIME`, `SCHEDULED`, `ESTIMATED`, `MANUAL`, `STALE`, `UNAVAILABLE` |
| FR-6.16 | **Render only fields the normalized response contained; omit rather than fill** |
| FR-6.17 | Distinguish "no route found" from "provider unavailable" from "region not covered" |

## FR-7 Live trip mode

| ID | Requirement |
| --- | --- |
| FR-7.1 | Today view with the next activity and the next verified travel leg |
| FR-7.2 | Scheduled-versus-live badge, always accompanied by an age |
| FR-7.3 | Refresh status and last-updated time |
| FR-7.4 | Delay and service-alert display where feeds provide them |
| FR-7.5 | One-tap external navigation deep link |
| FR-7.6 | Mark done, skip, running late, replan remaining day |
| FR-7.7 | Replanning protects locked bookings and asks before moving important items |
| FR-7.8 | Optional device geolocation only after a user action and permission; never continuous by default |
| FR-7.9 | Where only vehicle positions are available, show them as position-only and **never as predictions** |

## FR-8 Saved items, bookings, files and notes

| ID | Requirement |
| --- | --- |
| FR-8.1 | Saved places organised by custom collections and tags |
| FR-8.2 | Booking records for lodging, flight, rail, bus, event, restaurant, car and other |
| FR-8.3 | Manual confirmation number, dates, provider, cost, currency, notes and link |
| FR-8.4 | **Never store payment-card data** |
| FR-8.5 | No passport or identity-document images in the MVP |
| FR-8.6 | Attachments use private object storage in a later phase; local dev uses a safe adapter |
| FR-8.7 | Portable notes, checklists and links, with rich text sanitised on write and on render |

## FR-9 Budget and expenses

| ID | Requirement |
| --- | --- |
| FR-9.1 | Trip budget by category and currency |
| FR-9.2 | Planned versus actual expenses |
| FR-9.3 | Split between travellers, summing exactly to the total in minor units |
| FR-9.4 | Manual exchange-rate override with date and source metadata |
| FR-9.5 | **Never imply a rate is live unless a configured source supplied it** |
| FR-9.6 | Cost warnings when edits exceed the trip budget — a warning, never a rejection |

## FR-10 Sharing and collaboration

| ID | Requirement |
| --- | --- |
| FR-10.1 | Invite by exact email with roles owner, editor, viewer |
| FR-10.2 | Membership and authorization resolved server-side on every request |
| FR-10.3 | Comments, suggestions, activity log and place voting |
| FR-10.4 | Public share links read-only, revocable, unguessable, excluding private booking details by default |
| FR-10.5 | No user search or discovery endpoint exists |

## FR-11 Offline and resilience

| ID | Requirement |
| --- | --- |
| FR-11.1 | Installable PWA |
| FR-11.2 | Cache the app shell and a user-selected trip summary |
| FR-11.3 | Cache previously opened itinerary data, route instructions and essential place coordinates with expiry/status markers |
| FR-11.4 | Make offline state obvious, and name which capabilities are unavailable and why |
| FR-11.5 | Queue safe local edits and reconcile after reconnecting, surfacing conflicts as a diff |
| FR-11.6 | **Do not cache sensitive tokens or private files** |
| FR-11.7 | **Do not bulk-download or prefetch map tiles** (policy — ADR-0012) |
| FR-11.8 | The trip remains accessible when weather, imagery, AI or routing is unavailable |

## FR-12 Data confidence (cross-cutting)

| ID | Requirement |
| --- | --- |
| FR-12.1 | Six statuses form one vocabulary used identically across API, database and UI |
| FR-12.2 | Status is **derived on read** from retrieval time and feed freshness, never stored as a static label |
| FR-12.3 | `REALTIME` requires a successful realtime fetch inside the feed's freshness window |
| FR-12.4 | `REALTIME` and `STALE` always display an age |
| FR-12.5 | Status is conveyed by text and shape as well as colour |
| FR-12.6 | `UNAVAILABLE` is a designed state offering fallbacks, not an error screen |
| FR-12.7 | A feed capable of positions but not predictions can never yield `REALTIME` |
