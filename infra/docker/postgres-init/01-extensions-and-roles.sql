-- Runs once, on an empty data directory, as the superuser.
--
-- Creates the three roles from docs/phase-0/15-DATABASE-STRATEGY.md §1. The
-- separation is what makes row-level security real: the application connects as
-- a role that is neither superuser nor table owner, so FORCE ROW LEVEL SECURITY
-- genuinely applies to it. Running the app as the owner is the single most
-- common way RLS ends up silently doing nothing.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- place-name similarity (BR-PL3)
CREATE EXTENSION IF NOT EXISTS citext;       -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_bytes for tokens

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

-- Owns every object. Migrations only. Never used at runtime.
-- (Already exists: it is POSTGRES_USER. Recorded here for clarity.)

-- The application role. Subject to forced RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'travelplus_app') THEN
    CREATE ROLE travelplus_app LOGIN PASSWORD 'travelplus_dev_only'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- System jobs with no user actor: feed sync, cache sweep, outbox drain.
-- Deliberately granted nothing on user or trip tables (MB / RLS rule R12).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'travelplus_worker_sys') THEN
    CREATE ROLE travelplus_worker_sys LOGIN PASSWORD 'travelplus_dev_only'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Schema and baseline grants
-- ---------------------------------------------------------------------------
GRANT CONNECT ON DATABASE travelplus TO travelplus_app, travelplus_worker_sys;
GRANT USAGE ON SCHEMA public TO travelplus_app, travelplus_worker_sys;

-- `app` holds the RLS helper functions and the session-context accessor.
CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO travelplus_app, travelplus_worker_sys;

-- Neither runtime role may create objects. New tables come only from migrations,
-- which means a table can never appear without an RLS policy being considered.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM travelplus_app, travelplus_worker_sys;

-- Passwords above are development-only and are also the documented defaults in
-- .env.example. They are not secrets: this stack binds to localhost and holds no
-- real data. A deployed environment supplies its own via POSTGRES_PASSWORD.
