# TravelPlus — Global AI Travel Planner

Map-first, AI-assisted travel planning. The AI proposes; deterministic services verify.
No transport fact reaches a user unless a routing or data provider returned it.

**Current phase: Phase 0 — Discovery and specification. Complete, awaiting approval.**
**No application code exists yet, by design.**

## Where to start

→ **[`docs/phase-0/00-COMPLETION-REPORT.md`](docs/phase-0/00-COMPLETION-REPORT.md)**
→ Full index: [`docs/phase-0/README.md`](docs/phase-0/README.md)

## Repository contents

Specification only. Per the master development prompt's working rule 4, Phase 0 does not scaffold
applications or install dependencies.

```
README.md
docs/
  PROJECT_STATUS.md     phase state, gates, open items
  DECISIONS.md          23 architecture decision records
  RISKS.md              20 risks with triggers and mitigations
  phase-0/              31 specification documents (00–29 + README)
  phases/               one completion record per phase (PHASE-1.md, …)
```

## The rule that shapes everything

The language model never authors a transport fact. It proposes candidate activities. Routes, times,
stop names, route numbers, fares, platforms, delays and opening hours come from a provider response,
carry provenance and a retrieval time, and are labelled with one of `REALTIME` / `SCHEDULED` /
`ESTIMATED` / `MANUAL` / `STALE` / `UNAVAILABLE`.

Where data is missing, the product says so. It does not fill the gap with plausible text.

This is enforced structurally rather than by policy: the model's output schema has no transport
fields, so an invented bus number fails validation instead of reaching a traveller.

## Pilot region

**Kuala Lumpur / Klang Valley**, using openly published GTFS from `data.gov.my` — Prasarana LRT, MRT,
Monorail, bus and MRT feeder, plus KTMB commuter rail. No API key is required for any of it.

The pilot ships at **scheduled** transit confidence rather than live, because Malaysia currently
publishes GTFS-Realtime vehicle positions only, and vehicle positions contain no predicted stop
times. That limitation is designed for rather than hidden — see
[`docs/phase-0/09-PILOT-REGION.md`](docs/phase-0/09-PILOT-REGION.md).

## Coverage and cost, stated honestly

"Global" means the product supports any region with an installed region pack — an OSM extract, a
licensed GTFS feed, and a built routing graph. It does not mean every city works.

"Free" means the default local development path needs no billable API key. It does not mean
production compute, storage, bandwidth or worldwide data hosting cost nothing. See
[`docs/phase-0/07-COVERAGE-STRATEGY.md`](docs/phase-0/07-COVERAGE-STRATEGY.md).
