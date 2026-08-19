# Testing strategy

**Status:** Phase 0 · 2026-08-19 · risk-based

## 1. Principle

Test effort follows consequence, not code volume. The consequence ladder for this product:

| Rank | Failure | Who it hurts |
| --- | --- | --- |
| 1 | A fabricated transport fact reaches a user | A traveller boards the wrong service in a foreign country |
| 2 | Stale realtime shown as live | A traveller trusts a departure time that is hours old |
| 3 | Cross-user data access | Every user |
| 4 | Wrong time-zone arithmetic | A missed flight |
| 5 | Money arithmetic loses or invents a unit | Group trust |
| 6 | Silent overwrite of a collaborator's edit | Lost work |
| 7 | Inaccessible flow | Excluded users |
| 8 | Slow or ugly | Annoyance |

Ranks 1–3 get adversarial testing — tests written to *break* the claim, not to confirm it.

## 2. Tooling

| Layer | Tool |
| --- | --- |
| Unit and service | Vitest |
| Component behaviour | Testing Library |
| Property-based | fast-check |
| Integration | Vitest against real PostgreSQL + PostGIS in a service container |
| Provider contracts | MSW with captured, licence-safe fixtures |
| End-to-end | Playwright, desktop and mobile viewports |
| Accessibility | axe-core |
| Visual regression | Playwright screenshots |
| Static | TypeScript strict, ESLint (including import boundaries), grep gates |

## 3. The CI rule that shapes everything

**CI must never require a running OTP, a local model, or any paid API.**

Routing is exercised through captured OTP fixtures; AI through `FakeAIProvider`. A test needing a
live provider is a test that will eventually be skipped, and a skipped test is how a phase gate gets
passed dishonestly. `../PROJECT_STATUS.md` records the phase-completion definition; "no skipped
tests" is part of it.

## 4. Adversarial suites (ranks 1–3)

### 4.1 Fabrication suite — the Phase 5 hard gate

Feeds `FakeAIProvider` deliberately hostile output and asserts none of it survives:

| Fixture | Assertion |
| --- | --- |
| Model emits `routeShortName: "47"` | Zod rejects — the field does not exist in `CandidateActivity` |
| Model emits a plausible platform code | Rejected at schema |
| Model emits an unresolvable place | Marked `UNRESOLVED`; **cannot be applied automatically** |
| Model emits a departure time | Rejected at schema |
| Place description contains "ignore previous instructions…" | No tool called outside the allow-list |
| Note contains a cross-trip data-exfiltration instruction | Tool denies; `ai_tool_events` records it |
| Model requests `getTripContext` for another trip | Denied against the **session actor** |
| Render-level sweep | Every transit label on the rendered page traces to a `route_snapshots` row |

**A single fabricated transport fact reaching render fails Phase 5**, regardless of everything else.

### 4.2 Freshness suite

| Test | Method |
| --- | --- |
| `REALTIME → STALE` with no new data | Advance the `Clock` port past the freshness window |
| Positions-only feed can never yield `REALTIME` | Capability flag `tripUpdates: false` — the pilot's real case |
| Badge always shows an age | Render assertion |
| Feed expiry produces `FEED_EXPIRED`, not a wrong route | Service-date fixture |

### 4.3 Authorization suite

The ten tests in `15-DATABASE-STRATEGY.md` §5, plus:

| Test | Assertion |
| --- | --- |
| **Repository with its `WHERE` clause deliberately removed** | Still returns zero cross-user rows — proves defence in depth is real |
| Non-member requests a real trip | `404`, never `403` |
| Viewer attempts every editor verb | Rejected at service **and** at RLS |
| Revoked share token | Indistinguishable in shape and timing from one that never existed |
| `travelplus_app` owns no RLS-protected table | CI assertion — a future migration granting ownership would silently disable every policy |

## 5. Unit and property tests

