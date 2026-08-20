# Project status

**Last updated:** 2026-08-20
**Current phase:** Phase 1 — Foundation, **in progress**
**Blocking:** **Windows restart required** before Docker can run. See §Blocker.

## Phase state

| Phase | State | Commit |
| --- | --- | --- |
| 0 — Discovery and specification | **Complete, approved, pushed** | `3fc8743` |
| 1 — Foundation | **In progress** — 4 of 8 stories done, 4 written but unrunnable | `73eb391`, `5d84f6b`, `c5b0b81` |
| 2–8 | Not started | — |

## Product name

Renamed from the **TripWeave** working title to **TravelPlus** on 2026-08-20 (ADR-0024).
27 occurrences across 11 files, including database role names (`travelplus_app`,
`travelplus_migrator`, `travelplus_worker_sys`) and provider user-agent strings. Third-party
provider names and external feed identifiers were deliberately left unchanged.

## Environment installed (2026-08-20)

| Component | Version | State |
| --- | --- | --- |
| Windows | 11 Home, build 26200, x64 | — |
| CPU / RAM / disk | i7-10750H 6C/12T / 15.8 GB / 72.5 GB free | Sufficient |
| Virtualization in firmware | Enabled (`VirtualizationFirmwareEnabled=True`, SLAT=True) | **No BIOS change needed** |
| **WSL** | Default version 2 | **Installed — inert until restart** |
| VirtualMachinePlatform | **Enabled** | **Inert until restart** |
| **Docker Desktop** | 4.87.0, per-user at `%LOCALAPPDATA%\Programs\DockerDesktop` | **Installed — daemon blocked on WSL** |
| Docker client | 29.7.2 | Installed |
| Docker Compose | v5.4.0 | Installed |
| Node.js | v24.18.0 | Working |
| pnpm | 11.22.0 (corepack, user-scoped at `%LOCALAPPDATA%\npm-global`) | Working |
| Git | 2.55.0.windows.2 | Working, pushes verified |

Docker Desktop was installed from the official `desktop.docker.com` installer, SHA256-verified
against Docker's published hash, with a valid Authenticode signature from `CN=Docker Inc`.
Installed **without** `--accept-license`, so the Docker Subscription Service Agreement is
presented at first launch rather than accepted on the owner's behalf.

## Blocker — Windows restart required

`wsl --install --no-distribution` completed successfully and `VirtualMachinePlatform` is
**Enabled**, but Windows only loads the hypervisor at boot. The machine has not restarted since
15 August, so the feature is enabled on disk and inert in memory:

```
HypervisorPresent : False
WSL2 is unable to start since virtualization is not enabled on this machine.
```

Docker Desktop reports this as "Virtualization support not detected", which is misleading — the
hardware is fine and no BIOS change is needed. Everything requiring PostgreSQL/PostGIS or
OpenTripPlanner is blocked until the restart.

**Resume procedure**

1. Save open work and **restart** Windows (use Restart, not Shut down — Fast Startup can skip the
   kernel init that loads the hypervisor).
2. Launch Docker Desktop from the Start menu.
3. **Accept the Docker Subscription Service Agreement** when shown — deliberately left to the owner.
4. Wait for the whale icon to report "Engine running".
5. Verify: `wsl --status`, `docker version`, `docker compose version`, `docker info`,
   `docker run --rm hello-world`.
6. Resume the agent session with: *"Docker is running, continue Phase 1 from P1-02."*

## Phase 1 progress

| Story | State | Evidence |
| --- | --- | --- |
| P1-01 workspace, apps, shared packages | **Done** | Boundary rule proven by 13 executable fixtures; typecheck exit 0 |
| P1-02 PostGIS via Docker Compose | **Written, unrun** | `docker-compose.yml` + init SQL complete. Needs the daemon |
| P1-03 Drizzle schema and migrations | **Written, unrun** | `0001_foundation.sql` (10 tables) + UUIDv7 helper, 10 tests |
| P1-04 auth and sessions | **Blocked** | Needs a running database |
| P1-05 preferences and privacy defaults | **Written, unrun** | Schema encodes restrictive defaults and BR-P5/P6 check constraints |
| P1-06 RLS roles and policies | **Written, unrun** | Policies in the migration; `withUser()` complete, 8 tests |
| P1-07 design tokens, shell, dock | **Done** | Production build green; a11y markup verified in rendered HTML |
| P1-08 config validation, health, logging | **Done** | 13 config + 16 logger tests; both health endpoints verified live |

### Verified — commands actually run

```
pnpm verify   exit 0    format + lint + typecheck + tests
pnpm test     exit 0    118 tests, 9 files, 0 skipped
next build    exit 0    4 routes, 104 kB first load
```

| Suite | Tests | Covers |
| --- | --- | --- |
| `domain/status` | 13 | BR-T5/T6/T7 — **a positions-only feed can never yield `REALTIME`** at any offset (ADR-0022) |
| `domain/money` | 20 | BR-M5/M6 — splits conserve every minor unit across ~1,000 combinations, refunds included |
| `domain/time` | 13 | BR-TZ3/4/5/8 — DST both hemispheres, half-hour offsets, KL day boundaries |
| `domain/route` | 12 | The live-badge gate; absent fields stay absent |
| `domain/id` | 10 | UUIDv7 ordering, including across the 2^32 millisecond boundary |
| `config/env` | 13 | Startup refuses a placeholder or contact-less provider User-Agent |
| `config/logger` | 16 | Redaction at any depth; coordinates coarsened to ~1 km |
| `db/session` | 8 | `set_config(..., true)` is transaction-local, not session-leaking |
| `test-utils/boundaries` | 13 | Hostile imports rejected through the real lint config |

Live checks against a running server: `/api/health/live` returned 200 `{"status":"ok"}`;
`/api/health/ready` returned 200 `degraded` with per-check detail; rendered HTML confirmed the skip
link, nav landmark, `aria-current`, roving tabindex, `lang`, and six confidence badges with ages.

**No tests are skipped.**

## What is staged and waiting on Docker

Written, reviewable, and unrunnable until the daemon starts:

- `docker-compose.yml` — PostGIS 17-3.5, OTP 2.8.1, Ollama, all pinned; the Postgres healthcheck
  requires the `postgis` extension to exist, not merely `pg_isready`
- `infra/docker/postgres-init/01-extensions-and-roles.sql` — extensions plus the three roles; the
  app role is deliberately neither superuser nor owner, which is what makes forced RLS bind
- `packages/db/migrations/0001_foundation.sql` — 10 tables, enums, check constraints, and RLS
  enabled **and forced** with `USING` plus `WITH CHECK` on every tenant table

## Open items requiring the owner

| ID | Item |
| --- | --- |
| **X-00** | **Restart Windows**, then launch Docker Desktop and accept the DSSA |
| X-01 | **Verify the data.gov.my licence** — three URLs returned 404; pilot feeds cannot be ingested until confirmed (R-17) |
| X-09 | **Confirm commercial intent** — Open-Meteo's free tier excludes commercial products |

## Phase completion definition (applies to every phase)

A phase is complete only when: acceptance criteria are met; typecheck, lint, unit, integration and
relevant E2E tests pass; migrations run from a clean database, forward only; no paid API is required
by the documented local path; no secrets or real personal data are committed; accessibility and
mobile states are tested; provider attribution, licence, freshness and error behaviour are visible
and documented; documentation matches implemented behaviour; no mock data is presented as live data;
and work is committed only with the owner's authorisation.
