# Local development plan

**Status:** Phase 0 — **plan only. Nothing below has been created or executed.** Working rule 4
forbids scaffolding during Phase 0. This document is the specification Phase 1 implements.

## 1. Host prerequisites

Probed on this machine 2026-08-19:

| Requirement | Status here | Notes |
| --- | --- | --- |
| Node.js 22+ | ✅ v24.18.0 | Pin via `.nvmrc` in Phase 1 |
| pnpm | ❌ absent | `corepack enable pnpm` |
| Docker Desktop | ❌ absent | **Blocks Phase 1.** User action required |
| Java JDK | ❌ absent | **Not needed** — OTP runs from its container image |
| Git | present (no repo initialised) | `git init` pending user authorisation |
| Disk | ~10 GB free needed | OSM extract + OTP graph + Ollama model |
| RAM | 8 GB workable, 16 GB comfortable | OTP wants 2 GB heap alone |

## 2. Target first-run experience

```bash
pnpm install
docker compose up -d postgres otp ollama
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Five commands, nothing else, and no billable API key at any point. If any step needs a manual
edit to a config file, Phase 1 is not done.

## 3. Compose services

| Service | Image | Port | Notes |
| --- | --- | --- | --- |
| `postgres` | `postgis/postgis` (pinned) | 5432 | PostGIS extension enabled on init; named volume |
| `otp` | `opentripplanner/opentripplanner` (pinned) | 8080 | Data volume at `/var/opentripplanner/`; heap via `JAVA_TOOL_OPTIONS=-Xmx2G` |
| `ollama` | `ollama/ollama` | 11434 | Profile `ai`; host-native instructions documented as an alternative |
| `worker` | built locally | — | Profile `worker` |
| `nominatim` | — | 8081 | Profile `geocoder`, **off by default**; documented self-hosted path |

Image tags are pinned to exact digests. `latest` is never used, so a rebuild six months from now
produces the same stack.

Verified 2026-08-19 from OTP's Container Image documentation: image name
`opentripplanner/opentripplanner`, data mounted at `/var/opentripplanner/`, `--build --save` then
`--load --serve`, heap through `JAVA_TOOL_OPTIONS`.

## 4. OTP graph build

A one-time script, not a manual ritual (mitigates R-08):

```
pnpm otp:fetch   # download the pinned OSM extract and the pinned GTFS zip
pnpm otp:build   # container: --build --save  → graph.obj into the data volume
pnpm otp:serve   # container: --load --serve  → port 8080
```

Rules, each from a verified constraint:

- The GTFS filename **must contain `gtfs`** — OTP requires it (verified 2026-08-19).
- The OSM extract is trimmed to the service-area bounding box, as OTP's own tutorial recommends for
  Portland, rather than loading a whole country.
- Build once, reuse across container restarts. The graph is never rebuilt in the inner dev loop.
- Every fetch records source URL, retrieval time, checksum and licence into `transit_feeds` and
  `transit_feed_versions`. A feed with no licence value cannot be ingested — the column is
  `NOT NULL` (`14-DATA-MODEL.md` §4.5).

## 5. Environment configuration

`.env.example` with safe placeholders, validated by Zod at startup. Missing or invalid required
values fail the boot with a message naming the variable — never a runtime surprise on the first
request.

```dotenv
DATABASE_URL=
APP_URL=http://localhost:3000
AUTH_SECRET=
ENCRYPTION_KEY=
OTP_BASE_URL=http://localhost:8080
OTP_ROUTER_ID=klang-valley
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=
MAP_STYLE_URL=
GEOCODER_PROVIDER=nominatim
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=TravelPlus/0.1 (contact: replace@example.com)
OPEN_METEO_BASE_URL=https://api.open-meteo.com
WIKIMEDIA_USER_AGENT=TravelPlus/0.1 (contact: replace@example.com)
```

Rules: never commit real credentials; never expose a secret through `NEXT_PUBLIC_*` (CI greps for
this); `NOMINATIM_USER_AGENT` must contain a real contact address or startup fails, because a
default user agent breaches the policy verified in ADR-0011.

## 6. Seed data

Marked development-only at the row level, and rendered with a visible development badge. Seeded
places carry `place_sources.provider = 'USER'` and a `seed:` prefix on the source ID so they can
never be mistaken for live provider data. Seeds never populate `transit_segments` — transit facts
come from OTP or they do not exist (ADR-0005).

## 7. DBeaver

An inspection client only. Connection instructions are documented for the `travelplus_migrator` role
for schema work and a read-only role for browsing. **The application must never depend on DBeaver at
runtime**, and nothing in the codebase references it.

Note: connecting DBeaver as the owner role bypasses RLS by design. That is fine for inspection and
is exactly why the *application* connects as `travelplus_app` (`15-DATABASE-STRATEGY.md` §1).

## 8. Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | web + worker with hot reload |
| `pnpm db:migrate` / `db:seed` / `db:reset` | schema and fixtures |
| `pnpm test` / `test:integration` / `test:e2e` | Vitest, Postgres-backed, Playwright |
| `pnpm test:a11y` | axe-core across core flows |
| `pnpm typecheck` / `lint` / `format` | strict TS, ESLint (including the import-boundary rule), Prettier |
| `pnpm otp:*` | fetch, build, serve |
| `pnpm verify` | everything CI runs, locally |

## 9. CI

Runs on every push: typecheck → lint → unit → integration (Postgres service container) → e2e
(Playwright, desktop + mobile viewports) → a11y → migrate-from-clean.

**CI never requires Docker-hosted OTP, a local model, or any paid API.** Routing is exercised
through captured, licence-safe OTP fixtures; AI through `FakeAIProvider` (ADR-0013). A test that
needs a live provider is a test that will be skipped, and a skipped test is how a phase gate gets
passed dishonestly.

Additional CI gates: secret-prefix grep; dependency and container scanning; the assertion that
`travelplus_app` owns no RLS-protected table (`15-DATABASE-STRATEGY.md` §5, test 10).
