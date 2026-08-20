# Project status

**Last updated:** 2026-08-20
**Current phase:** Phase 1 — Foundation, **COMPLETE**. Phase 2 next.
**Blocking:** none. Docker verified running 2026-08-20 21:43.

## Phase state

| Phase | State | Commit |
| --- | --- | --- |
| 0 — Discovery and specification | **Complete, approved, pushed** | `3fc8743` |
| 1 — Foundation | **Complete** — all 8 stories, gate met | `73eb391`…`1d240db` |
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
| **WSL** | Default version 2, distro `docker-desktop` | **Active** |
| VirtualMachinePlatform | **Enabled** | **Active** (`HypervisorPresent: True`) |
| **Docker Desktop** | 4.87.0, per-user at `%LOCALAPPDATA%\Programs\DockerDesktop` | **Installed — daemon blocked on WSL** |
| Docker client | 29.7.2 | Working |
| Docker Compose | v5.4.0 | Working |
| Node.js | v24.18.0 | Working |
| pnpm | 11.22.0 (corepack, user-scoped at `%LOCALAPPDATA%\npm-global`) | Working |
| Git | 2.55.0.windows.2 | Working, pushes verified |

Docker Desktop was installed from the official `desktop.docker.com` installer, SHA256-verified
against Docker's published hash, with a valid Authenticode signature from `CN=Docker Inc`.
Installed **without** `--accept-license`, so the Docker Subscription Service Agreement is
presented at first launch rather than accepted on the owner's behalf.

## Blocker — RESOLVED 2026-08-20

The pending Windows restart is done. `HypervisorPresent: True`, WSL 2 backend active,
Docker client and server both 29.7.2, `docker run --rm hello-world` exit 0.

**One environment conflict found and worked around:** a native `postgresql-x64-17` service already
holds port 5432 on this machine, so host connections were silently reaching *that* server and failing
authentication. TravelPlus now maps Postgres to **5433** by default. The existing installation was
left untouched — override with `POSTGRES_PORT` if 5433 is also taken.

## Phase 1 progress

| Story | State | Evidence |
| --- | --- | --- |
| P1-01 workspace, apps, shared packages | **Done** | Boundary rule proven by 13 executable fixtures; typecheck exit 0 |
| P1-02 PostGIS via Docker Compose | **Done** | Container healthy; healthcheck requires the `postgis` extension, not just `pg_isready` |
| P1-03 Drizzle schema and migrations | **Done** | Migrate-from-clean verified by destroying the volume and rebuilding |
| P1-04 auth and sessions | **Done** | Argon2id, opaque tokens, CSRF, throttling — 30 integration tests |
| P1-05 preferences and privacy defaults | **Done** | Restrictive defaults asserted on a freshly created account |
| P1-06 RLS roles and policies | **Done** | **All 22 RLS integration tests pass against real PostgreSQL** |
| P1-07 design tokens, shell, dock | **Done** | Production build green; a11y markup verified in rendered HTML |
| P1-08 config validation, health, logging | **Done** | 13 config + 16 logger tests; both health endpoints verified live |

### Verified — commands actually run

```
pnpm verify            exit 0    format + lint + typecheck + tests
pnpm test              exit 0    189 unit tests, 12 files, 0 skipped
pnpm test:integration  exit 0     52 tests (30 auth + 22 RLS) against real PostgreSQL
next build             exit 0    4 routes, 104 kB first load
docker run hello-world exit 0    Docker daemon verified
pnpm db:migrate        exit 0    applied 0001_foundation.sql from a clean volume
```

**241 tests total, 0 skipped.**

### RLS gate — verified against a real database

All 22 tests pass as the real `travelplus_app` role, with the real migration applied. The ones that
matter most:

| Test | Result |
| --- | --- |
| 4 — a query with **no `WHERE` clause at all** (`SELECT id FROM trips`) | Returns zero cross-user rows |
| 5 — no session context set | Zero rows from all five tenant tables |
| 9 — `UPDATE`/`DELETE` on `audit_events` | `permission denied` — append-only holds |
| 10 — `travelplus_app` is superuser? owns tables? | `false`, and owns **0** tables |
| 10 — RLS `ENABLE` **and** `FORCE` on all 8 tenant tables | Both true on all 8 |

Test 10 protects the mechanism itself: `FORCE` does not apply to a table's owner and a superuser
bypasses RLS entirely, so a future migration granting either would silently disable every policy
while the other tests kept passing.

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

## Open items requiring the owner

| ID | Item |
| --- | --- |
| ~~X-00~~ | ~~Restart Windows and start Docker~~ — **done 2026-08-20** |
| X-01 | **Verify the data.gov.my licence** — three URLs returned 404; pilot feeds cannot be ingested until confirmed (R-17) |
| X-09 | **Confirm commercial intent** — Open-Meteo's free tier excludes commercial products |

## Phase completion definition (applies to every phase)

A phase is complete only when: acceptance criteria are met; typecheck, lint, unit, integration and
relevant E2E tests pass; migrations run from a clean database, forward only; no paid API is required
by the documented local path; no secrets or real personal data are committed; accessibility and
mobile states are tested; provider attribution, licence, freshness and error behaviour are visible
and documented; documentation matches implemented behaviour; no mock data is presented as live data;
and work is committed only with the owner's authorisation.
