# Phase 1 — Foundation

**Status:** Complete · 2026-08-20
**Gate:** Met — see §7
**Commits:** `73eb391` → `eec7ff3` (6 commits)
**Tests:** 241 passing, 0 skipped

---

## 1. What Phase 1 was for

Phase 1 builds nothing a user can see. Its job is to make the later phases
*possible to get right*: a workspace where module boundaries are enforced by a
machine rather than by good intentions, a database where a forgotten `WHERE`
clause cannot leak another user's trip, and a set of domain rules that encode the
product's central claim as executable tests rather than prose.

The bet is that four of these decisions — the boundary lint, forced RLS, the
feed-capability flag, and injectable clocks — will each prevent a class of bug
that would otherwise be discovered in production.

## 2. Stories delivered

| ID | Story | State | Evidence |
| --- | --- | --- | --- |
| P1-01 | Workspace, apps, shared packages | Done | Boundary rule proven by 13 executable fixtures |
| P1-02 | PostGIS via Docker Compose | Done | Container healthy; healthcheck requires the extension itself |
| P1-03 | Drizzle schema and migration runner | Done | Migrate-from-clean verified by destroying the volume |
| P1-04 | Authentication and sessions | Done | 30 integration tests incl. timing-oracle defence |
| P1-05 | Preferences and privacy defaults | Done | Restrictive defaults asserted on a fresh account |
| P1-06 | RLS roles and policies | Done | All 22 RLS tests against real PostgreSQL |
| P1-07 | Design tokens, shell, journey dock | Done | Production build green; a11y verified in rendered HTML |
| P1-08 | Config validation, health, logging | Done | Startup refuses a placeholder provider User-Agent |

## 3. File inventory

Every source file created in Phase 1, what it is for, and how it is verified.

### `packages/domain` — entities and rules, no framework, no I/O

| File | Lines | Purpose | Tests |
| --- | --- | --- | --- |
| `status.ts` | 128 | Confidence derivation. `deriveTransitStatus` is pure and takes `now` as a parameter, so the `REALTIME → STALE` transition is testable by advancing time alone | 13 |
| `money.ts` | 149 | Integer-minor-unit arithmetic and split apportionment. No float ever touches a monetary value | 20 |
| `time.ts` | 162 | Wall-clock ↔ instant resolution against the platform IANA database. Reports ambiguous and nonexistent local times rather than guessing | 13 |
| `route.ts` | 143 | The provider-neutral route model. `realtime`, `platform` and `stopCode` are optional with no default | 12 |
| `id.ts` | 91 | UUIDv7 generation with injectable clock and randomness | 10 |
| `auth.ts` | 224 | Session lifetimes, throttle backoff, token verdicts, password policy — every rule that *decides* something | 26 |
| `platform.d.ts` | 17 | The complete inventory of platform capabilities the domain assumes (Web Crypto only) | — |
| `index.ts` | 12 | Public surface | — |

### `packages/config` — the only reader of `process.env`

| File | Lines | Purpose | Tests |
| --- | --- | --- | --- |
| `index.ts` | 128 | Zod-validated environment. Refuses a provider User-Agent without a contact address, and a geocoder rate above the 1 req/s policy | 13 |
| `logger.ts` | 145 | Structured JSON logging with redaction at serialisation and coordinate coarsening | 16 |

### `packages/db` — schema, migrations, RLS, session context

| File | Lines | Purpose | Tests |
| --- | --- | --- | --- |
| `migrations/0001_foundation.sql` | 343 | 10 tables, 10 enums, check constraints, RLS enabled **and forced**, grants | 22 (itest) |
| `client.ts` | 83 | Pool-bound `withUser` / `withoutUser`, split app and system connections | — |
| `session.ts` | 65 | The generic session-context logic `client.ts` delegates to | 8 |
| `migrate.ts` | 114 | Forward-only runner with checksums and an advisory lock | — |
| `bin/migrate.mjs` | 22 | CLI entry for `pnpm db:migrate` | — |
| `rls.itest.ts` | 262 | The Phase 1 security gate, against real PostgreSQL | 22 |

### `apps/web` — shell, design system, auth services

