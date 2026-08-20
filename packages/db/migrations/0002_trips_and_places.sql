-- 0002_trips_and_places — Phase 2 destinations, places, coverage and provider state.
--
-- Extends the Phase 1 trip shell. Forward-only; 0001 is immutable and its
-- checksum is verified on every run.

BEGIN;

-- ===========================================================================
-- Enums
-- ===========================================================================
CREATE TYPE place_provider     AS ENUM ('OSM','NOMINATIM','WIKIDATA','USER');
CREATE TYPE hours_confidence   AS ENUM ('FEED','PARSED','USER','UNKNOWN');
CREATE TYPE region_status      AS ENUM ('ACTIVE','BUILDING','STALE','DISABLED');

-- ===========================================================================
-- Routing regions — coverage is a data property, not a code property
-- ===========================================================================
CREATE TABLE routing_regions (
  id               uuid PRIMARY KEY,
  slug             text NOT NULL UNIQUE,
  display_name     text NOT NULL,
  otp_router_id    text NOT NULL,
  bbox             geography(Polygon,4326) NOT NULL,
  coverage_tier    coverage_tier NOT NULL DEFAULT 'T1',
  status           region_status NOT NULL DEFAULT 'BUILDING',
  graph_built_at   timestamptz,
  osm_extract_url  text,
  osm_extract_date date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- The index that answers "does this destination have coverage".
CREATE INDEX routing_regions_bbox_idx ON routing_regions USING GIST (bbox);

-- ===========================================================================
-- Transit feeds
-- ===========================================================================
CREATE TABLE transit_feeds (
  id                  uuid PRIMARY KEY,
  routing_region_id   uuid NOT NULL REFERENCES routing_regions(id) ON DELETE CASCADE,
  agency_name         text NOT NULL,
  feed_url            text NOT NULL,
  -- NOT NULL with no 'unknown' value: a feed of unverified licence is
  -- structurally un-ingestible (R-17). This column is why the Kuala Lumpur
  -- pilot cannot be loaded until a human confirms data.gov.my's terms.
  licence             text NOT NULL,
  attribution         text NOT NULL,
  terms_url           text,
  licence_verified_at timestamptz NOT NULL,
  requires_api_key    boolean NOT NULL DEFAULT false,
  -- Which GTFS-RT entity types this feed actually publishes. NOT a single
  -- `has_realtime` boolean: "has a realtime feed" and "can predict a departure"
  -- are different claims, and conflating them is how vehicle positions get
  -- rendered as arrival predictions (ADR-0022).
  caps_trip_updates       boolean NOT NULL DEFAULT false,
  caps_vehicle_positions  boolean NOT NULL DEFAULT false,
  caps_service_alerts     boolean NOT NULL DEFAULT false,
  realtime_urls       jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feeds_licence_not_placeholder
    CHECK (licence <> '' AND upper(licence) NOT IN ('UNKNOWN','TBD','N/A'))
);
CREATE INDEX transit_feeds_region_idx ON transit_feeds (routing_region_id);

CREATE TABLE transit_feed_versions (
  id                       uuid PRIMARY KEY,
  transit_feed_id          uuid NOT NULL REFERENCES transit_feeds(id) ON DELETE CASCADE,
  version_label            text NOT NULL,
  service_start            date,
  service_end              date,
  checksum                 text NOT NULL,
  validation_report        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at              timestamptz NOT NULL DEFAULT now(),
  -- Together these derive REALTIME vs STALE at read time (BR-T5).
  last_success_at          timestamptz,
  freshness_window_seconds integer NOT NULL DEFAULT 120,
  health                   text NOT NULL DEFAULT 'HEALTHY',
  UNIQUE (transit_feed_id, version_label)
);
CREATE INDEX feed_versions_health_idx
  ON transit_feed_versions (transit_feed_id, last_success_at);

-- ===========================================================================
-- Places
-- ===========================================================================
CREATE TABLE places (
  id                   uuid PRIMARY KEY,
  canonical_name       text NOT NULL,
  coord                geography(Point,4326) NOT NULL,
  address              jsonb NOT NULL DEFAULT '{}'::jsonb,
  categories           text[] NOT NULL DEFAULT '{}',
  iana_zone            text,
  opening_hours_raw    text,
  opening_hours_confidence hours_confidence NOT NULL DEFAULT 'UNKNOWN',
  typical_visit_seconds integer,
  accessibility        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
-- NOTE: there is deliberately NO column for rating, review count, popularity,
-- price level or phone number. A field that does not exist cannot be populated
-- with an invention (BR-T1, PLACE-05).
CREATE INDEX places_coord_idx ON places USING GIST (coord);
CREATE INDEX places_name_trgm_idx ON places USING GIN (canonical_name gin_trgm_ops);

CREATE TABLE place_sources (
  id           uuid PRIMARY KEY,
  place_id     uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  provider     place_provider NOT NULL,
  source_id    text NOT NULL,
  source_url   text,
  licence      text,
  attribution  text,
  raw          jsonb,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  -- The primary duplicate guard (BR-PL2).
  UNIQUE (provider, source_id)
);
CREATE INDEX place_sources_place_idx ON place_sources (place_id);

CREATE TABLE place_collections (
  id        uuid PRIMARY KEY,
  owner_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id   uuid REFERENCES trips(id) ON DELETE CASCADE,
  name      text NOT NULL,
  colour    text,
  ordinal   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX place_collections_owner_idx ON place_collections (owner_id);

CREATE TABLE saved_places (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id       uuid REFERENCES trips(id) ON DELETE CASCADE,
  place_id      uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  collection_id uuid REFERENCES place_collections(id) ON DELETE SET NULL,
  note          text,
  tags          text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, trip_id, place_id)
);
CREATE INDEX saved_places_trip_idx ON saved_places (trip_id);

-- ===========================================================================
-- Trip destinations
-- ===========================================================================
CREATE TABLE trip_destinations (
  id                uuid PRIMARY KEY,
  trip_id           uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name              text NOT NULL,
  centroid          geography(Point,4326) NOT NULL,
  iana_zone         text NOT NULL DEFAULT 'UTC',
  arrive_date       date,
  depart_date       date,
  ordinal           integer NOT NULL DEFAULT 0,
  routing_region_id uuid REFERENCES routing_regions(id) ON DELETE SET NULL,
  -- Derived server-side from the region catalog, never client-set (BR-TR4).
  coverage_tier     coverage_tier NOT NULL DEFAULT 'T0',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT destinations_date_order
    CHECK (depart_date IS NULL OR arrive_date IS NULL OR depart_date >= arrive_date)
);
CREATE INDEX trip_destinations_trip_idx ON trip_destinations (trip_id, ordinal);
CREATE INDEX trip_destinations_centroid_idx ON trip_destinations USING GIST (centroid);

-- ===========================================================================
-- Trip preferences — every column nullable; NULL means inherit (BR-P1)
-- ===========================================================================
CREATE TABLE trip_preferences (
  trip_id                 uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  interests               text[],
  dislikes                text[],
  pace                    travel_pace,
  budget_amount           numeric(18,4),
  budget_currency         char(3),
  preferred_modes         text[],
  avoided_modes           text[],
  max_walk_meters_per_leg integer,
  max_walk_meters_per_day integer,
  min_transfer_seconds    integer,
  earliest_start          time,
  latest_finish           time,
  meal_windows            jsonb,
  dietary                 text[],
  accessibility           jsonb,
  indoor_outdoor_balance  smallint,
  travelling_with         jsonb,
  nightlife               smallint,
  sustainability          smallint,
  buffer_minutes          integer,
  weather_tolerance       smallint,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_prefs_day_window
    CHECK (earliest_start IS NULL OR latest_finish IS NULL OR earliest_start < latest_finish),
  CONSTRAINT trip_prefs_walk_bounds
    CHECK (max_walk_meters_per_leg IS NULL OR max_walk_meters_per_day IS NULL
           OR max_walk_meters_per_leg <= max_walk_meters_per_day)
);

-- ===========================================================================
-- Provider cache and rate-limit state
-- ===========================================================================
CREATE TABLE provider_cache_entries (
  id           uuid PRIMARY KEY,
  provider     text NOT NULL,
  cache_key    text NOT NULL,
  response     jsonb NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  hit_count    integer NOT NULL DEFAULT 0,
  UNIQUE (provider, cache_key)
);
CREATE INDEX provider_cache_expiry_idx ON provider_cache_entries (expires_at);

-- Deliberately ONE ROW PER PROVIDER, updated with SELECT ... FOR UPDATE.
-- The Nominatim policy caps the WHOLE APPLICATION at 1 request/second, so a
-- per-process limiter would breach it the moment a second container starts
-- (ADR-0011). Holding the budget in the database is what makes the limit real.
CREATE TABLE provider_rate_limit_state (
  provider       text PRIMARY KEY,
  tokens         numeric NOT NULL,
  max_tokens     numeric NOT NULL,
  refill_per_sec numeric NOT NULL,
  last_refill_at timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- RLS
-- ===========================================================================
ALTER TABLE trip_destinations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_destinations  FORCE  ROW LEVEL SECURITY;
ALTER TABLE trip_preferences   ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_preferences   FORCE  ROW LEVEL SECURITY;
ALTER TABLE saved_places       ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_places       FORCE  ROW LEVEL SECURITY;
ALTER TABLE place_collections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_collections  FORCE  ROW LEVEL SECURITY;

CREATE POLICY trip_destinations_read ON trip_destinations
  FOR SELECT USING (app.is_trip_member(trip_id));
CREATE POLICY trip_destinations_write ON trip_destinations
  FOR ALL
  USING      (app.trip_role(trip_id) IN ('OWNER','EDITOR'))
  WITH CHECK (app.trip_role(trip_id) IN ('OWNER','EDITOR'));

CREATE POLICY trip_preferences_read ON trip_preferences
  FOR SELECT USING (app.is_trip_member(trip_id));
CREATE POLICY trip_preferences_write ON trip_preferences
  FOR ALL
  USING      (app.trip_role(trip_id) IN ('OWNER','EDITOR'))
  WITH CHECK (app.trip_role(trip_id) IN ('OWNER','EDITOR'));

-- A saved place is reachable either as the saver, or through trip membership.
CREATE POLICY saved_places_access ON saved_places
  FOR ALL
  USING (
    user_id = app.current_user_id()
    OR (trip_id IS NOT NULL AND app.is_trip_member(trip_id))
  )
  WITH CHECK (
    user_id = app.current_user_id()
    AND (trip_id IS NULL OR app.trip_role(trip_id) IN ('OWNER','EDITOR'))
  );

CREATE POLICY place_collections_access ON place_collections
  FOR ALL
  USING (
    owner_id = app.current_user_id()
    OR (trip_id IS NOT NULL AND app.is_trip_member(trip_id))
  )
  WITH CHECK (owner_id = app.current_user_id());

-- Shared reference data: readable by any authenticated session, writable only by
-- the system role. A bus stop belongs to nobody, and these rows carry no personal
-- data — the link between a place and a trip lives in saved_places, which is
-- member-protected above.
ALTER TABLE places                ENABLE ROW LEVEL SECURITY;
ALTER TABLE places                FORCE  ROW LEVEL SECURITY;
ALTER TABLE place_sources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE place_sources         FORCE  ROW LEVEL SECURITY;

CREATE POLICY places_read ON places
  FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY places_write ON places
  FOR ALL
  USING      (app.current_user_id() IS NOT NULL)
  WITH CHECK (app.current_user_id() IS NOT NULL);

CREATE POLICY place_sources_read ON place_sources
  FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY place_sources_write ON place_sources
  FOR ALL
  USING      (app.current_user_id() IS NOT NULL)
  WITH CHECK (app.current_user_id() IS NOT NULL);

-- ===========================================================================
-- Grants
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON
  trip_destinations, trip_preferences, saved_places, place_collections,
  places, place_sources
TO travelplus_app;

GRANT SELECT ON routing_regions, transit_feeds, transit_feed_versions TO travelplus_app;

-- Region and feed catalog is operational data: only the system role writes it.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  routing_regions, transit_feeds, transit_feed_versions
TO travelplus_worker_sys;

-- The rate limiter must be writable by every process that calls a provider,
-- because that is the point: one shared budget.
GRANT SELECT, INSERT, UPDATE ON provider_cache_entries, provider_rate_limit_state
TO travelplus_app, travelplus_worker_sys;

COMMIT;
