# Project status

**Last updated:** 2026-08-20
**Current phase:** Phase 1 — Foundation, **in progress**
**Blocking:** **Windows restart required** before Docker can run. See §Blocker.

## Phase state

| Phase | State | Commit |
| --- | --- | --- |
| 0 — Discovery and specification | **Complete, approved, pushed** | `3fc8743` |
| 1 — Foundation | **In progress** — 3 of 8 stories done | pending |
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
| Virtualization in firmware | Enabled | **No BIOS change needed** |
| **WSL** | Default version 2 | **Installed — needs restart to activate** |
| VirtualMachinePlatform | Enabled | **Needs restart to take effect** |
| **Docker Desktop** | 4.87.0 (per-user, `%LOCALAPPDATA%\Programs\DockerDesktop`) | **Installed — daemon blocked on WSL** |
| Docker client | 29.7.2 | Installed |
| Docker Compose | v5.4.0 | Installed |
| Node.js | v24.18.0 | Working |
| pnpm | 11.22.0 (via corepack, user-scoped) | Working |
| Git | 2.55.0.windows.2 | Working, pushes verified |

Docker Desktop was installed from the official `desktop.docker.com` installer, SHA256-verified
against Docker's published hash, with a valid Authenticode signature from `CN=Docker Inc`.
Installed **without** `--accept-license`, so the Docker Subscription Service Agreement is
presented at first launch rather than accepted on the owner's behalf.

## Blocker — Windows restart required

`wsl --install --no-distribution` completed successfully and `VirtualMachinePlatform` is
**Enabled**, but the feature does not take effect until Windows restarts. Until then:

```
WSL2 is unable to start since virtualization is not enabled on this machine.
```

This is expected post-install behaviour, not a fault. Docker's daemon cannot start without the
WSL 2 backend, so everything requiring PostgreSQL/PostGIS or OpenTripPlanner is blocked:
Phase 1 stories P1-02 through P1-06, and all of Phases 2–8.

**Resume procedure**

1. Save open work and restart Windows.
2. Launch Docker Desktop from the Start menu.
3. **Accept the Docker Subscription Service Agreement** when shown — this is deliberately left
   to the owner.
4. Wait for the whale icon to report "Engine running".
5. Verify: `wsl --status`, `wsl --version`, `docker version`, `docker compose version`,
   `docker info`, `docker run --rm hello-world`.
6. Resume the agent session and ask it to continue Phase 1 from story P1-02.

## Phase 1 progress

| Story | State | Evidence |
| --- | --- | --- |
| P1-01 workspace, apps, shared packages | **Done (partial)** | pnpm workspace, strict TS project references, typecheck exit 0 |
| P1-02 PostGIS via Docker Compose | **Blocked** | Needs Docker daemon |
| P1-03 Drizzle schema and migrations | **Blocked** | Needs database |
| P1-04 auth and sessions | **Blocked** | Needs database |
| P1-05 preferences and privacy defaults | **Blocked** | Needs database |
| P1-06 RLS roles and policies | **Blocked** | Needs database |
| P1-07 design tokens, shell, dock | Not started | Deliberately last, so a11y tests run against a real shell |
| P1-08 config validation, health, logging | **Partial** | `@travelplus/config` complete with 13 tests; health and logging pending |

### Verified this session

```
pnpm typecheck   exit 0   (TypeScript strict, project references)
pnpm test        exit 0   71 tests passed, 5 files, 0 skipped
```

| Suite | Tests | Covers |
| --- | --- | --- |
| `domain/status` | 13 | BR-T5/T6/T7 status derivation, including **ADR-0022: a positions-only feed can never yield `REALTIME`** at any point in time |
| `domain/money` | 20 | BR-M5/M6 — splits conserve every minor unit across ~1,000 amount/part combinations, refunds included |
| `domain/time` | 13 | BR-TZ3/TZ4/TZ5/TZ8 — DST spring-forward and fall-back, southern hemisphere, half-hour offset, KL day boundaries |
| `domain/route` | 12 | The live-badge gate — a KL pilot departure can never be labelled realtime |
| `config` | 13 | Startup refuses a placeholder or contact-less provider User-Agent; rejects a geocoder rate above the 1 req/s policy |

No tests are skipped.

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