| File | Lines | Purpose | Tests |
| --- | --- | --- | --- |
| `styles/tokens.css` | 110 | Design tokens. Route blue reserved to verified transit; dark theme designed, not inverted | — |
| `styles/global.css` | ~95 | Reset, focus, skip link, theme-aware scrollbar | — |
| `components/JourneyDock.tsx` | ~110 | Floating dock. One tab stop with roving tabindex | — |
| `components/ConfidenceBadge.tsx` | ~70 | Status in three non-colour channels plus colour | — |
| `app/layout.tsx` | ~55 | Root layout, fonts, viewport permitting 5× zoom | — |
| `app/page.tsx` | ~80 | Phase 1 shell rendering all six confidence states | — |
| `app/api/health/live/route.ts` | ~15 | Liveness. Deliberately checks no dependencies | — |
| `app/api/health/ready/route.ts` | ~40 | Readiness with per-check detail; `degraded` is a valid 200 | — |
| `server/auth/crypto.ts` | ~120 | Argon2id, opaque tokens, constant-time comparison | 22 |
| `server/auth/service.ts` | ~290 | Sign-up, sign-in, sessions, verification, reset | 30 (itest) |
| `server/auth/http.ts` | 193 | Cookies, CSRF double-submit, throttle store | 23 |
| `server/auth/auth.itest.ts` | ~330 | Auth flows against real PostgreSQL | 30 |

### `packages/test-utils` and root configuration

| File | Lines | Purpose | Tests |
| --- | --- | --- | --- |
| `boundaries.test.ts` | 116 | Lints hostile source through the real project config and asserts rejection | 13 |
| `eslint.config.js` | 148 | MB-1/MB-2/MB-3 encoded as build-failing rules | — |
| `docker-compose.yml` | ~95 | PostGIS 17-3.5, OTP 2.8.1, Ollama — all pinned | — |
| `infra/docker/postgres-init/01-*.sql` | 62 | Extensions and the three roles | — |

## 4. The four decisions that carry the most weight

### 4.1 Module boundaries enforced by a machine

`packages/domain` has **no `@types/node` and no DOM lib**, so `fs`, `process` and
`window` are type errors there rather than discouraged practices. `platform.d.ts`
declares the single capability it does use — Web Crypto's `getRandomValues` — which
makes that an explicit, reviewable inventory: anything the domain touches beyond
pure computation has to be added there first, and that shows up in a diff.

On top of that, 13 fixtures lint deliberately hostile source (React, Next,
Drizzle, `pg`, axios, node builtins, `process.env`, inward-only imports) through
the **real** project config and assert it is rejected. A lint config nobody
exercises is one that silently stops working.

### 4.2 RLS enabled *and forced*, with the app role owning nothing

`ENABLE ROW LEVEL SECURITY` alone does not apply to a table's owner, and a
superuser bypasses RLS entirely. Both are easy to get wrong in a way that leaves
every policy looking correct while restraining nothing.

So `travelplus_app` is asserted to be neither superuser nor owner of any table,
and all 8 tenant tables are asserted `ENABLE` **and** `FORCE`. That is RLS test
10, and it protects the mechanism rather than the data — without it, a future
migration could disable every policy while the other 21 tests kept passing.

Test 4 is the one that proves the point: a query with **no `WHERE` clause at
all** still returns zero cross-user rows.

### 4.3 Feed capability, not a `hasRealtime` boolean

Malaysia publishes GTFS-Realtime **VehiclePosition only**, and VehiclePosition
carries no predicted stop times. "Has a realtime feed" and "can predict a
departure" are different claims, and the obvious implementation conflates them.

`FeedCapabilities.tripUpdates` separates them. `deriveTransitStatus` returns
`SCHEDULED` for a positions-only feed regardless of freshness, and a test asserts
`REALTIME` is unreachable at *any* time offset. `canShowLive` additionally
requires a prediction to be present on the leg, so presenting scheduled data
under a live label is not expressible in the type system.

### 4.4 Injected clocks

`deriveTransitStatus`, `evaluateSession`, `evaluateToken` and `uuidv7` all take
time as a parameter. That is what makes "the badge goes stale with no new data
arriving" and "the session expires absolutely despite constant activity" testable
at all, rather than aspirational.

## 5. Problems found and how they were resolved

| Problem | Resolution |
| --- | --- |
| **Windows never cold-booted.** Fast Startup hibernates the kernel, so `VirtualMachinePlatform` stayed inert through a shutdown and a power-on | Forced restart. Hardware was fine throughout — `VT-x: True`, `SLAT: True`; no BIOS change needed |
| **Native `postgresql-x64-17` holds port 5432.** Host connections silently reached *that* server and failed auth with correct credentials | Moved TravelPlus to **5433**. The existing installation was left untouched |
| `corepack enable` hit EPERM on `C:\Program Files\nodejs` | pnpm installed to a user-writable directory instead |
| pnpm 11 errors rather than warns on skipped build scripts | `strictDepBuilds: false` with an explicit `onlyBuiltDependencies` allow-list |
| Next could not resolve ESM `.js` specifiers to `.ts` source | `resolve.extensionAlias` in `next.config.mjs` |
| Duplicate `withUser` in `client.ts` and `session.ts` | `client.ts` delegates to the unit-tested `session.ts` — one implementation to get right |
| RLS test teardown failed on `trips_owner_id_fkey ON DELETE RESTRICT` | Fixed the cleanup, **not** the constraint — the schema was correctly refusing to orphan a trip |

