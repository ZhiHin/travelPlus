# Product vision and objectives

**Status:** Phase 0 · 2026-08-19

## 1. The problem

Trip planning fails at the seams between decisions. Choosing what to see is easy. Knowing whether
you can actually get from the second stop to the third before the museum closes is hard, and it is
the part every tool skips.

Two categories of product exist and neither solves it. AI planners produce fluent itineraries that
collapse on contact with a real timetable — they will confidently name a bus that does not exist.
Map apps route beautifully between two points but have no idea what your day is, so the traveller
becomes the integration layer, copying places between apps and doing transfer arithmetic in their
head on a station platform.

## 2. The product

TravelPlus joins them: an itinerary where **every leg has been routed by a real engine against real
transit data**, and which says so — including when it cannot.

The organising idea is a trip space that behaves like a folder for one journey, rendered as a
map-first canvas rather than an admin dashboard. The map is the ground plane; the itinerary is a
ribbon over it; the two are one surface.

## 3. Vision statement

> A traveller lands in a city they have never visited, opens the trip they planned last week, and
> the next thing they need to do — and the exact way to get there — is on screen, with a visible
> marker of whether that departure time is live, scheduled, or an estimate.

## 4. Objectives

| # | Objective | How it is measured |
| --- | --- | --- |
| O1 | Every transport fact shown is traceable to a provider response | **Zero** untraceable facts. Not a percentage — see §6 |
| O2 | A generated plan is executable, not merely plausible | Legs routed, constraints validated, conflicts surfaced before commit |
| O3 | A user can change one thing without losing everything else | A reorder recalculates ≤4 leg boundaries, never the whole trip |
| O4 | Data gaps are visible and actionable | Every `UNAVAILABLE` state offers concrete fallbacks |
| O5 | The product is usable one-handed, offline, in a foreign city | Today mode and cached trip open with no signal |
| O6 | Accessibility is a gate, not a polish item | WCAG 2.2 AA verified in CI every phase |
| O7 | The default development path costs nothing | No billable API key anywhere in the documented local path |

## 5. Product principles (binding)

1. **Reality before magic.** A smaller verified plan beats an impressive fictional one.
2. **Map and itinerary are one surface.** Scrolling one moves the other.
3. **AI proposes; deterministic services verify.**
4. **Editable at every level** without regenerating the trip.
5. **Explain changes.** Replanning shows a before/after diff, never an unexplained replacement.
6. **Data confidence is visible** — and never conveyed by colour alone.
7. **Progressive disclosure.** Next decision first; transfers and metadata on demand.
8. **Global by architecture, regional by data.**
9. **Privacy by default.** Minimum location and identity data.

## 6. The counter-metric

Most products measure what they produce. This one must also measure what it refuses to produce.

**Zero transport facts shown to a user that did not come from a provider response.**

A plan that says *"no transit data here, here is the walking route"* is a success. A plan that
invents bus 47 is a total failure regardless of how good the rest of it was. This is not an
availability target with an error budget — one violation is a defect. It is why the LLM's output
schema has no transport fields at all (ADR-0005): the failure is made structurally impossible rather
than merely discouraged.

## 7. What this product is not

It is not a booking engine, a fare aggregator, a review site, or a navigation app. It does not
compete on inventory or on content volume. It competes on **being right about the next two hours**,
and on saying so plainly when it cannot be.

## 8. Positioning consequences the business must accept

Being honest about coverage is a positioning choice with real costs, and it is better decided now
than discovered at launch:

- The product cannot claim to work "anywhere". Coverage is the set of regions with an installed
  region pack (`07-COVERAGE-STRATEGY.md`).
- The pilot region ships at **scheduled** transit confidence, not live, because the pilot's realtime
  feed publishes vehicle positions and not predictions (`09-PILOT-REGION.md` §2.3).
- Free means no billable key in local development. It does not mean free production hosting, and the
  cost model says so explicitly (`07-COVERAGE-STRATEGY.md` §5).

## 9. Success criteria for the MVP

A user can, on a mid-range phone: create a trip, set preferences, generate a proposal, review a
diff, apply selected changes, reorder a day and see only affected legs recalculate, open detailed
transit steps with visible provenance, share the trip read-only, and reopen it offline — with every
transport fact traceable to a provider response, and every gap shown as a gap.
