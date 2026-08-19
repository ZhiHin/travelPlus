# Personas, jobs-to-be-done, critical journeys and edge cases

**Status:** Phase 0 · 2026-08-19

These are one product, not seven. Each persona is expressed through the preference model, not
through a separate mode or a separate build.

---

## 1. Personas

### P1 — Solo efficient explorer
Travels alone, wants density without exhaustion, comfortable with public transport, reads route
detail carefully. **Pressure they put on the product:** transfer accuracy and honest walking
distances. They will notice a 12-minute transfer that is really 4.

### P2 — Couple, relaxed and food-led
Two people, late starts, long meals, one anchor sight per day. **Pressure:** meal-window handling
and the ability to say "make this less rushed" and have it mean something structural, not cosmetic.

### P3 — Family with young children
Stroller, nap window, early dinner, hard stop at 19:00, tolerance for exactly one queue per day.
**Pressure:** step-free routing, rest blocks as first-class items, and the constraint engine
actually refusing a plan that ignores the nap.

### P4 — Group with divergent interests
Four to eight people, split preferences, needs a shared surface and a way to disagree without a
group chat. **Pressure:** roles, shared editing, and (Phase 7) voting. Concurrency is real here.

### P5 — Budget traveller
Public transport by default, free attractions, tracks every expense, walks further to save fare.
**Pressure:** budget arithmetic correctness, multi-currency honesty, and fare data we mostly do not
have — so the product must be clear that fares are `UNAVAILABLE` rather than guessing.

### P6 — Business traveller
Two fixed meetings, a 90-minute gap, an airport departure. **Pressure:** immovable blocks, arrive-by
routing, and buffers that respect the fact that being late is not an inconvenience but a failure.

### P7 — Traveller with access needs
Wheelchair use, sensory sensitivity, dietary or religious requirements, or travelling with an
elderly parent. **Pressure:** accessibility data confidence. The correct answer is often "the feed
does not say whether this station is step-free" — and saying that clearly is more valuable than a
confident guess. This persona is the sharpest test of the entire confidence model.

---

## 2. Jobs to be done

| # | Job | Persona weight | Where it lands |
| --- | --- | --- | --- |
| J1 | "Give me a realistic day plan I can actually execute" | all | Phases 4–5 |
| J2 | "Tell me exactly how to get from here to the next thing" | all | Phase 3 |
| J3 | "Tell me when the plan is impossible, before I'm standing there" | P1, P3, P6, P7 | Phase 4 |
| J4 | "Let me change one thing without losing everything else" | all | Phase 4 |
| J5 | "Keep everything about this trip in one place" | P2, P4, P5 | Phases 2, 7 |
| J6 | "Tell me what this plan costs and who owes whom" | P4, P5 | Phase 7 |
| J7 | "Work when I have no signal in a foreign city" | all | Phase 6 |
| J8 | "Let me plan this together without fighting over a chat thread" | P4 | Phase 7 |
| J9 | "Respect my constraints without me re-explaining them daily" | P3, P7 | Phases 1–2 |
| J10 | "Tell me the truth about what you don't know" | all — especially P7 | every phase |

J10 is the differentiating job. It is the reason for the confidence model and it is why a phase
gate can fail on an honesty defect even when every feature works.

---

## 3. Critical journeys

### CJ-1 — First trip, from nothing to a reviewed plan
Sign up → skippable onboarding (locale, home zone, units, accessibility) → create trip
(destination, dates, travellers) → preference studio (pace, budget, walking limits, meal windows,
access needs) → "Plan my trip" → progress states while candidates are generated, places resolved,
legs routed, constraints checked → proposal with a diff and a confidence summary → accept selected
→ saved as version 1.

**Fails if:** any proposed item shows a transport fact that was not routed; the diff is not
reviewable before applying; the progress display claims a source was checked that was not called.

