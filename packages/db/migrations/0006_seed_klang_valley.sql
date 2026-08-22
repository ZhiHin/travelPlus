-- 0006_seed_klang_valley — the pilot region and its four feeds.
--
-- Data, not schema. Fixed ids so the migration is idempotent and the rows can
-- be referenced by tests and by the graph manifest. Every licence fact here
-- was verified by a person on 2026-08-21 (RISKS.md R-17) and matches
-- KLANG_VALLEY_FEEDS in packages/routing; the two are cross-checked by test.

BEGIN;

INSERT INTO routing_regions
  (id, slug, display_name, otp_router_id, bbox, coverage_tier, status,
   graph_built_at, osm_extract_url, osm_extract_date)
VALUES
  ('0198f000-0000-7000-8000-000000000001', 'klang-valley', 'Klang Valley (Kuala Lumpur)',
   'klang-valley',
   ST_SetSRID(ST_MakeEnvelope(101.3, 2.8, 102.0, 3.45), 4326)::geography,
   -- T2: scheduled routing. No feed publishes TripUpdates, so T3 is unreachable (ADR-0022).
   'T2', 'ACTIVE',
   '2026-08-23 10:03:26+00',
   'https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf',
   '2026-08-21')
ON CONFLICT (slug) DO UPDATE SET
  display_name     = EXCLUDED.display_name,
  bbox             = EXCLUDED.bbox,
  coverage_tier    = EXCLUDED.coverage_tier,
  status           = EXCLUDED.status,
  graph_built_at   = EXCLUDED.graph_built_at,
  osm_extract_url  = EXCLUDED.osm_extract_url,
  osm_extract_date = EXCLUDED.osm_extract_date,
  updated_at       = now();

-- Capabilities are per feed and deliberately NOT a single boolean:
-- VehiclePositions yes, TripUpdates no, for every one of them (R-20).
INSERT INTO transit_feeds
  (id, routing_region_id, agency_name, feed_url, licence, attribution, terms_url,
   licence_verified_at, requires_api_key,
   caps_trip_updates, caps_vehicle_positions, caps_service_alerts, realtime_urls, notes)
VALUES
  ('0198f000-0000-7000-8000-000000000011', '0198f000-0000-7000-8000-000000000001',
   'Prasarana — Rapid Rail KL',
   'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl',
   'CC BY 4.0',
   'Transit data © Kerajaan Malaysia (data.gov.my), CC BY 4.0. Modified: schedules built into a routing graph.',
   'https://developer.data.gov.my/faq', '2026-08-21 00:00:00+00', false,
   false, true, false,
   '{"vehiclePositions":"https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-rail-kl"}',
   'OTP feedId prasarana-rapid-rail-kl'),
  ('0198f000-0000-7000-8000-000000000012', '0198f000-0000-7000-8000-000000000001',
   'Prasarana — Rapid Bus KL',
   'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl',
   'CC BY 4.0',
   'Transit data © Kerajaan Malaysia (data.gov.my), CC BY 4.0. Modified: schedules built into a routing graph.',
   'https://developer.data.gov.my/faq', '2026-08-21 00:00:00+00', false,
   false, true, false,
   '{"vehiclePositions":"https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl"}',
   'OTP feedId prasarana-rapid-bus-kl'),
  ('0198f000-0000-7000-8000-000000000013', '0198f000-0000-7000-8000-000000000001',
   'Prasarana — MRT Feeder Bus',
   'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder',
   'CC BY 4.0',
   'Transit data © Kerajaan Malaysia (data.gov.my), CC BY 4.0. Modified: schedules built into a routing graph.',
   'https://developer.data.gov.my/faq', '2026-08-21 00:00:00+00', false,
   false, true, false,
   '{"vehiclePositions":"https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder"}',
   'OTP feedId prasarana-rapid-bus-mrtfeeder'),
  ('0198f000-0000-7000-8000-000000000014', '0198f000-0000-7000-8000-000000000001',
   'Keretapi Tanah Melayu (KTMB)',
   'https://api.data.gov.my/gtfs-static/ktmb',
   'CC BY 4.0',
   'Transit data © Kerajaan Malaysia (data.gov.my), CC BY 4.0. Modified: schedules built into a routing graph.',
   'https://developer.data.gov.my/faq', '2026-08-21 00:00:00+00', false,
   false, true, false,
   '{"vehiclePositions":"https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb"}',
   'OTP feedId ktmb. Feed types Komuter as route_type 0 (tram) — reported as published, see R-23.')
ON CONFLICT (id) DO UPDATE SET
  agency_name            = EXCLUDED.agency_name,
  feed_url               = EXCLUDED.feed_url,
  licence                = EXCLUDED.licence,
  attribution            = EXCLUDED.attribution,
  terms_url              = EXCLUDED.terms_url,
  licence_verified_at    = EXCLUDED.licence_verified_at,
  caps_trip_updates      = EXCLUDED.caps_trip_updates,
  caps_vehicle_positions = EXCLUDED.caps_vehicle_positions,
  caps_service_alerts    = EXCLUDED.caps_service_alerts,
  realtime_urls          = EXCLUDED.realtime_urls,
  notes                  = EXCLUDED.notes;


-- The versions built into the current graph (infra/otp/data/manifest.json).
-- Service dates are read from each archive's calendar.txt; checksums are of the
-- archive as downloaded 2026-08-21. last_success_at is NULL: no realtime poll
-- has run, so nothing may derive REALTIME from these rows (BR-T5).
--
-- Note the KTMB window: a rolling ~3 weeks. Komuter drops out of routing on
-- 2026-09-07 unless the graph is rebuilt (RISKS.md R-24).
INSERT INTO transit_feed_versions
  (id, transit_feed_id, version_label, service_start, service_end, checksum, ingested_at)
VALUES
  ('0198f000-0000-7000-8000-000000000021', '0198f000-0000-7000-8000-000000000011',
   '2026-08-21', '2019-01-01', '2026-12-31',
   '532afb6c518489ec612912cefe957c3f05ccb66efad9ce3f61b95981f67df669', '2026-08-21 00:00:00+00'),
  ('0198f000-0000-7000-8000-000000000022', '0198f000-0000-7000-8000-000000000012',
   '2026-08-21', '2020-04-01', '2027-03-31',
   '315edc3caa21d2fd55894d3d585b61432b1a77733c85968f77019e20645f6e7e', '2026-08-21 00:00:00+00'),
  ('0198f000-0000-7000-8000-000000000023', '0198f000-0000-7000-8000-000000000013',
   '2026-08-21', '2026-08-22', '2026-09-30',
   'e9c698497e9f8ba0b20d085da05772bc9ba7bc5b3b83d77593621657f971f1d9', '2026-08-21 00:00:00+00'),
  ('0198f000-0000-7000-8000-000000000024', '0198f000-0000-7000-8000-000000000014',
   '2026-08-21', '2026-08-18', '2026-09-06',
   'a6abf4faaca1a797e7e8e043d97f4872869aef860fcbcc40254c84c1381d5944', '2026-08-21 00:00:00+00')
ON CONFLICT (transit_feed_id, version_label) DO UPDATE SET
  service_start = EXCLUDED.service_start,
  service_end   = EXCLUDED.service_end,
  checksum      = EXCLUDED.checksum;

COMMIT;
