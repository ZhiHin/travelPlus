# Business rules and validation rules

**Status:** Phase 0 · 2026-08-19

Rules are numbered for traceability. Each states **where it is enforced** — a rule enforced only in
the UI is not enforced.

---

## 1. Truth and provenance rules (highest precedence)

These override every other rule in this document.

| ID | Rule | Enforced at |
| --- | --- | --- |
| BR-T1 | No transport fact may be persisted or rendered unless it originated in a provider response | Schema: `transit_segments` written only by the routing adapter |
| BR-T2 | The LLM's output schema contains no transport fields | Zod `CandidateActivity` |
| BR-T3 | Every route result carries router region, feed versions, `retrieved_at` and a status | `route_snapshots` NOT NULL columns |
| BR-T4 | A field absent from the provider response is stored NULL and **omitted** from render | Nullable columns + UI narrowing |
| BR-T5 | Status is derived on read, never stored as a static label | Domain function over `retrieved_at` + feed freshness |
| BR-T6 | `REALTIME` requires a successful realtime fetch inside the feed's freshness window | Domain |
| BR-T7 | A feed publishing vehicle positions but not trip updates can never yield `REALTIME` | Feed capability flag |
| BR-T8 | An estimate is never labelled as a confirmed fare, platform, opening hour or availability | Six-status vocabulary |
| BR-T9 | "Sources checked" is projected from `ai_tool_events`; it cannot be asserted otherwise | Read model |
| BR-T10 | A candidate that fails place resolution is shown but cannot be applied automatically | Change-set apply service |

## 2. Trip rules

| ID | Rule | Enforced at |
| --- | --- | --- |
| BR-TR1 | `end_date >= start_date` | DB check + Zod |
| BR-TR2 | A trip has exactly one owner at all times | Partial unique index |
| BR-TR3 | An owner cannot leave without transferring ownership | Service |
| BR-TR4 | Destination coverage tier is derived server-side; never client-set | Service; field not writable |
| BR-TR5 | Duplicating copies structure, places and preferences — never route snapshots or bookings | Service |
| BR-TR6 | Archived trips are read-only until restored | Service |
| BR-TR7 | Soft-deleted trips are excluded from all list queries and remain restorable for the retention window | Repository predicate |
| BR-TR8 | Trip `version` increments in the same transaction as any write to it | Transaction |

## 3. Preference resolution rules

| ID | Rule | Enforced at |
| --- | --- | --- |
| BR-P1 | Effective value = trip override if non-null, else profile default | Domain resolver |
| BR-P2 | Setting a trip override to null restores inheritance | Service |
| BR-P3 | The API returns both the resolved value **and** its source, so the UI can explain which won | `16-API-CONTRACTS.md` §4 |
| BR-P4 | Changing preferences never mutates an existing itinerary; it affects the next plan or replan | Service |
| BR-P5 | `earliest_start < latest_finish` | Zod + DB check |
| BR-P6 | `max_walk_meters_per_leg <= max_walk_meters_per_day` | Zod |
| BR-P7 | A preference set admitting no valid plan produces an explanation naming the blocking constraint, not a silent empty result | Constraint engine |

## 4. Itinerary and scheduling rules

| ID | Rule | Enforced at |
| --- | --- | --- |
| BR-I1 | `end_instant > start_instant` | DB check |
| BR-I2 | `ordinal` is unique per day among non-deleted items | Partial unique index |
| BR-I3 | `lock_item` implies `lock_time` and `lock_place` | DB check — an inconsistent lock state is unrepresentable |
| BR-I4 | A locked item is never moved by automated replanning | Scheduler |
| BR-I5 | Moving an item flagged important requires explicit confirmation | Service + UI |
| BR-I6 | Only legs adjacent to a change are recalculated — at most four boundaries per reorder | Scheduler; asserted by counting routing calls |
| BR-I7 | A change is previewed with its consequences before commit | API `preview=true` |
| BR-I8 | A commit creating a conflict succeeds **with the conflict shown**; conflicts are never auto-resolved | Service |
| BR-I9 | Every applied change set writes a new version in the same transaction | Transaction |
| BR-I10 | Restoring a version creates a new version; history is never rewritten | Service |
| BR-I11 | Scheduling arithmetic uses routed durations, never model-supplied durations | Scheduler |
| BR-I12 | An item whose place was deleted or merged keeps its slot and is flagged for resolution | Service |

## 5. Time rules

| ID | Rule | Enforced at |
| --- | --- | --- |
| BR-TZ1 | Instants stored as `timestamptz` in UTC | Schema |
| BR-TZ2 | Future wall-clock intentions additionally store local date, local time and IANA zone | Schema |
| BR-TZ3 | A local datetime submitted without a zone is rejected | Zod → `MISSING_TIMEZONE` |
| BR-TZ4 | A local time that occurs twice (DST fall-back) is rejected with both candidate instants | `AMBIGUOUS_LOCAL_TIME` |
| BR-TZ5 | A local time that does not exist (DST spring-forward) is rejected with a suggested valid time | `NONEXISTENT_LOCAL_TIME` |
| BR-TZ6 | Display defaults to the destination's zone, with an explicit control for home zone | UI |
| BR-TZ7 | Coordinate-to-zone resolution uses a local dataset; never a network call | `integrations` |
| BR-TZ8 | A day boundary is the local calendar date in the destination zone, not UTC midnight | Domain |