### CJ-2 — "Make day two less rushed"
Open trip → Plan → AI conversation scoped to day two → model proposes removing one stop and
extending two → the scheduler reroutes only affected legs → diff shows exactly what moved and why
→ accept two of three changes → version 2 saved with the rejected change discarded.

**Fails if:** the whole trip regenerates; locked items move; the explanation is generic.

### CJ-3 — Reorder a day by hand
Open day → drag stop 4 above stop 2 → preview shows the two affected legs recalculating, with the
rest untouched → a conflict appears because the museum now closes before arrival → user accepts a
suggested 30-minute earlier start → commit.

**Fails if:** unaffected legs are recalculated; the keyboard path cannot do the same thing; the
conflict is detected after commit rather than in preview.

### CJ-4 — Inspect a transit leg
Tap a travel leg → detailed steps: walk 350 m to the boarding stop, board route toward a headsign
at a departure time, alight, transfer walk → each element carrying agency, route name/number,
scheduled or realtime status, source feed and version, and retrieval time.

**Fails if:** any field is rendered that the normalized response did not contain. Missing fields are
omitted, never filled with plausible text.

### CJ-5 — Live day, running late
Today view shows next activity and next leg with a scheduled/live badge → user taps "running late,
20 minutes" → remaining day replans → locked dinner booking is protected and the app asks before
moving the one important item it would otherwise shift → user confirms → new legs routed.

**Fails if:** a locked booking moves without consent; a stale realtime value is shown as live.

### CJ-6 — Offline arrival
Plane lands, no data. User opens the installed PWA → the selected trip opens from cache with an
offline badge and a captured-at time → today's items and route steps are readable → user marks one
done → the edit queues → on reconnect it reconciles, and a conflict with a collaborator's edit is
shown as a diff rather than silently resolved.

### CJ-7 — Zero-coverage destination
User adds a destination with no ingested GTFS feed → the trip shows a coverage badge stating
transit is unavailable for this region → planning proceeds with walking and driving → every leg is
labelled accordingly → fallbacks offered: manual entry or external navigation deep link.

**Fails if:** the product implies transit exists, or degrades into an error state instead of a
designed one.

---

## 4. Edge cases the design must answer

**Time and calendar**
- Trip crosses a DST transition mid-stay
- Trip spans multiple time zones in one day (train between countries)
- Overnight activity crossing midnight; day boundaries in the itinerary
- A destination in a half-hour-offset zone
- Arrive-by request where no feasible service exists before the deadline

**Data availability**
- Region has OSM but no GTFS → walking/driving only
- GTFS present but expired service dates → scheduled data exists but not for these dates
- Realtime feed configured but silent for hours → `STALE`, not `REALTIME`
- Provider returns 200 with an empty result → "no route found", not "provider down"
- Provider times out → partial itinerary with an explicit unresolved leg
- Place exists in OSM but has no opening hours → opening-hour confidence is unknown, not "open"

**Itinerary integrity**
- Two locked items whose separation is less than the routed travel time between them
- A day with zero routable items
- An item whose place was deleted or merged after planning
- Duplicate places arriving from two sources with different IDs
- Reordering into a conflict the user then declines to resolve — the conflict persists visibly
  rather than being auto-fixed

**People and permissions**
- Viewer attempts an edit through a crafted request
- Owner removes themselves from their own trip
- Invitation sent to an email that later registers
- Share link revoked while a reader has it open
- Two editors drag the same item simultaneously

**Money**
- Expenses in three currencies with no live rate
- A split that does not divide evenly into minor units
- A budget edited downward below already-recorded actuals

**Accessibility and preference conflicts**
- Step-free requirement with no accessible route in the feed → say so; do not silently route
  someone up stairs
- Max-walking preference that makes the only available route infeasible
- Preference set that admits no valid plan at all → explain which constraint blocked it

**Client and platform**
- `prefers-reduced-motion` enabled → map focus is instant, not animated
- Geolocation permission denied → Today mode still works from the plan
- Small viewport in landscape with the keyboard open
- Very long translated strings in the dock and ribbon
