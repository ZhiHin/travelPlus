# Phase 1 implementation backlog

**Status:** Phase 0 · 2026-08-19 · **Phase 1 is not started and must not begin without approval.**

Estimates are ideal engineering days for one senior engineer, excluding review and gate approval.

---

## 0. Blocking prerequisites

Phase 1 cannot start until these are resolved. Three need a human.

| ID | Prerequisite | Owner | Blocks |
| --- | --- | --- | --- |
| X-00 | **Install Docker Desktop** — absent on this host (probed 2026-08-19) | User | All of Phase 1 |
| X-06 | **Authorise `git init` and commits** — no repository exists | User | Version control for Phase 1 |
| X-07 | **Approve Phase 0** | User | Phase 1 start |
| X-08 | Enable pnpm via `corepack enable pnpm` | Engineer | P1-01 |

Java is **not** required on the host — OTP runs from its container image (verified 2026-08-19).

---

## 1. Phase 1 stories — Foundation · 24 ideal days

### P1-01 · Workspace, apps and shared packages · 3d

Set up the pnpm workspace with `apps/web`, `apps/worker` and the nine packages from
`11-MODULE-BOUNDARIES.md` §1.

**Acceptance criteria**
- `pnpm dev` starts web and worker with hot reload
- TypeScript strict mode passes with zero errors and zero `any` in `packages/domain`
- **The ESLint import-boundary rule fails the build when `packages/domain` imports React, Next, Drizzle, an HTTP client or `process.env`** — proven by a deliberately failing fixture in CI
- `pnpm typecheck`, `lint`, `format` and `verify` scripts exist and pass
- `.nvmrc` pins the Node version; exact versions are in the lockfile

### P1-02 · PostGIS via Docker Compose · 2d

**Acceptance criteria**
- `docker compose up -d postgres` yields a PostGIS-enabled database
- Image pinned to an exact digest — never `latest`
- Named volume persists across `docker compose down`
- PostGIS extension created by an init script, not manually
- Connection string documented for both the app and DBeaver

### P1-03 · Drizzle schema and SQL migration runner · 3d

**Acceptance criteria**
- `pnpm db:migrate` runs from a clean database and succeeds
- Migrations are forward-only, plain reviewable SQL
- Spatial columns, GiST indexes, check constraints, partial unique indexes and enums are hand-authored SQL
- `pnpm db:reset` and `db:seed` work
- **CI asserts a migrate-from-clean produces a schema matching the Drizzle definition** (drift check)
- UUIDv7 generation helper exists in the application layer and is unit-tested for ordering

### P1-04 · Authentication, sessions, reset · 5d

**Acceptance criteria**
- Argon2id hashing with documented parameters; password never logged
- Sessions store only a token **hash**; cookies `httpOnly`, `SameSite=Lax`, `Secure` outside local dev
- Idle and absolute expiry; rotation on privilege change
- **Sign-up and password-reset responses are identical in body, status and comparable in timing whether or not the email exists** — tested
- Per-account and per-IP throttling returning `retryAfterSeconds`
- CSRF double-submit token plus origin validation on every cookie-authenticated write
- Reset tokens are single-use and expiring, enforced by `consumed_at IS NULL` in the update predicate
- Email verification flow

### P1-05 · User preferences and privacy settings · 2d

**Acceptance criteria**
- The full preference model from `14-DATA-MODEL.md` §4.1 persists and round-trips
- `earliest_start < latest_finish` and `max_walk_per_leg <= max_walk_per_day` enforced (BR-P5, BR-P6)
- **Every privacy setting defaults to the restrictive value** (`19-PRIVACY-AND-RETENTION.md` §2) — tested on a freshly created user
- `ai_input_retention` is honoured in storage, not just in UI

### P1-06 · RLS roles, policies and session context · 3d

**Acceptance criteria**
- Three roles created: `travelplus_migrator`, `travelplus_app`, `travelplus_worker_sys`
- RLS **enabled and forced** on every tenant-scoped table
- `withUser()` sets `app.current_user_id` transaction-locally via `set_config(..., true)`
- **All 10 tests in `15-DATABASE-STRATEGY.md` §5 pass**, specifically including:
  - test 4 — a repository with its `WHERE` clause removed still returns zero cross-user rows
  - test 10 — `travelplus_app` is neither superuser nor owner of any RLS-protected table
- Null session context returns zero rows from every table
- `audit_events` has no `UPDATE`/`DELETE` grant to the app role

### P1-07 · Design tokens, shell, command pill, journey dock · 4d

**Acceptance criteria**
- Tokens implemented as CSS custom properties per `23-DESIGN-DIRECTION.md` §2
- **Light and dark are both designed**, with the route colour brightened on dark for contrast — not a mechanical inversion
- Route blue is reserved to verified transit; a lint or review gate prevents its use on buttons and links
- Command pill with `⌘K` palette and `/` search focus
- Journey dock is **one tab stop** with arrow-key navigation inside, and `aria-current` on the active section
- Theme-aware scrollbar via `scrollbar-width: thin` and `scrollbar-color`; never hidden on scrollable content
- `prefers-reduced-motion: reduce` sets all durations to 0 — verified by visual regression
- Skip link to the itinerary list precedes the map region
- Responsive shell at 320px, tablet and desktop with safe-area insets
- axe-core passes on the shell

