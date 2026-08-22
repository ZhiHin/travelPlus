# Phase records

One document per phase, written when that phase's gate is met. Each records what
was built and why, a per-file inventory, problems hit and how they were resolved,
deliberate limitations, and the verification commands with their actual exit codes.

| Phase | Document | Status |
| --- | --- | --- |
| 0 â€” Discovery and specification | [`../phase-0/00-COMPLETION-REPORT.md`](../phase-0/00-COMPLETION-REPORT.md) | Complete |
| 1 â€” Foundation | [`PHASE-1.md`](PHASE-1.md) | Complete |
| 2 â€” Trip spaces and place foundations | [`PHASE-2.md`](PHASE-2.md) | Complete |
| 3 â€” Regional routing (KL pilot) | â€” | Not started |
| 4 â€” Itinerary editor | â€” | Not started |
| 5 â€” AI planner | â€” | Not started |
| 6 â€” Live trip and offline | â€” | Not started |
| 7 â€” Bookings, budget, collaboration | â€” | Not started |
| 8 â€” Hardening and release readiness | â€” | Not started |

## What belongs in a phase record

1. What the phase was for â€” the problem, not the task list
2. Stories delivered, with evidence rather than assertions
3. **Per-file inventory** â€” every source file, its purpose, its test count
4. The decisions that carry the most weight, and why
5. Problems found and how they were resolved
6. Deliberate limitations, recorded rather than hidden
7. Gate verification â€” commands run, with actual exit codes
8. Test distribution
9. Commits
10. What the next phase inherits

Sections 5 and 6 matter most in six months. A record that lists only successes is
a record nobody can trust.