BR-TZ4 and BR-TZ5 exist because silently choosing an interpretation is how a traveller misses a
flight. Rejecting with both options is more useful than guessing.

## 6. Money rules

| ID | Rule | Enforced at |
| --- | --- | --- |
| BR-M1 | Amounts are `numeric(18,4)` with an ISO 4217 code; never floating point | Schema |
| BR-M2 | Amounts in different currencies are never summed without an explicit conversion | Domain |
| BR-M3 | A conversion carries rate, rate date and rate source | `exchange_rate_snapshots` |
| BR-M4 | A `MANUAL` rate is never displayed as live | UI + status vocabulary |
| BR-M5 | Splits are computed in integer minor units and sum **exactly** to the total | Domain + DB check + property test |
| BR-M6 | The remainder minor unit is assigned deterministically, never dropped | Domain |
| BR-M7 | Exceeding budget produces a warning, never a rejection | Service — it is the user's money |
| BR-M8 | Transit fares are `UNAVAILABLE` unless a feed supplied them; never estimated | BR-T8 |

## 7. Place rules

| ID | Rule | Enforced at |
| --- | --- | --- |
| BR-PL1 | Every place has at least one `place_sources` row | Service |
| BR-PL2 | `(provider, source_id)` is unique — the primary duplicate guard | Unique index |
| BR-PL3 | Secondary duplicate detection uses spatial proximity plus name similarity when no source ID exists | Service |
| BR-PL4 | Detecting a duplicate returns the existing place rather than silently creating a second | Service |
| BR-PL5 | Opening-hour confidence is `FEED`, `PARSED`, `USER` or `UNKNOWN`; `UNKNOWN` never renders as "open" | Schema + UI |
| BR-PL6 | A `PLACE_CLOSED` conflict is raised only when confidence is `FEED` | Constraint engine |
| BR-PL7 | Imagery retains author, licence, attribution and source URL, and is never hotlinked contrary to licence | Schema |

## 8. Routing rules

| ID | Rule | Enforced at |
| --- | --- | --- |
| BR-R1 | Exactly one of `depart_at` / `arrive_by` per request | DB check + Zod |
| BR-R2 | Region resolved from coordinates before calling the router | Routing package |
| BR-R3 | Coordinates outside every region return `REGION_NOT_COVERED`, not an error | Service |
| BR-R4 | "No route found" (`200` + `UNAVAILABLE`) is distinct from "provider down" (`503`) | Circuit breaker |
| BR-R5 | Route snapshots are immutable; recalculation writes a new row | No `updated_at` column |
| BR-R6 | Accessibility `UNKNOWN` is distinct from "not accessible" | Separate violation codes |
| BR-R7 | A step-free requirement with no accessible route says so; it never routes someone up stairs silently | Constraint engine |
| BR-R8 | Malformed or hostile router responses fail normalization and surface as `UNAVAILABLE` | Adapter |

## 9. AI planning rules

| ID | Rule | Enforced at |
| --- | --- | --- |
| BR-AI1 | Model output is Zod-validated before touching domain code | `packages/ai` |
| BR-AI2 | Validation failure triggers exactly one structured retry, then a safe failure | Pipeline |
| BR-AI3 | Model prose is never parsed with regular expressions | Code review + lint |
| BR-AI4 | At most two repair attempts, each rerouted and revalidated | `ai_planning_jobs.repair_attempts` |
| BR-AI5 | The repair loop receives only minimal structured failures — not the itinerary, not user data | Pipeline |
| BR-AI6 | Untrusted text is delimited and labelled as data, never placed in the instruction channel | Prompt construction |
| BR-AI7 | Tools re-validate input and re-authorize against the session actor | Tool boundary |
| BR-AI8 | Secrets are redacted and personal data minimised before every model call | Pipeline |
| BR-AI9 | Temperature is 0 and the schema is repeated in-prompt, because structured output is best-effort, not guaranteed | Config — see `08-PROVIDER-MATRIX.md` §2.9 |
| BR-AI10 | Chain-of-thought is never exposed; only stage names and counters | API projection |

## 10. Validation rule summary

| Input | Rule |
| --- | --- |
| Email | Normalised, `citext`, RFC-shaped; existence never disclosed |
| Password | Minimum length and breach-list check; never logged |
| Dates | ISO-8601; ranges ordered; local times require a zone |
| Coordinates | lon ∈ [-180, 180], lat ∈ [-90, 90]; rejected outside |
| Currency | ISO 4217 allow-list |
| Money | `numeric`, non-negative for expenses, scale ≤ 4 |
| Duration | Positive integer seconds, bounded to a sane per-item maximum |
| Text | Length-bounded; rich text sanitised on write **and** on render |
| URLs | Stored and rendered, **never fetched server-side** |
| Enums | Postgres enum types, so an invalid status is unwritable |
| Unknown fields | Rejected, not silently ignored — blocks mass assignment |
| Idempotency key | Required on the five retry-prone writes; reuse with a different body is a conflict |
