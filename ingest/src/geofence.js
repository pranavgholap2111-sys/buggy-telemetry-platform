/**
 * geofence.js — Geofence deployment, validation, and acknowledgement handling
 * 
 * Responsibilities:
 *   - Validate geofence shapes (matching firmware rules exactly)
 *   - Store deployments in the geofences table
 *   - Handle acknowledgements from the buggy
 *   - Detect timeouts (no ack within 10 seconds)
 *   - Broadcast updates via WebSocket
 * 
 * New terms:
 *   - Retained message: MQTT keeps the last message on a topic; new subscribers get it immediately
 *   - Ack: The buggy's confirmation that it received and applied the geofence
 */

const { pool } = require('./db');
const mqttClient = require('./mqtt');
const ws = require('./ws');

// ─────────────────────────────────────────────────────────────
// VALIDATION — must match firmware rules exactly (section 4)
// ─────────────────────────────────────────────────────────────

/**
 * Round a coordinate to 6 decimal places
 */
function roundCoord(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Validate a geofence shape. Returns { valid: true, shape: {...} } or { valid: false, error: "..." }
 * 
 * Rules (from contract section 4):
 *   - Circle: center [lat, lon], radius_m 10..100000
 *   - Polygon: coords array of [lat, lon], 3..32 points
 *   - Clear: just { type: "clear" }
 *   - Lat: -90..90, Lon: -180..180
 */
function validateGeofence(geofence) {
  if (!geofence || typeof geofence !== 'object') {
    return { valid: false, error: 'bad json' };
  }

  if (!geofence.type) {
    return { valid: false, error: 'unknown type' };
  }

  // ── Circle ──────────────────────────────────────────────
  if (geofence.type === 'circle') {
    if (!geofence.center || !Array.isArray(geofence.center) || geofence.center.length !== 2) {
      return { valid: false, error: 'center missing' };
    }

    const [lat, lon] = geofence.center;
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return { valid: false, error: 'center missing' };
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { valid: false, error: 'center out of range' };
    }

    if (!geofence.radius_m || typeof geofence.radius_m !== 'number') {
      return { valid: false, error: 'radius 10..100000 m' };
    }
    if (geofence.radius_m < 10 || geofence.radius_m > 100000) {
      return { valid: false, error: 'radius 10..100000 m' };
    }

    // Round coordinates to 6 decimals (firmware requires consistent JSON)
    const shape = {
      type: 'circle',
      center: [roundCoord(lat), roundCoord(lon)],
      radius_m: geofence.radius_m,
    };

    return { valid: true, shape };
  }

  // ── Polygon ─────────────────────────────────────────────
  if (geofence.type === 'polygon') {
    if (!geofence.coords || !Array.isArray(geofence.coords)) {
      return { valid: false, error: 'polygon needs 3..32 points' };
    }
    if (geofence.coords.length < 3 || geofence.coords.length > 32) {
      return { valid: false, error: 'polygon needs 3..32 points' };
    }

    // Validate each point
    const coords = [];
    for (const point of geofence.coords) {
      if (!Array.isArray(point) || point.length !== 2) {
        return { valid: false, error: 'bad point' };
      }
      const [lat, lon] = point;
      if (typeof lat !== 'number' || typeof lon !== 'number') {
        return { valid: false, error: 'bad point' };
      }
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return { valid: false, error: 'point out of range' };
      }
      coords.push([roundCoord(lat), roundCoord(lon)]);
    }

    const shape = {
      type: 'polygon',
      coords: coords,
    };

    return { valid: true, shape };
  }

  // ── Clear ───────────────────────────────────────────────
  if (geofence.type === 'clear') {
    return { valid: true, shape: { type: 'clear' } };
  }

  return { valid: false, error: 'unknown type' };
}

// ─────────────────────────────────────────────────────────────
// DEPLOYMENT
// ─────────────────────────────────────────────────────────────

/**
 * Deploy a geofence: validate, store, publish, and return the row
 * 
 * @param {object} geofence - the geofence shape from the API
 * @param {number|null} userId - the user who deployed it (null if no auth)
 * @param {string} label - optional label
 * @returns {Promise<object>} the geofence row
 */
async function deployGeofence(geofence, userId = null, label = null) {
  // Validate
  const validation = validateGeofence(geofence);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const shape = validation.shape;

  // Store in database
  const result = await pool.query(
    `INSERT INTO geofences (device_id, shape, label, deployed_by, ack_status)
     VALUES ('buggy01', $1, $2, $3, 'pending')
     RETURNING *`,
    [JSON.stringify(shape), label, userId]
  );

  const row = result.rows[0];

  // Publish to MQTT (retained, QoS 1)
  try {
    mqttClient.publishGeofence(shape);
  } catch (err) {
    // Mark as rejected if publish fails
    await pool.query(
      `UPDATE geofences SET ack_status = 'rejected', ack_info = $1, acked_at = now() WHERE id = $2`,
      ['publish failed', row.id]
    );
    throw err;
  }

  // Start timeout timer (10 seconds)
  setTimeout(() => checkAckTimeout(row.id), 10000);

  // Broadcast update
  broadcastGeofenceUpdate(row);

  console.log(`[geofence] ✓ Deployed geofence id=${row.id}, type=${shape.type}`);
  return row;
}

