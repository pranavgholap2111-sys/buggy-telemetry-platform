/**
 * trips.js — trip lifecycle management
 * 
 * Responsibilities:
 *   - Create a new trip when we see a new (device_id, trip_id) pair
 *   - Update last_seen_at on every telemetry message
 *   - Track top speed and sample count
 *   - Detect ended trips (idle timeout) and mark them
 *   - Set analysis_status='pending' when a trip ends
 * 
 * We keep an in-memory Map of active trips for fast lookup.
 * The database is the source of truth; the Map is just a cache.
 */

const { pool } = require('./db');
const config = require('./config');

// In-memory map: key = "device_id:trip_id", value = { id, device_id, trip_id, lastSeen, topSpeed, sampleCount }
const activeTrips = new Map();

/**
 * Ensure a trip exists for this (device_id, trip_id).
 * If it doesn't exist, create it. If it exists, update last_seen_at.
 * Returns the trip's primary key (id).
 */
async function ensureTrip(deviceId, tripId) {
  const key = `${deviceId}:${tripId}`;

  // Fast path: already in memory
  if (activeTrips.has(key)) {
    const trip = activeTrips.get(key);
    trip.lastSeen = new Date();
    // Update last_seen_at in DB (fire-and-forget, don't await — too frequent)
    pool.query(
      'UPDATE trips SET last_seen_at = $1 WHERE id = $2',
      [trip.lastSeen, trip.id]
    ).catch(err => console.error('[trips] Failed to update last_seen:', err.message));
    return trip.id;
  }

  // Slow path: check DB (maybe we just restarted and lost the cache)
  try {
    const result = await pool.query(
      `SELECT id, status FROM trips WHERE device_id = $1 AND trip_id = $2`,
      [deviceId, tripId]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      if (row.status === 'ended') {
        // Trip was ended but telemetry arrived again — treat as new trip
        // (shouldn't happen in practice, but be defensive)
        console.warn(`[trips] Trip ${key} was ended but telemetry arrived — creating new entry`);
      } else {
        // Trip is live, cache it
        const trip = {
          id: row.id,
          device_id: deviceId,
          trip_id: tripId,
          lastSeen: new Date(),
          topSpeed: 0,
          sampleCount: 0,
        };
        activeTrips.set(key, trip);
        return trip.id;
      }
    }

    // Create new trip
    const insertResult = await pool.query(
      `INSERT INTO trips (device_id, trip_id, status)
       VALUES ($1, $2, 'live')
       ON CONFLICT (device_id, trip_id) DO UPDATE SET status = 'live', last_seen_at = now()
       RETURNING id`,
      [deviceId, tripId]
    );

    const trip = {
      id: insertResult.rows[0].id,
      device_id: deviceId,
      trip_id: tripId,
      lastSeen: new Date(),
      topSpeed: 0,
      sampleCount: 0,
    };
    activeTrips.set(key, trip);
    console.log(`[trips] ✓ New trip started: ${key} (id=${trip.id})`);
    return trip.id;

  } catch (err) {
    console.error('[trips] Error in ensureTrip:', err.message);
    throw err;
  }
}

/**
 * Update trip stats (top speed, sample count) — called from batch insert
 */
function updateTripStats(deviceId, tripId, speed) {
  const key = `${deviceId}:${tripId}`;
  const trip = activeTrips.get(key);
  if (!trip) return;

  trip.sampleCount++;
  if (speed > trip.topSpeed) {
    trip.topSpeed = speed;
  }
}

/**
 * Check for idle trips and end them.
 * Called every 5 seconds by the main loop.
 * Returns an array of trips that were just ended.
 */
async function checkIdleTrips() {
  const now = new Date();
  const timeoutMs = config.tripIdleTimeoutS * 1000;
  const endedTrips = [];

  for (const [key, trip] of activeTrips.entries()) {
    const idleMs = now - trip.lastSeen;
    if (idleMs > timeoutMs) {
      // Trip is idle — mark as ended
      try {
        await pool.query(
          `UPDATE trips
           SET status = 'ended',
               ended_at = now(),
               top_speed_kmh = $1,
               sample_count = $2,
               analysis_status = 'pending'
           WHERE id = $3 AND status = 'live'`,
          [trip.topSpeed, trip.sampleCount, trip.id]
        );

        console.log(`[trips] ✓ Trip ended: ${key} (top=${trip.topSpeed} km/h, samples=${trip.sampleCount})`);
        activeTrips.delete(key);
        endedTrips.push({
          id: trip.id,
          device_id: trip.device_id,
          trip_id: trip.trip_id,
          top_speed_kmh: trip.topSpeed,
          sample_count: trip.sampleCount,
        });
      } catch (err) {
        console.error(`[trips] Failed to end trip ${key}:`, err.message);
      }
    }
  }

  return endedTrips;
}

/**
 * Get all active trips (for WebSocket hello event)
 */
function getActiveTrips() {
  return Array.from(activeTrips.values());
}

/**
 * Get a specific trip by ID (for REST API)
 */
async function getTripById(id) {
  const result = await pool.query(
    `SELECT t.*, ts.story_text, ts.metrics
     FROM trips t
     LEFT JOIN trip_summaries ts ON ts.trip_pk = t.id
     WHERE t.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * List all trips (for REST API)
 */
async function listTrips(limit = 50, offset = 0) {
  const result = await pool.query(
    `SELECT id, device_id, trip_id, driver_name, status, started_at, last_seen_at, ended_at,
            top_speed_kmh, sample_count, analysis_status
     FROM trips
     ORDER BY started_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

module.exports = {
  ensureTrip,
  updateTripStats,
  checkIdleTrips,
  getActiveTrips,
  getTripById,
  listTrips,
  activeTrips,  // exported for testing
};
