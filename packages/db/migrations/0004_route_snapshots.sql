-- 0004_route_snapshots — immutable, provenance-stamped routing results.
--
-- A route is a statement about the world at a moment. Re-rendering an itinerary
-- tomorrow must not silently present yesterday's answer as current, and must not
-- lose what was actually shown when the traveller made a decision (ADR-0006).
--
-- Hence: the question and the answer are separate tables, answers are never
-- updated in place, and status is DERIVED on read rather than stored.

BEGIN;

CREATE TYPE leg_kind AS ENUM ('WALK','CYCLE','DRIVE','TRANSIT');
CREATE TYPE transit_mode AS ENUM ('BUS','RAIL','SUBWAY','TRAM','FERRY','CABLE','OTHER');
CREATE TYPE accessibility_confidence AS ENUM ('FEED','INFERRED','UNKNOWN');

-- ===========================================================================
-- The question
-- ===========================================================================
-- Kept separate from the answer so the cache key is explicit, and so two
-- snapshots that differ can be explained by comparing what was asked.
CREATE TABLE route_requests (
  id                uuid PRIMARY KEY,
  trip_id           uuid REFERENCES trips(id) ON DELETE CASCADE,
  origin            geography(Point,4326) NOT NULL,
  destination       geography(Point,4326) NOT NULL,
  depart_at         timestamptz,
  arrive_by         timestamptz,
  iana_zone         text NOT NULL,
  modes             text[] NOT NULL DEFAULT '{}',
  preferences       jsonb NOT NULL DEFAULT '{}'::jsonb,
  routing_region_id uuid REFERENCES routing_regions(id) ON DELETE SET NULL,
  requested_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  -- Exactly one, never both and never neither: "depart at 09:00" and "arrive by
  -- 09:00" are different journeys and a request that means both is incoherent.
  CONSTRAINT route_requests_one_time_anchor
    CHECK (num_nonnulls(depart_at, arrive_by) = 1)
);
CREATE INDEX route_requests_trip_idx ON route_requests (trip_id, requested_at DESC);
CREATE INDEX route_requests_origin_idx ON route_requests USING GIST (origin);

-- ===========================================================================
-- The answer — immutable
-- ===========================================================================
CREATE TABLE route_snapshots (
  id                     uuid PRIMARY KEY,
  route_request_id       uuid NOT NULL REFERENCES route_requests(id) ON DELETE CASCADE,
  -- The status AS COMPUTED AT RETRIEVAL. The status shown to a user is derived
  -- on read from retrieved_at and feed freshness; this records what the router
  -- could offer at the time, which is a different and also useful fact.
  status_at_retrieval    data_status NOT NULL,
  total_duration_seconds integer NOT NULL,
  start_instant          timestamptz NOT NULL,
  end_instant            timestamptz NOT NULL,
  transfer_count         integer NOT NULL DEFAULT 0,
  walk_distance_meters   integer NOT NULL DEFAULT 0,
  geometry               geography(LineString,4326),
  routing_region_id      uuid REFERENCES routing_regions(id) ON DELETE SET NULL,
  feed_version_ids       uuid[] NOT NULL DEFAULT '{}',
  retrieved_at           timestamptz NOT NULL,
  raw                    jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- Deliberately NO updated_at column. These rows are never modified; a
  -- recalculation writes a new snapshot, so the record of what a traveller was
  -- actually shown survives.
  CONSTRAINT route_snapshots_time_order CHECK (end_instant >= start_instant),
  CONSTRAINT route_snapshots_duration_positive CHECK (total_duration_seconds >= 0)
);
CREATE INDEX route_snapshots_request_idx ON route_snapshots (route_request_id);
CREATE INDEX route_snapshots_retrieved_idx ON route_snapshots (retrieved_at);

CREATE TABLE route_legs (
  id                uuid PRIMARY KEY,
  route_snapshot_id uuid NOT NULL REFERENCES route_snapshots(id) ON DELETE CASCADE,
  ordinal           integer NOT NULL,
  kind              leg_kind NOT NULL,
  distance_meters   integer NOT NULL DEFAULT 0,
  duration_seconds  integer NOT NULL DEFAULT 0,
  start_instant     timestamptz,
  end_instant       timestamptz,
  geometry          geography(LineString,4326),
  UNIQUE (route_snapshot_id, ordinal)
);