### P1-08 · Config validation, health, logging · 2d

**Acceptance criteria**
- One Zod schema in `packages/config`; **`process.env` is read in exactly one file**, asserted by a grep check
- Startup fails with a message naming the offending variable when config is invalid
- **Startup fails if `NOMINATIM_USER_AGENT` lacks a contact address** — the policy requires identification (ADR-0011)
- `/api/health/live` returns `200` with no dependency checks
- `/api/health/ready` returns per-check detail; **`degraded` is a valid `200`**
- Structured JSON logs with dotted stable event names and a correlation ID threaded request → job → provider call
- Redaction layer strips known-sensitive keys before serialisation; coordinates rounded to ~1 km
- CI grep gate: no secret reaches `NEXT_PUBLIC_*` or the client bundle

---

## 2. Phase 1 gate

Phase 1 is complete only when **all** hold:

- [ ] Every acceptance criterion above is met
- [ ] `pnpm verify` passes: typecheck, lint, unit, integration, a11y
- [ ] Migrations run from a clean database, forward-only
- [ ] **No tests skipped** — a skipped test fails the gate
- [ ] No paid API is required by the documented local path
- [ ] No secrets or real personal data committed
- [ ] Accessibility verified on the shell: axe-core, keyboard walkthrough, screen reader
- [ ] Mobile states tested at 320px
- [ ] Documentation matches implemented behaviour
- [ ] Work committed **only if** the user has authorised commits

---

## 3. Recommended Phase 1 implementation order

Sequenced so that each step is verifiable before the next depends on it, and so the two riskiest
items (RLS, accessibility) land early rather than late.

```
1. P1-01  workspace + boundary lint      ← the boundary rule must exist before code accretes
2. P1-02  PostGIS container              ← unblocks everything data
3. P1-03  schema + migrations            ← schema before auth, since auth needs tables
4. P1-06  RLS roles + policies           ← BEFORE auth, so no code is ever written against an unprotected DB
5. P1-04  auth + sessions                ← first real feature, now on a protected foundation
6. P1-05  preferences + privacy defaults
7. P1-08  config + health + logging      ← in place before the UI needs debugging
8. P1-07  tokens + shell + dock          ← last, so a11y is tested against a real shell
```

Two orderings here are deliberate and differ from the obvious sequence:

**RLS before auth (4 before 5).** The intuitive order is auth first, then lock it down. That produces
a window in which repositories are written against an unprotected database, and those habits persist.
Building the protection first means every repository is written against forced RLS from its first
line.

**Shell last (8).** Doing UI first is tempting and produces a shell that gets retrofitted for
accessibility once real content exists. Building it last, against real auth and real data, means the
axe-core and keyboard gates run on something representative — R-12's mitigation only works if the
thing being tested is real.

---

## 4. Roadmap beyond Phase 1

Full story-level detail is deferred until each phase is approached. Sizes are indicative.

| Phase | Scope | Est |
| --- | --- | --- |
| 2 | Trip spaces, coverage tiers, geocoder abstraction, MapLibre + attribution, places | 27d |
| 3 | **KL pilot region**: OTP service, 4-feed graph build, normalized routing, scheduled semantics, partial states | 34d |
| 4 | Itinerary editor, scheduler, constraint engine, incremental rerouting, keyboard reorder | 30d |
| 5 | AI planner, pipeline, tool boundary, repair loop, **fabrication suite** | 36d |
| 6 | Realtime (validated on Portland), KL vehicle-position layer, Today mode, PWA offline | 28d |
| 7 | Bookings, budget, collaboration, sharing, export | 30d |
| 8 | Region operations, multi-region, performance, security, a11y and localization audits | 28d |

**Total including Phase 1: 237 ideal days** ≈ 18 calendar months for one engineer at a 60% focus
factor, or roughly 6–7 months for a team of three. Phase 3 grew by 2 days versus the earlier estimate
because the KL pilot ingests four feeds rather than one.

---

## 5. Cross-phase blocking tasks

| ID | Task | Blocks | Needs |
| --- | --- | --- | --- |
| X-00 | Install Docker Desktop | Phase 1 | **User** |
| X-01 | **Verify data.gov.my licence and attribution** — three URLs returned 404 | Phase 3 ingestion | **Human with a browser** |
| X-02 | Verify TriMet terms of use | Phase 6 realtime | Engineer |
| X-03 | Verify Mobility Database catalog terms | Phase 8 | Engineer |
| X-04 | Verify IANA time-zone package licence | Phase 1 | Engineer |
| X-05 | Choose Klang Valley OSM extract source and trim bbox | Phase 3 | Engineer |
| X-06 | Authorise `git init` and commits | Phase 1 | **User** |
| X-07 | Approve Phase 0 | Phase 1 | **User** |
| X-09 | **Confirm commercial intent** — Open-Meteo free tier excludes commercial use | Launch | **User** |
| X-10 | Verify whether Prasarana feeds populate `wheelchair_boarding` | Phase 3 a11y confidence | Engineer |

X-01 is the sharpest: the pilot region's feeds are **structurally un-ingestible** until a human
confirms the licence, because `transit_feeds.licence` is `NOT NULL` with no "unknown" value.
