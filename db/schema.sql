-- schema.sql — PostgreSQL schema for the buggy telemetry platform
-- This file is automatically executed by the Postgres container
-- the first time the database is created (via docker-entrypoint-initdb.d).
--
-- If you ever need to re-run it from scratch:
--   docker compose down -v          (WARNING: deletes all data!)
--   docker compose up -d
--
-- Tables (from the contract, section 5.4):
--   trips           — one row per power-on session of a buggy
--   readings        — one row per telemetry sample (~5 Hz)
--   trip_summaries  — analysis results written by the Python worker
--   users           — dashboard login accounts

-- ────────────────────────────────────────────────────────────
-- 1. trips — tracks each driving session
-- ────────────────────────────────────────────────────────────
CREATE TABLE trips (
  id              BIGSERIAL PRIMARY KEY,
  device_id       TEXT NOT NULL,
  trip_id         TEXT NOT NULL,
  driver_name     TEXT,
  status          TEXT NOT NULL DEFAULT 'live',            -- live | ended
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  top_speed_kmh   REAL,
  sample_count    INTEGER,
  analysis_status TEXT NOT NULL DEFAULT 'none',            -- none | pending | running | done | failed
  UNIQUE (device_id, trip_id)
);

-- ────────────────────────────────────────────────────────────
-- 2. readings — individual telemetry samples
--    No primary key needed; indexed by (trip_pk, time) for fast queries.
--    Foreign key to trips with CASCADE delete so removing a trip
--    automatically removes all its readings.
-- ────────────────────────────────────────────────────────────
CREATE TABLE readings (
  trip_pk       BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  "time"        TIMESTAMPTZ NOT NULL,
  speed_kmh     REAL,
  raw_gps_kmh   REAL,
  raw_acc_kmh   REAL,
  temp_c        REAL,
  gas_ppm       INTEGER,
  pitch_deg     INTEGER,
  roll_deg      INTEGER,
  lat           DOUBLE PRECISION,
  lon           DOUBLE PRECISION,
  sat           INTEGER,
  battery_pct   INTEGER,
  gps_utc       TIMESTAMPTZ,
  geo_active    BOOLEAN,
  geo_breach    BOOLEAN,
  pos_src       SMALLINT
);

-- Composite index: all trip queries filter by trip_pk and order by time.
CREATE INDEX readings_trip_time ON readings (trip_pk, "time");

-- ────────────────────────────────────────────────────────────
-- 3. trip_summaries — analysis results (written by Python worker)
--    One row per analysed trip. metrics is a JSONB column so we
--    can store arbitrary key-value pairs without schema changes.
-- ────────────────────────────────────────────────────────────
CREATE TABLE trip_summaries (
  trip_pk     BIGINT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  story_text  TEXT,
  metrics     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 4. users — dashboard login accounts
--    Roles: viewer, team, engineer (enforced on the backend).
-- ────────────────────────────────────────────────────────────
CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('viewer', 'team', 'engineer')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 5. geofences — tracks geofence deployments and acknowledgements
--    The "current fence" = newest row where ack_status != 'rejected'
--    If its shape type is 'clear', there is no active fence.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geofences (
  id           BIGSERIAL PRIMARY KEY,
  device_id    TEXT NOT NULL DEFAULT 'buggy01',
  shape        JSONB NOT NULL,                    -- exactly what was published (circle / polygon / clear)
  label        TEXT,
  deployed_by  BIGINT REFERENCES users(id),
  deployed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ack_status   TEXT NOT NULL DEFAULT 'pending',   -- pending | applied | unchanged | rejected | no_response
  ack_info     TEXT,
  acked_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS geofences_device_time ON geofences (device_id, deployed_at DESC);

-- ────────────────────────────────────────────────────────────
-- Verification: print the tables that were just created
-- (this output appears in `docker compose logs postgres` on first start)
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  RAISE NOTICE '=== Schema loaded successfully ===';
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  LOOP
    RAISE NOTICE '  table: %', tbl;
  END LOOP;
  RAISE NOTICE '================================';
END $$;