-- ===========================================================================
-- Transit segments — the fields that must never be invented
-- ===========================================================================
-- EVERY descriptive column here is nullable, and that is the point. NULL means
-- the feed did not supply it, and the UI omits the row rather than rendering a
-- plausible value. This nullability is the schema-level expression of the
-- product's central claim.
CREATE TABLE transit_segments (
  id                      uuid PRIMARY KEY,
  route_leg_id            uuid NOT NULL REFERENCES route_legs(id) ON DELETE CASCADE,
  agency                  text NOT NULL,
  mode                    transit_mode NOT NULL,
  feed_version_id         uuid REFERENCES transit_feed_versions(id) ON DELETE SET NULL,

  route_short_name        text,
  route_long_name         text,
  route_colour            text,
  headsign                text,

  board_stop_name         text NOT NULL,
  board_stop_code         text,
  board_platform          text,
  board_coord             geography(Point,4326) NOT NULL,

  alight_stop_name        text NOT NULL,
  alight_stop_code        text,
  alight_platform         text,
  alight_coord            geography(Point,4326) NOT NULL,

  intermediate_stop_count integer NOT NULL DEFAULT 0,

  scheduled_departure     timestamptz NOT NULL,
  scheduled_arrival       timestamptz NOT NULL,
  -- Populated ONLY from a GTFS-RT TripUpdate. A vehicle-position-only feed
  -- leaves these NULL however fresh it is (ADR-0022).
  realtime_departure      timestamptz,
  realtime_arrival        timestamptz,
  delay_seconds           integer,

  wheelchair_accessible   boolean,
  wheelchair_confidence   accessibility_confidence,

  -- Realtime is all-or-nothing: a departure prediction without an arrival is a
  -- half-fact, and storing one would let the UI render a live badge on partial
  -- data.
  CONSTRAINT transit_segments_realtime_complete
    CHECK (num_nonnulls(realtime_departure, realtime_arrival) <> 1),
  -- If we claim to know accessibility, we must say how confidently.
  CONSTRAINT transit_segments_accessibility_paired
    CHECK (num_nonnulls(wheelchair_accessible, wheelchair_confidence) <> 1)
);
CREATE INDEX transit_segments_leg_idx ON transit_segments (route_leg_id);

CREATE TABLE service_alert_snapshots (
  id              uuid PRIMARY KEY,
  feed_version_id uuid REFERENCES transit_feed_versions(id) ON DELETE CASCADE,
  alert_source_id text,
  header          text NOT NULL,
  description     text,
  effect          text,
  cause           text,
  active_from     timestamptz,
  active_to       timestamptz,
  affected_routes text[] NOT NULL DEFAULT '{}',
  affected_stops  text[] NOT NULL DEFAULT '{}',
  retrieved_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_alerts_active_idx ON service_alert_snapshots (active_to);

-- ===========================================================================
-- RLS
-- ===========================================================================
-- Route data is shared reference material: a bus timetable belongs to nobody and
-- these rows carry no personal data. The LINK between a snapshot and a trip
-- lives in route_requests.trip_id, which is member-scoped, so guessing a UUIDv7
-- snapshot id reveals that a train runs from A to B, not who is riding it
-- (15-DATABASE-STRATEGY.md §3, Tier 3).
ALTER TABLE route_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_requests  FORCE  ROW LEVEL SECURITY;

-- A request with no trip is a bare lookup, readable by its author.
CREATE POLICY route_requests_read ON route_requests
  FOR SELECT USING (
    (trip_id IS NOT NULL AND app.is_trip_member(trip_id))
    OR (trip_id IS NULL AND requested_by = app.current_user_id())
  );

CREATE POLICY route_requests_insert ON route_requests
  FOR INSERT WITH CHECK (
    requested_by = app.current_user_id()
    AND (trip_id IS NULL OR app.trip_role(trip_id) IN ('OWNER','EDITOR'))
  );

ALTER TABLE route_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_snapshots FORCE  ROW LEVEL SECURITY;
CREATE POLICY route_snapshots_read ON route_snapshots
  FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY route_snapshots_insert ON route_snapshots
  FOR INSERT WITH CHECK (app.current_user_id() IS NOT NULL);

ALTER TABLE route_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_legs FORCE  ROW LEVEL SECURITY;
CREATE POLICY route_legs_read ON route_legs
  FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY route_legs_insert ON route_legs
  FOR INSERT WITH CHECK (app.current_user_id() IS NOT NULL);

ALTER TABLE transit_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transit_segments FORCE  ROW LEVEL SECURITY;
CREATE POLICY transit_segments_read ON transit_segments
  FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY transit_segments_insert ON transit_segments
  FOR INSERT WITH CHECK (app.current_user_id() IS NOT NULL);

-- ===========================================================================
-- Grants
-- ===========================================================================
-- SELECT and INSERT only. No UPDATE and no DELETE to the application role:
-- immutability is a grant, not a convention someone can forget (ADR-0006).
GRANT SELECT, INSERT ON
  route_requests, route_snapshots, route_legs, transit_segments
TO travelplus_app;

GRANT SELECT ON service_alert_snapshots TO travelplus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_alert_snapshots TO travelplus_worker_sys;

-- The retention sweep is the worker's job, and the only thing permitted to
-- remove a snapshot at all.
GRANT SELECT, DELETE ON
  route_requests, route_snapshots, route_legs, transit_segments
TO travelplus_worker_sys;

COMMIT;
