# Module boundaries

**Status:** Phase 0 · 2026-08-19 · companion to `10-ARCHITECTURE.md`

Boundaries are only real if a machine enforces them. Every rule here maps to a CI check.

---

## 1. Workspace layout

```
apps/
  web/                  Next.js UI, route handlers, server actions
  worker/               background jobs and schedulers
packages/
  db/                   schema, migrations, RLS, repositories
  domain/               entities, policies, itinerary and routing rules
  ai/                   provider abstraction, schemas, prompts, repair loop
  routing/              OTP client, normalized route models, provider interface
  integrations/         maps, geocoding, weather, Wikimedia, GTFS catalog
  ui/                   tokens and reusable components
  config/               validated environment configuration
  test-utils/
infra/
  docker/  otp/  gtfs/  maps/
docs/
```

## 2. The dependency rule

```
apps/web ────┐
             ├──→ application services ──→ domain ←── (nothing)
apps/worker ─┘                          │
                                        └──→ ports (interfaces)
                                                  ↑
                              adapters: db · routing · ai · integrations
```

**Dependencies point inward.** `domain` sits at the centre and depends on nothing. Adapters depend
on the ports `domain` declares, never the reverse.

## 3. Per-package contracts

| Package | Owns | May import | Must never |
| --- | --- | --- | --- |
| `domain` | Entities, itinerary rules, constraint engine, deterministic scheduler, authorization policy, time and money arithmetic, port interfaces | Nothing outside itself and `type`-only shared primitives | Import React, Next, Drizzle, an HTTP client, `pg`, or `process.env` |
| `db` | Drizzle schema, SQL migrations, RLS policies, repositories, transaction helper | `domain` (for types), `config` | Contain business rules or make authorization decisions |
| `routing` | `RoutingProvider` port, OTP GraphQL adapter, normalized route model, region resolution, GTFS ingestion | `domain`, `config` | Leak an OTP payload shape upward; write to non-routing tables |
| `ai` | `AIProvider` port, Ollama adapter, `FakeAIProvider`, prompt construction, Zod schemas, repair loop, tool boundary | `domain`, `config` | **Emit or accept transport facts**; call a repository directly |
| `integrations` | Geocoder, weather, Wikimedia, GTFS catalog adapters; SSRF-safe HTTP client; global rate limiter; provider cache | `domain`, `config`, `db` (cache + limiter tables only) | Be imported by browser code |
| `ui` | Design tokens, primitives, map components | `config` (public values only) | Contain trip business rules or call providers |
| `config` | One Zod schema; the **only** file reading `process.env` | nothing | Export secrets to anything client-bound |
| `test-utils` | Fixtures, DB harness, fake providers, factories | anything | Ship in a production bundle |
| `apps/web` | Route handlers, server actions, RSC/Client components, application services | everything | Put domain logic in a handler or component |
| `apps/worker` | Job consumers, schedulers | everything | Duplicate logic that belongs in `domain` |

## 4. Enforcement — each rule has a check

| # | Rule | CI check |
| --- | --- | --- |
| MB-1 | `domain` imports no framework, ORM, HTTP client or env | ESLint `no-restricted-imports` scoped to `packages/domain` — **fails the build** |
| MB-2 | Dependencies point inward only | Import-boundary lint rule across the workspace |
| MB-3 | `process.env` appears in exactly one file | Grep check |
| MB-4 | No secret reaches the client bundle | Grep the built bundle for known secret names and `NEXT_PUBLIC_` misuse |
| MB-5 | No browser code imports `integrations` | Import graph check |
| MB-6 | Route handlers contain no repository calls | Lint rule on `apps/web/**/route.ts` |
| MB-7 | `transit_segments` is written from exactly one module | Grep + code review gate |
| MB-8 | `test-utils` never appears in a production build | Bundle analysis |

MB-1 and MB-7 are the two that protect the product's central claim. MB-7 in particular means there
is exactly one code path capable of creating a transit fact, and it takes an OTP response as input.

## 5. Ports the domain declares

```ts
interface RoutingProvider { plan(req: RouteRequest): Promise<NormalizedRoute[]> }
interface Geocoder        { search(q: string, opts): Promise<Place[]>; reverse(c): Promise<Place | null> }
interface AIProvider      { generate<T>(prompt: PromptSpec, schema: ZodSchema<T>): Promise<T> }
interface WeatherProvider { forecast(coord, date): Promise<Forecast | null> }
interface ContentProvider { summary(placeRef): Promise<PlaceContent | null> }
interface JobQueue        { enqueue(name, payload, opts): Promise<JobId> }
interface Clock           { now(): Instant }
```

`Clock` is a port so time-zone and freshness tests can advance time deterministically — which is what
makes the `REALTIME → STALE` transition testable without waiting for a feed to go quiet
(`../RISKS.md` R-15).

Every port returns `null` or an explicit empty result for "asked, nothing there", and throws only for
"could not ask". That distinction is the type-level expression of BR-R4.

## 6. Cross-cutting concerns and their homes

| Concern | Home | Not in |
| --- | --- | --- |
| Authorization policy | `domain` (rules) + `apps/*` (enforcement) + `db` (RLS) | UI |
| Validation | `apps/*` boundary (Zod) + `db` (constraints) | domain internals |
| Caching | `integrations` | domain, UI |
| Rate limiting | `integrations`, database-backed | per-process memory |
| Idempotency | application services | handlers |
| Transactions | `db` transaction helper | repositories individually |
| Correlation IDs | edge middleware, threaded through ports | ad hoc |
| Localisation | `ui` + `next-intl` | domain |

## 7. Adding a provider

The test of a good boundary is how cheap a swap is. Replacing the geocoder should touch three files:

1. Write the adapter in `integrations` implementing `Geocoder`.
2. Register it behind the `GEOCODER_PROVIDER` config value.
3. Add a provider-matrix row with licence, limits, attribution, fallback and a check date.

**No domain change, no UI change, no migration.** If a provider swap requires touching `domain`, the
boundary was drawn in the wrong place and the ADR needs revisiting.
