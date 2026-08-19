# Screen inventory

**Status:** Phase 0 · 2026-08-19 · 24 rows covering the prompt's 22 required screens

Every screen below must have designed states for: **default · loading (skeleton preserving real
layout) · empty · partial data · stale data · error · permission denied · offline · reduced
motion**. Where a screen has a state worth calling out specifically, it is listed.

| # | Screen | Phase | Key states beyond the standard set |
| --- | --- | --- | --- |
| 1 | Marketing / landing | 2 | Coverage model stated plainly; no "anywhere in the world" claim |
| 2 | Sign in | 1 | Locked account with retry-after; unverified email |
| 3 | Sign up | 1 | Email taken → identical response to email available (no enumeration) |
| 4 | Password reset | 1 | Request sent (identical whether or not the account exists); token expired; token consumed |
| 5 | Onboarding | 1 | Skippable at every step; resumable; locale/zone/units/accessibility |
| 6 | Trip-space home | 2 | Upcoming · planning · past · archived · shared; first-run empty |
| 7 | Create trip | 2 | Coverage tier revealed per destination **before** committing |
| 8 | Preference studio | 2 | Inherited vs overridden shown per field; conflicting preferences flagged |
| 9 | Destination discovery map | 2 | Search queued behind rate limiter; zero results; result outside coverage |
| 10 | Saved places and collections | 2 | Empty; duplicate detected; place merged |
| 11 | AI planning conversation | 5 | Streaming progress; cancelled; repair attempt in progress; AI unavailable |
| 12 | Plan-generation progress | 5 | Per-stage progress; sources actually checked; cancel |
| 13 | Proposal and diff review | 5 | Per-change accept/reject; unresolved candidates; unmet constraints; expired change set |
| 14 | Journey canvas (itinerary + map) | 4 | List · timeline · story modes; drag preview; conflict; version conflict |
| 15 | Transit directions detail | 3 | Scheduled · realtime · stale; missing platform/code omitted, not filled |
| 16 | Route alternatives | 3 | Comparison table; no alternatives; walking-only fallback |
| 17 | Place detail sheet | 2 | Peek → half → full; opening-hour confidence unknown; no image licensed |
| 18 | Live "Today" mode | 6 | Next leg; running late; mark done/skip; geolocation denied; feed silent |
| 19 | Bookings | 7 | Empty; confirmation masked; no payment fields exist |
| 20 | Budget and expenses | 7 | Multi-currency; manual rate; over budget (warning, not block); uneven split |
| 21 | Checklist and notes | 7 | Empty; assigned items |
| 22 | Collaboration and sharing | 7 | Invite by exact email; role change; link revoked; viewer attempting an edit |
| 23 | Trip settings + data-source status | 3 | Per-feed licence, version, last sync, health; region coverage tier |
| 24 | Profile: accessibility, privacy, localization | 1 | Export requested; deletion requested; retention settings |

> **Mapping to the prompt's list of 22.** The rows above map one-to-one onto it, with two
> deliberate adjustments:
>
> - The prompt's item 2 — "sign in, sign up, reset, and onboarding" — is **four** distinct screens
>   with different states and different failure modes, so it is split into rows 2–5. Bundling them
>   would hide the enumeration-resistance requirement that only the sign-up and reset screens carry.
> - The prompt's item 22 — "offline, empty, partial-data, stale-data, error, and permission-denied
>   states" — is **not a screen**. It is a state matrix applying to every row above, which is why it
>   appears as the standard set at the top of this document and is detailed below.
>
> Rows 6–24 then map directly onto the prompt's items 3–21. Nothing is dropped.

## The state matrix, in detail

The prompt's screen 22 is the most important entry in this document, because it is the one that is
usually skipped. Each state below is a designed screen with real copy, not a fallback.

### Offline
Trip opens from cache with a captured-at timestamp and an offline chip in the command pill.
Discovery, AI planning and route recalculation are visibly disabled with a reason, not silently
broken. Safe edits queue with a pending count. Map area shows the non-map fallback (ADR-0012) —
route steps and coordinates remain fully readable.

### Empty
Every empty state names the next action. "No saved places yet. Search or drop a pin to start
collecting." Never an illustration with the word "Nothing here".

### Partial data
The most common real state and the one that must not look broken. A day where six legs routed and
one did not shows six solid strokes and one dotted, with the gap explained inline and fallbacks
offered — not an error banner over the whole day.

### Stale data
Live badge becomes "out of date", with the retrieval time shown. This transition happens **without
any new data arriving** (R-15), so it must be reachable in a test by advancing the clock alone.

### Error
Distinguishes three things the user experiences differently:
- *We can't reach the routing service* — retryable, offer retry
- *No route exists for that time and mode* — not retryable, offer alternatives
- *This area has no transit data* — not an error at all, offer walking and driving

### Permission denied
A viewer sees edit affordances **absent**, not present-and-failing. Attempting a deep-linked edit
URL yields a clear role explanation. A non-member requesting a real trip gets "not found", never
"forbidden" — see `17-ERROR-CODES.md`.

### Reduced motion
A designed variant, not a degradation: map focus cuts rather than flies, diffs appear rather than
draw, progress is numeric rather than animated. Covered by visual regression tests.

## Cross-cutting requirements for every screen

1. **Semantic equivalence.** Anything expressed on the map exists in a keyboard-navigable list with
   the same information, including provenance (ADR-0018a).
2. **Provenance visible.** Any real-world fact renders with its confidence state, using the fixed
   six-phrase vocabulary from the design direction.
3. **No hover-only information.** Every hover reveal has a tap and a focus equivalent.
4. **Skeletons preserve layout.** Loading states occupy the final geometry so nothing shifts.
5. **Attribution present.** Persistent and expandable on every screen showing map or provider data.
6. **Safe areas honoured.** Mobile controls clear notches, home indicators and the on-screen
   keyboard.