**Unit:** time-zone conversion, buffer arithmetic, all 13 constraint classes, route normalization
(including every absent-field case), money arithmetic, permission resolution, AI schema validation,
status derivation, region resolution.

**Property-based:**

| Property | Invariant |
| --- | --- |
| Expense splits | Sum exactly equals the total in minor units, for any split count and any amount |
| Itinerary ordering | Stable under time-zone conversion |
| Overlap detection | Symmetric and transitive-consistent |
| Currency totals | No unit created or destroyed by any conversion sequence |
| Reorder | Any permutation yields a valid, gap-free ordinal sequence |

**Time-zone cases, explicitly enumerated** (R-06): spring-forward, fall-back, southern-hemisphere
DST, a zero-offset zone, a half-hour-offset zone (`Asia/Kolkata`), `Asia/Kuala_Lumpur` for the pilot,
a trip crossing zones mid-day, and an overnight activity crossing midnight.

## 6. Integration tests

Against real PostgreSQL + PostGIS — never a mock database, because the things most worth testing
(RLS, PostGIS predicates, check constraints, partial unique indexes) do not exist in a mock.

Covers: migrations from clean, RLS policies, spatial queries and GiST index use, transactional
change-set application, optimistic concurrency conflicts, idempotency replay, the global rate limiter
holding **across two processes**, and retention sweeps actually deleting.

## 7. Contract tests

| Provider | Fixtures |
| --- | --- |
| OTP | Success, no-route, malformed, timeout, partial, missing optional fields, multi-operator transfer |
| Nominatim | Success, empty, rate-limited, malformed, slow |
| Open-Meteo | Success, empty, error |
| Wikimedia | Success, missing, licence-absent |
| GTFS-RT | Fresh, stale, silent, positions-only |

Every provider gets failure, timeout, empty, malformed, stale and rate-limited fixtures. The
malformed and missing-optional-field cases matter most: they prove that absent data stays absent
rather than being defaulted into a plausible lie.

## 8. End-to-end flows

1. Sign up → onboarding → create trip → coverage tier shown before planning
2. Set preferences → inheritance and override displayed correctly
3. Generate proposal → progress stages → diff review → **apply selected changes only**
4. Reorder a day → preview → only affected legs recalculate → conflict surfaced
5. Keyboard reorder achieving the identical result
6. Inspect transit steps → provenance visible → absent fields omitted
7. Share read-only → reader sees no private bookings → revoke → immediate loss of access
8. Offline: open cached trip → mark done → reconnect → reconcile → conflict diff
9. Zero-coverage destination → designed state with fallbacks, not an error
10. Two collaborators editing the same item → version conflict → diff, not overwrite

## 9. Visual regression

Desktop and mobile × light and dark × normal and reduced motion, plus: long-translation locales,
every empty state, every partial-data state, **greyscale rendering of all six confidence states**,
200% zoom, and 320px reflow.

## 10. Per-phase gates

| Phase | Gate |
| --- | --- |
| 1 | Migrations from clean; **all 10 RLS tests**; a11y on the shell; config fails loudly |
| 2 | Rate limiter holds across two processes; attribution asserted; no autocomplete endpoint exists |
| 3 | Contract tests pass **with no OTP running**; `REALTIME` unreachable in the pilot; LRT ↔ Komuter transfer routes |
| 4 | Full time-zone suite; incremental-recalculation assertion (≤4 boundaries); keyboard reorder parity |
| 5 | **Fabrication suite** — hard gate |
| 6 | Stale-detection via clock advance; no tile prefetch asserted; offline flow end to end |
| 7 | Authorization suite; money property tests |
| 8 | Full WCAG 2.2 AA manual audit; performance budgets; restore drill measured |

## 11. What is deliberately not tested heavily

Exact pixel values of decorative elements, third-party library internals, and provider availability
itself. Testing that OpenFreeMap is up tests someone else's infrastructure; testing that **we degrade
correctly when it is down** tests ours — and that is what the fixtures cover.
