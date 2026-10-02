-- Migration 002: Add geofences table
-- Tracks geofence deployments, acknowledgements, and history
-- Run: docker exec -i buggy-postgres psql -U buggy -d buggy_telemetry < db/migrations/002_geofence.sql

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

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✓ Migration 002 applied: geofences table created';
END $$;
