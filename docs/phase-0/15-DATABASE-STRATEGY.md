# Row-level security design

**Status:** Phase 0 · 2026-08-19 · ADR-0009

RLS is the **second** line, not the first. Application services authorize explicitly. RLS exists so
that a repository which forgets a predicate returns nothing instead of someone else's trip.

## 1. Roles

| Role | Used by | RLS |
| --- | --- | --- |
| `travelplus_migrator` | migrations only | Owns objects; policies do not restrain it. Never used at runtime. |
| `travelplus_app` | `apps/web` and `apps/worker` request paths | **Subject to forced RLS.** Not superuser, not table owner — this is what makes `FORCE ROW LEVEL SECURITY` actually apply. |
| `travelplus_worker_sys` | system jobs with no user actor (feed sync, cache sweep, outbox drain) | Restricted grants on system tables only. No grant on user or trip tables. |

The common failure is running the app as the table owner, where RLS silently does nothing. Enabling
**and forcing** RLS, plus connecting as a non-owner, is the whole mechanism.

```sql
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips FORCE ROW LEVEL SECURITY;
```

## 2. Session context

Every request and every job opens a transaction and sets a local setting first. `set_config(...,
true)` makes it transaction-scoped, so it cannot leak across pooled connections.

```sql
SELECT set_config('app.current_user_id', $1, true);
```

```ts
// packages/db — the only place a connection is handed out
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`)
    return fn(tx)
  })
}
```

Helper functions, marked `STABLE` so the planner can use them efficiently:

```sql
CREATE FUNCTION app.current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

CREATE FUNCTION app.is_trip_member(p_trip uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_members m
    WHERE m.trip_id = p_trip AND m.user_id = app.current_user_id()
  )
$$;

CREATE FUNCTION app.trip_role(p_trip uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT m.role::text FROM trip_members m
  WHERE m.trip_id = p_trip AND m.user_id = app.current_user_id()
$$;
```

`app.is_trip_member` is `SECURITY DEFINER` deliberately: without it, the policy on `trip_members`
would need to consult `trip_members`, and the recursion would either fail or force us to leave that
table unprotected.

**If `app.current_user_id()` is NULL, every policy evaluates false.** An unauthenticated connection
sees zero rows everywhere — a missing session is a closed door, not an open one.

## 3. Policy pattern

Three tiers, by how a row reaches a user.

### Tier 1 — owned directly by a user

```sql
CREATE POLICY user_owns ON user_preferences
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
```

Applies to: `user_preferences`, `user_privacy_settings`, `sessions`, `auth_accounts`,
`notifications`, and `saved_places`/`place_collections` where `trip_id IS NULL`.

`WITH CHECK` matters as much as `USING`: without it a user could *write* a row belonging to someone
else even while unable to read it.

### Tier 2 — reached through trip membership

```sql
CREATE POLICY trip_member_read ON itinerary_items
  FOR SELECT USING (app.is_trip_member(trip_id));

CREATE POLICY trip_editor_write ON itinerary_items
  FOR ALL
  USING      (app.trip_role(trip_id) IN ('OWNER','EDITOR'))
  WITH CHECK (app.trip_role(trip_id) IN ('OWNER','EDITOR'));
```

Applies to: `trips`, `trip_destinations`, `trip_preferences`, `trip_days`, `itinerary_items`,
`itinerary_versions`, `itinerary_change_sets`, `bookings`, `budgets`, `budget_categories`,
`expenses`, `expense_splits`, `checklists`, `checklist_items`, `notes`, `conversations`, `messages`,
`ai_planning_jobs`, `comments`, `votes`, `invitations`.

This is why `itinerary_items` carries a denormalised `trip_id` (see `14-DATA-MODEL.md` §4.3): without
it, every policy evaluation would join through `trip_days`.

Roles map to verbs: `VIEWER` reads; `EDITOR` reads and writes trip content; `OWNER` additionally
manages membership, visibility, share links and deletion.

### Tier 3 — shared reference data

`places`, `place_sources`, `routing_regions`, `transit_feeds`, `transit_feed_versions`,
`route_requests`, `route_snapshots`, `route_legs`, `transit_segments`, `service_alert_snapshots`.

These are not user-owned; a bus stop belongs to nobody. RLS grants `SELECT` to any authenticated
session and reserves writes to `travelplus_worker_sys` and the routing service path.

**The deliberate trade:** `route_snapshots` are readable by any authenticated user. They contain no
personal data — they are answers about public transport. The *link* between a snapshot and a trip
lives in `itinerary_items`, which is Tier 2 protected. Someone guessing a UUIDv7 snapshot ID learns
that a bus goes from A to B, not who is riding it.

### Not user-readable at all

`provider_cache_entries`, `provider_rate_limit_state`, `outbox_events`, `verification_tokens`:
no grant to `travelplus_app` beyond what its specific code paths need; `audit_events` is
append-only, with `SELECT` limited to the owner of the referenced trip and `UPDATE`/`DELETE`
granted to nobody.

## 4. Share links

A public share link is read-only, revocable and unguessable. It is resolved **before** the database
session is opened: the token maps to a trip and a synthetic viewer context. Rather than weakening
the policies with a "public" branch, the share path selects through a dedicated read model that
excludes private booking detail by default. The policy set stays simple and there is no
`OR is_public` clause waiting to be got wrong.

## 5. Test obligations (Phase 1 gate)

RLS is untested until an attacker has been simulated. Every one of these is a real test:

1. User B reads user A's trip by ID → 0 rows.
2. User B writes to user A's itinerary item by ID → rejected.
3. A `VIEWER` attempts an itinerary write → rejected, at both the policy layer and the service layer.
4. A repository query with its `WHERE` clause deliberately removed → still returns 0 cross-user rows.
   **This is the test that proves defence in depth is real** rather than aspirational.
5. No session context set → every table returns 0 rows.
6. An owner attempts to leave their own trip → rejected by the one-owner constraint.
7. A revoked share token → 404, and indistinguishable in timing and shape from a token that never
   existed.
8. An expired invitation → rejected.
9. `travelplus_app` attempts `UPDATE` or `DELETE` on `audit_events` → permission denied.
10. A connection as `travelplus_app` confirms it is neither superuser nor owner of any RLS table —
    asserted in CI, because a future migration granting ownership would silently disable every
    policy above.

Test 10 protects the mechanism itself. The others protect the data.
