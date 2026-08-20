# Phase records

One document per phase, written when that phase's gate is met. Each records what
was built and why, a per-file inventory, problems hit and how they were resolved,
deliberate limitations, and the verification commands with their actual exit codes.

| Phase | Document | Status |
| --- | --- | --- |
| 0 — Discovery and specification | [`../phase-0/00-COMPLETION-REPORT.md`](../phase-0/00-COMPLETION-REPORT.md) | Complete |
| 1 — Foundation | [`PHASE-1.md`](PHASE-1.md) | Complete |
| 2 — Trip spaces and place foundations | — | Not started |
| 3 — Regional routing (KL pilot) | — | Not started |
| 4 — Itinerary editor | — | Not started |
| 5 — AI planner | — | Not started |
| 6 — Live trip and offline | — | Not started |
| 7 — Bookings, budget, collaboration | — | Not started |
| 8 — Hardening and release readiness | — | Not started |

## What belongs in a phase record

1. What the phase was for — the problem, not the task list
2. Stories delivered, with evidence rather than assertions
3. **Per-file inventory** — every source file, its purpose, its test count
4. The decisions that carry the most weight, and why
5. Problems found and how they were resolved
6. Deliberate limitations, recorded rather than hidden
7. Gate verification — commands run, with actual exit codes
8. Test distribution
9. Commits
10. What the next phase inherits

Sections 5 and 6 matter most in six months. A record that lists only successes is
a record nobody can trust.