// ─────────────────────────────────────────────────────────────
// ACKNOWLEDGEMENT HANDLING
// ─────────────────────────────────────────────────────────────

/**
 * Handle an acknowledgement from the buggy
 * 
 * @param {object} ack - the ack payload from MQTT
 */
async function handleAck(ack) {
  if (!ack || !ack.device_id) {
    console.warn('[geofence] ⚠ Ack missing device_id, ignoring');
    return;
  }

  // Find the newest pending geofence for this device
  const result = await pool.query(
    `SELECT id FROM geofences 
     WHERE device_id = $1 AND ack_status = 'pending'
     ORDER BY deployed_at DESC
     LIMIT 1`,
    [ack.device_id]
  );

  if (result.rows.length === 0) {
    console.warn('[geofence] ⚠ No pending geofence for device', ack.device_id);
    return;
  }

  const geofenceId = result.rows[0].id;

  // Update the row based on the ack
  let ackStatus, ackInfo;
  if (ack.ok) {
    if (ack.info === 'applied' || ack.info === 'unchanged') {
      ackStatus = ack.info;
      ackInfo = ack.info;
    } else {
      ackStatus = 'applied';
      ackInfo = ack.info || 'applied';
    }
  } else {
    ackStatus = 'rejected';
    ackInfo = ack.info || 'rejected';
  }

  await pool.query(
    `UPDATE geofences 
     SET ack_status = $1, ack_info = $2, acked_at = now()
     WHERE id = $3`,
    [ackStatus, ackInfo, geofenceId]
  );

  // Fetch the updated row
  const updated = await pool.query('SELECT * FROM geofences WHERE id = $1', [geofenceId]);
  const row = updated.rows[0];

  // Broadcast update
  broadcastGeofenceUpdate(row);

  console.log(`[geofence] ✓ Ack received for id=${geofenceId}: ${ackStatus} (${ackInfo})`);
}

/**
 * Check if a geofence has timed out (no ack within 10 seconds)
 */
async function checkAckTimeout(geofenceId) {
  const result = await pool.query(
    `SELECT ack_status FROM geofences WHERE id = $1`,
    [geofenceId]
  );

  if (result.rows.length === 0) return;

  const row = result.rows[0];
  if (row.ack_status === 'pending') {
    // Still pending after 10 seconds — mark as no_response
    await pool.query(
      `UPDATE geofences 
       SET ack_status = 'no_response', ack_info = 'no ack received within 10s', acked_at = now()
       WHERE id = $1`,
      [geofenceId]
    );

    // Fetch and broadcast
    const updated = await pool.query('SELECT * FROM geofences WHERE id = $1', [geofenceId]);
    broadcastGeofenceUpdate(updated.rows[0]);

    console.log(`[geofence] ⚠ Geofence id=${geofenceId} timed out (no ack)`);
  }
}

// ─────────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────────

/**
 * Get the current active geofence
 * 
 * The "current fence" = newest row where ack_status != 'rejected'
 * If its shape type is 'clear', there is no active fence.
 */
async function getCurrentGeofence() {
  const result = await pool.query(
    `SELECT * FROM geofences 
     WHERE device_id = 'buggy01' AND ack_status != 'rejected'
     ORDER BY deployed_at DESC
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  if (row.shape.type === 'clear') {
    return null; // No active fence
  }

  return row;
}

/**
 * Get geofence deployment history
 */
async function getGeofenceHistory(limit = 20) {
  const result = await pool.query(
    `SELECT g.*, u.email as deployed_by_email
     FROM geofences g
     LEFT JOIN users u ON g.deployed_by = u.id
     WHERE g.device_id = 'buggy01'
     ORDER BY g.deployed_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}

// ─────────────────────────────────────────────────────────────
// WEBSOCKET BROADCAST
// ─────────────────────────────────────────────────────────────

/**
 * Broadcast a geofence update to all connected clients
 */
function broadcastGeofenceUpdate(row) {
  ws.broadcast('geofence_updated', {
    id: row.id,
    shape: row.shape,
    ack_status: row.ack_status,
    ack_info: row.ack_info,
    deployed_by: row.deployed_by,
    deployed_at: row.deployed_at,
  });
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  validateGeofence,
  deployGeofence,
  handleAck,
  getCurrentGeofence,
  getGeofenceHistory,
  broadcastGeofenceUpdate,
};
