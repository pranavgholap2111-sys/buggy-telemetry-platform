/**
 * readings.js — batched telemetry inserts
 * 
 * At 5 Hz we receive ~5 readings per second. Inserting row-by-row
 * would be slow and create unnecessary DB load. Instead, we:
 *   1. Accumulate readings in a buffer array
 *   2. Every 1 second, flush the buffer with a single multi-row INSERT
 *   3. Use PostgreSQL's UNNEST() to expand arrays into rows
 * 
 * This is ~10× faster than individual INSERTs.
 */

const { pool } = require('./db');
const trips = require('./trips');

// Buffer: accumulates readings until flush
let buffer = [];
let flushTimer = null;

/**
 * Add a reading to the buffer.
 * Called for every MQTT telemetry message.
 */
function addReading(telemetry) {
  const serverTime = new Date();  // contract: use server receive time

  // Parse GPS UTC: empty string → NULL
  let gpsUtc = null;
  if (telemetry.utc && telemetry.utc.trim() !== '') {
    const parsed = new Date(telemetry.utc);
    if (!isNaN(parsed.getTime())) {
      gpsUtc = parsed;
    }
  }

  buffer.push({
    trip_pk: null,  // filled in during flush (we need the DB id)
    time: serverTime,
    speed_kmh: telemetry.speed,
    raw_gps_kmh: telemetry.rawGps,
    raw_acc_kmh: telemetry.rawAcc,
    temp_c: telemetry.temp,
    gas_ppm: telemetry.gas,
    pitch_deg: telemetry.pitch,
    roll_deg: telemetry.roll,
    lat: telemetry.lat,
    lon: telemetry.lon,
    sat: telemetry.sat,
    battery_pct: telemetry.battery,
    gps_utc: gpsUtc,
    geo_active: telemetry.geo_active === 1,
    geo_breach: telemetry.geo_breach === 1,
    pos_src: telemetry.pos_src,
    // Metadata (not stored in readings table, used for trip lookup)
    _device_id: telemetry.device_id,
    _trip_id: telemetry.trip_id,
    _speed: telemetry.speed,
  });

  // Update trip stats in memory
  trips.updateTripStats(telemetry.device_id, telemetry.trip_id, telemetry.speed);
}

/**
 * Flush the buffer: resolve trip_pk for each reading, then batch INSERT.
 * Called every 1 second by the timer.
 */
async function flush() {
  if (buffer.length === 0) return;

  // Take a snapshot of the buffer and clear it
  const readings = buffer;
  buffer = [];

  try {
    // Resolve trip_pk for each reading (ensure trip exists, get its id)
    // We group by (device_id, trip_id) to minimize DB calls
    const tripKeys = new Map();
    for (const r of readings) {
      const key = `${r._device_id}:${r._trip_id}`;
      if (!tripKeys.has(key)) {
        tripKeys.set(key, await trips.ensureTrip(r._device_id, r._trip_id));
      }
      r.trip_pk = tripKeys.get(key);
    }

    // Build arrays for UNNEST
    const tripPks = readings.map(r => r.trip_pk);
    const times = readings.map(r => r.time);
    const speedKmh = readings.map(r => r.speed_kmh);
    const rawGpsKmh = readings.map(r => r.raw_gps_kmh);
    const rawAccKmh = readings.map(r => r.raw_acc_kmh);
    const tempC = readings.map(r => r.temp_c);
    const gasPpm = readings.map(r => r.gas_ppm);
    const pitchDeg = readings.map(r => r.pitch_deg);
    const rollDeg = readings.map(r => r.roll_deg);
    const lat = readings.map(r => r.lat);
    const lon = readings.map(r => r.lon);
    const sat = readings.map(r => r.sat);
    const batteryPct = readings.map(r => r.battery_pct);
    const gpsUtc = readings.map(r => r.gps_utc);
    const geoActive = readings.map(r => r.geo_active);
    const geoBreach = readings.map(r => r.geo_breach);
    const posSrc = readings.map(r => r.pos_src);

    // Batch INSERT using UNNEST
    const query = `
      INSERT INTO readings (
        trip_pk, "time", speed_kmh, raw_gps_kmh, raw_acc_kmh, temp_c, gas_ppm,
        pitch_deg, roll_deg, lat, lon, sat, battery_pct, gps_utc,
        geo_active, geo_breach, pos_src
      )
      SELECT * FROM unnest(
        $1::bigint[],
        $2::timestamptz[],
        $3::real[],
        $4::real[],
        $5::real[],
        $6::real[],
        $7::integer[],
        $8::integer[],
        $9::integer[],
        $10::double precision[],
        $11::double precision[],
        $12::integer[],
        $13::integer[],
        $14::timestamptz[],
        $15::boolean[],
        $16::boolean[],
        $17::smallint[]
      )
    `;

    await pool.query(query, [
      tripPks, times, speedKmh, rawGpsKmh, rawAccKmh, tempC, gasPpm,
      pitchDeg, rollDeg, lat, lon, sat, batteryPct, gpsUtc,
      geoActive, geoBreach, posSrc
    ]);

    if (readings.length > 0) {
      console.log(`[readings] ✓ Flushed ${readings.length} readings to DB`);
    }

  } catch (err) {
    console.error('[readings] ✗ Flush failed:', err.message);
    // Don't re-add to buffer — we'd create duplicates. Log and move on.
  }
}

/**
 * Start the flush timer (call once on startup)
 */
function startFlushTimer() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, 1000);  // flush every 1 second
  console.log('[readings] ✓ Batch flush timer started (every 1s)');
}

/**
 * Stop the flush timer (call on shutdown)
 */
function stopFlushTimer() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/**
 * Get readings for a trip (for REST API)
 */
async function getReadingsForTrip(tripId, limit = 10000, offset = 0) {
  const result = await pool.query(
    `SELECT "time", speed_kmh, raw_gps_kmh, raw_acc_kmh, temp_c, gas_ppm,
            pitch_deg, roll_deg, lat, lon, sat, battery_pct, gps_utc,
            geo_active, geo_breach, pos_src
     FROM readings
     WHERE trip_pk = $1
     ORDER BY "time" ASC
     LIMIT $2 OFFSET $3`,
    [tripId, limit, offset]
  );
  return result.rows;
}

/**
 * Get downsampled readings for replay (stream endpoint)
 * Keeps every Nth row to reduce payload size.
 */
async function getStreamForTrip(tripId, step = 5) {
  const result = await pool.query(
    `SELECT "time", speed_kmh, lat, lon, sat, pos_src
     FROM (
       SELECT *, ROW_NUMBER() OVER (ORDER BY "time") AS rn
       FROM readings
       WHERE trip_pk = $1
     ) sub
     WHERE rn % $2 = 0
     ORDER BY "time" ASC`,
    [tripId, step]
  );
  return result.rows;
}

module.exports = {
  addReading,
  flush,
  startFlushTimer,
  stopFlushTimer,
  getReadingsForTrip,
  getStreamForTrip,
};