## 6. Deliberate limitations, recorded not hidden

| Limitation | Why | When it must change |
| --- | --- | --- |
| Throttle store is **in-memory, single-process** | Adequate for a dev stack | Multi-instance deployment — an attacker multiplies their budget by instance count. Needs the database-backed approach used for the geocoder limiter |
| `/api/health/ready` reports `unconfigured`, not `ok` | Those subsystems genuinely do not exist yet | Phases 2–5, as each lands |
| Only 10 of the 48 modelled tables exist | Phase 1 needs identity, preferences and a trip shell | Phase 2 onward |
| RLS tests 7 and 8 assert absence, not behaviour | `invitations` and `share_tokens` are Phase 7 tables | Phase 7 |
| No MFA | Email/password MVP, no payment data held | Before public launch |
| `style-src 'unsafe-inline'` | Tailwind and MapLibre ergonomics | Phase 8 hardening |

## 7. Gate verification

Commands run, with their actual exit codes:

```
pnpm verify             exit 0    format + lint + typecheck + 189 unit tests
pnpm test:integration   exit 0    52 tests (30 auth + 22 RLS), real PostgreSQL
next build              exit 0    4 routes, 104 kB first load
docker run hello-world  exit 0    daemon verified
pnpm db:migrate         exit 0    applied from a destroyed volume
```

| Gate condition | Met | How |
| --- | --- | --- |
| All acceptance criteria | ✅ | §2 |
| Typecheck, lint, unit, integration pass | ✅ | Above |
| Migrations run from a clean database, forward only | ✅ | Volume destroyed and rebuilt |
| **No tests skipped** | ✅ | 241 run, 0 skipped |
| No paid API on the documented local path | ✅ | `AI_PROVIDER` defaults to `fake` |
| No secrets committed | ✅ | Scanned each commit; `.env` gitignored and verified |
| Accessibility verified | ✅ | Skip link, nav landmark, `aria-current`, roving tabindex, `lang` confirmed in rendered HTML |
| Mobile states tested | ✅ | 320px reflow in tokens and component CSS |
| Documentation matches behaviour | ✅ | This document and `../PROJECT_STATUS.md` |
| No mock data presented as live | ✅ | Health checks report `unconfigured` |

## 8. Test distribution

| Suite | Tests | What it protects |
| --- | --- | --- |
| `domain/auth` | 26 | Session lifetimes, throttle backoff, token replay, password policy |
| `domain/money` | 20 | Unit conservation across ~1,000 amount/part combinations |
| `auth/http` | 23 | Cookie attributes, CSRF double-submit, throttle keys |
| `auth/crypto` | 22 | Argon2id, timing-oracle defence, token entropy |
| `domain/status` | 13 | **A positions-only feed can never yield `REALTIME`** |
| `domain/time` | 13 | DST both hemispheres, half-hour offsets, KL day boundaries |
| `config/env` | 13 | Startup refuses a contact-less provider User-Agent |
| `test-utils/boundaries` | 13 | Hostile imports rejected through the real lint config |
| `domain/route` | 12 | The live-badge gate; absent fields stay absent |
| `config/logger` | 16 | Redaction at depth; coordinates coarsened to ~1 km |
| `domain/id` | 10 | UUIDv7 ordering across the 2³² ms boundary |
| `db/session` | 8 | `set_config(..., true)` is transaction-local |
| **`auth.itest`** | **30** | Enumeration resistance, sessions, tokens — real database |
| **`rls.itest`** | **22** | The security gate — real database |
| | **241** | |

## 9. Commits

| Commit | Content |
| --- | --- |
| `73eb391` | Workspace, domain rules, validated config |
| `5d84f6b` | Module boundaries, database layer, Compose stack |
| `c5b0b81` | App shell, design tokens, health endpoints |
| `46af496` | Structured logging with redaction |
| `1d240db` | Migration runner and RLS gate verified |
| `eec7ff3` | Phase 1 complete — authentication |

## 10. What Phase 2 inherits

- A workspace where a boundary violation fails the build
- A database where forced RLS is proven, not assumed
- Authentication, so trips can have owners and members
- A design system and shell, so new screens start from tokens
- `241` tests that will catch a regression in any of the above

Phase 2 adds trip CRUD, coverage-tier resolution, the geocoder abstraction with
its **database-backed** 1 req/s limiter, MapLibre with attribution, and places
with duplicate detection.
