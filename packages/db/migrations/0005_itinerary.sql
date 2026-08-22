-- 0005_itinerary — days, items, versions and change sets (Phase 4).

BEGIN;

CREATE TYPE item_kind AS ENUM
  ('ACTIVITY','MEAL','REST','LODGING','MEETING','TRANSPORT','FREE_TIME','BOOKING');
CREATE TYPE change_origin AS ENUM ('AI','USER','SYSTEM');
CREATE TYPE change_set_status AS ENUM
  ('PROPOSED','PARTIALLY_APPLIED','APPLIED','REJECTED','EXPIRED');

CREATE TABLE trip_days (
  id         uuid PRIMARY KEY,
  trip_id    uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  iana_zone  text NOT NULL,
  ordinal    integer NOT NULL,
  title      text,
  notes      text,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, local_date)
);
CREATE INDEX trip_days_trip_idx ON trip_days (trip_id, ordinal);

-- The centre of the product.
CREATE TABLE itinerary_items (
  id                        uuid PRIMARY KEY,
  trip_day_id               uuid NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,
  -- Denormalised so every RLS policy evaluation is one lookup, not a join
  -- through trip_days (14-DATA-MODEL.md §4.3).
  trip_id                   uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind                      item_kind NOT NULL,
  place_id                  uuid REFERENCES places(id) ON DELETE SET NULL,
  title                     text NOT NULL,
  notes                     text,
  -- Three-way time storage (ADR-0007): the instant for ordering, the local
  -- wall-clock for what the traveller meant, the zone for converting between.
  start_instant             timestamptz,
  end_instant               timestamptz,
  local_start_time          time,
  local_end_time            time,
  iana_zone                 text NOT NULL,
  planned_duration_seconds  integer NOT NULL DEFAULT 3600,
  lock_time                 boolean NOT NULL DEFAULT false,
  lock_place                boolean NOT NULL DEFAULT false,
  lock_item                 boolean NOT NULL DEFAULT false,
  -- The leg that gets you HERE. Nullable: the first item of a day has none, and
  -- an unroutable leg is recorded as absent rather than invented.
  inbound_route_snapshot_id uuid REFERENCES route_snapshots(id) ON DELETE SET NULL,
  cost_amount               numeric(18,4),
  cost_currency             char(3),
  cost_status               data_status,
  booking_id                uuid,
  ordinal                   integer NOT NULL,
  version                   integer NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz,
  CONSTRAINT items_time_order
    CHECK (end_instant IS NULL OR start_instant IS NULL OR end_instant > start_instant),
  CONSTRAINT items_duration_positive CHECK (planned_duration_seconds > 0),
  -- BR-I3: an inconsistent lock state is unrepresentable. lock_item implies both.
  CONSTRAINT items_lock_consistent
    CHECK (NOT lock_item OR (lock_time AND lock_place)),
  CONSTRAINT items_cost_pair CHECK (num_nonnulls(cost_amount, cost_currency) <> 1)
);
-- BR-I2: ordinal unique per day among live items.
CREATE UNIQUE INDEX items_day_ordinal_idx
  ON itinerary_items (trip_day_id, ordinal) WHERE deleted_at IS NULL;
CREATE INDEX items_trip_start_idx ON itinerary_items (trip_id, start_instant);

-- Immutable. Restoring writes a NEW version rather than mutating an old one.
CREATE TABLE itinerary_versions (
  id             uuid PRIMARY KEY,
  trip_id        uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  label          text,
  snapshot       jsonb NOT NULL,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  change_set_id  uuid,
  UNIQUE (trip_id, version_number)
);

-- Each change is an individually addressable operation, so a user can accept
-- three of five rather than all or nothing.
CREATE TABLE itinerary_change_sets (
  id                uuid PRIMARY KEY,
  trip_id           uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  origin            change_origin NOT NULL,
  job_id            uuid,
  status            change_set_status NOT NULL DEFAULT 'PROPOSED',
  changes           jsonb NOT NULL,
  rationale         text,
  confidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  unmet_constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  applied_at        timestamptz,
  expires_at        timestamptz
);
CREATE INDEX change_sets_trip_idx ON itinerary_change_sets (trip_id, created_at DESC);

-- ===========================================================================
-- RLS — members read, editors write, with the owner bootstrap branch from 0003
-- ===========================================================================
ALTER TABLE trip_days             ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_days             FORCE  ROW LEVEL SECURITY;
ALTER TABLE itinerary_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE itinerary_items       FORCE  ROW LEVEL SECURITY;
ALTER TABLE itinerary_versions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE itinerary_versions    FORCE  ROW LEVEL SECURITY;
ALTER TABLE itinerary_change_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE itinerary_change_sets FORCE  ROW LEVEL SECURITY;

CREATE POLICY trip_days_read ON trip_days
  FOR SELECT USING (app.is_trip_member(trip_id));
CREATE POLICY trip_days_write ON trip_days
  FOR ALL
  USING      (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id))
  WITH CHECK (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id));

CREATE POLICY items_read ON itinerary_items
  FOR SELECT USING (app.is_trip_member(trip_id));
CREATE POLICY items_write ON itinerary_items
  FOR ALL
  USING      (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id))
  WITH CHECK (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id));

CREATE POLICY versions_read ON itinerary_versions
  FOR SELECT USING (app.is_trip_member(trip_id));
CREATE POLICY versions_insert ON itinerary_versions
  FOR INSERT WITH CHECK (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id));

CREATE POLICY change_sets_read ON itinerary_change_sets
  FOR SELECT USING (app.is_trip_member(trip_id));
CREATE POLICY change_sets_write ON itinerary_change_sets
  FOR ALL
  USING      (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id))
  WITH CHECK (app.trip_role(trip_id) IN ('OWNER','EDITOR') OR app.owns_trip(trip_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON trip_days, itinerary_items, itinerary_change_sets
TO travelplus_app;
-- Versions are append-only: history is never rewritten (BR-I10).
GRANT SELECT, INSERT ON itinerary_versions TO travelplus_app;

COMMIT;
