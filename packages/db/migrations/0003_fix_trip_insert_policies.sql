-- 0003_fix_trip_insert_policies — repair an unsatisfiable RLS INSERT policy.
--
-- THE BUG
-- 0001 gave `trips` and `trip_members` a single FOR ALL policy gated on
-- `app.trip_role(id) = 'OWNER'`. That role is read from `trip_members`, which
-- does not exist yet at the instant a trip is inserted — so the WITH CHECK was
-- unsatisfiable and no user could ever create a trip:
--
--   new row violates row-level security policy for table "trips"
--
-- WHY THE PHASE 1 TESTS MISSED IT
-- The RLS suite seeded its fixtures through the migrator role, which owns the
-- tables and therefore bypasses the policies. Every cross-user READ was
-- exercised correctly; the authenticated WRITE path never was. Integration
-- tests for the trip service, which create rows as the app role, found it
-- immediately.
--
-- THE FIX
-- Split FOR ALL into per-verb policies. INSERT is authorised by the row's own
-- `owner_id` — a fact present in the row being written — rather than by
-- membership that cannot exist yet. UPDATE and DELETE stay gated on the role,
-- because by then membership does exist.

BEGIN;

-- ---------------------------------------------------------------------------
-- Ownership check that does not depend on trip_members
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because a policy on trip_members that read `trips` would
-- otherwise be filtered by the trips SELECT policy, which reads trip_members.
CREATE OR REPLACE FUNCTION app.owns_trip(p_trip uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trips t
    WHERE t.id = p_trip AND t.owner_id = app.current_user_id()
  )
$$;

GRANT EXECUTE ON FUNCTION app.owns_trip(uuid) TO travelplus_app;

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS trips_owner_write ON trips;
DROP POLICY IF EXISTS trips_member_read ON trips;

-- Readable by members, and by the owner even in the brief window before the
-- membership row is written.
CREATE POLICY trips_read ON trips
  FOR SELECT USING (app.is_trip_member(id) OR owner_id = app.current_user_id());

-- The row being inserted carries its own authorisation: you may create a trip
-- that you own, and no other.
CREATE POLICY trips_insert ON trips
  FOR INSERT WITH CHECK (owner_id = app.current_user_id());

CREATE POLICY trips_update ON trips
  FOR UPDATE
  USING      (app.trip_role(id) = 'OWNER')
  WITH CHECK (app.trip_role(id) = 'OWNER');

CREATE POLICY trips_delete ON trips
  FOR DELETE USING (app.trip_role(id) = 'OWNER');

-- ---------------------------------------------------------------------------
-- trip_members
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS trip_members_owner_write ON trip_members;
DROP POLICY IF EXISTS trip_members_read ON trip_members;

CREATE POLICY trip_members_read ON trip_members
  FOR SELECT USING (app.is_trip_member(trip_id) OR app.owns_trip(trip_id));

-- Bootstrapping the first OWNER row, and later inviting others, are the same
-- operation from the policy's point of view: the actor must own the trip.
-- `owns_trip` reads trips.owner_id directly, so it holds before any membership
-- exists.
CREATE POLICY trip_members_insert ON trip_members
  FOR INSERT WITH CHECK (app.owns_trip(trip_id));

CREATE POLICY trip_members_update ON trip_members
  FOR UPDATE
  USING      (app.owns_trip(trip_id))
  WITH CHECK (app.owns_trip(trip_id));

CREATE POLICY trip_members_delete ON trip_members
  FOR DELETE USING (app.owns_trip(trip_id));

-- ---------------------------------------------------------------------------
-- trip_preferences and trip_destinations
-- ---------------------------------------------------------------------------
-- These are written immediately after the membership row inside the same
-- transaction, so `trip_role` resolves. The owner branch is added anyway so a
-- future caller that writes them before membership is not silently rejected.
DROP POLICY IF EXISTS trip_preferences_write ON trip_preferences;
CREATE POLICY trip_preferences_write ON trip_preferences
  FOR ALL
  USING      (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id))
  WITH CHECK (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id));

DROP POLICY IF EXISTS trip_destinations_write ON trip_destinations;
CREATE POLICY trip_destinations_write ON trip_destinations
  FOR ALL
  USING      (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id))
  WITH CHECK (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id));

COMMIT;
