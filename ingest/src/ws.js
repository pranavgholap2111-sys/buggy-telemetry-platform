/**
 * ws.js — WebSocket server for live telemetry relay
 * 
 * Browsers connect here to receive live updates.
 * Every message uses the envelope format: { event: "...", data: {...} }
 * 
 * Events (from contract section 5.5):
 *   - hello: sent on connect, contains latest telemetry per device
 *   - telemetry: each MQTT packet, forwarded to all clients
 *   - trip_started: new trip first seen
 *   - trip_ended: after idle timeout
 *   - analysis_ready: Python finished a trip (Stage 6)
 *   - geofence_status: ESP32 acknowledgement
 * 
 * Note: In Stage 3 we don't enforce JWT auth on the WebSocket.
 *       Stage 7 will add token validation.
 */

const WebSocket = require('ws');
const url = require('url');

let wss = null;

// Latest telemetry per device (for hello event)
const latestTelemetry = new Map();  // key: device_id, value: telemetry object

/**
 * Initialize the WebSocket server, attached to the HTTP server
 */
function init(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const params = url.parse(req.url, true).query;
    const token = params.token || 'none';
    
    // Validate JWT token (Stage 7)
    const { verifyToken } = require('./auth');
    const decoded = verifyToken(token);
    
    if (!decoded) {
      console.log(`[ws] ✗ Client rejected (invalid token)`);
      ws.close(4001, 'Invalid token');
      return;
    }
    
    ws.user = decoded;
    console.log(`[ws] ✓ Client connected (user=${decoded.email}, role=${decoded.role})`);

    // Send hello event with latest telemetry
    const helloData = {};
    for (const [deviceId, telemetry] of latestTelemetry.entries()) {
      helloData[deviceId] = telemetry;
    }
    send(ws, 'hello', { latest: helloData });

    ws.on('close', () => {
      console.log('[ws] Client disconnected');
    });

    ws.on('error', (err) => {
      console.error('[ws] Client error:', err.message);
    });
  });

  console.log('[ws] ✓ WebSocket server initialized on /ws');
}

/**
 * Send a message to a single client
 */
function send(ws, event, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, data }));
  }
}

/**
 * Broadcast a message to all connected clients
 */
function broadcast(event, data) {
  if (!wss) return;
  const message = JSON.stringify({ event, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * Handle incoming telemetry (called from MQTT handler)
 */
function onTelemetry(telemetry) {
  // Add server_time to the telemetry
  const enriched = { ...telemetry, server_time: new Date().toISOString() };
  
  // Update latest cache
  latestTelemetry.set(telemetry.device_id, enriched);
  
  // Broadcast to all WebSocket clients
  broadcast('telemetry', enriched);
}

/**
 * Handle trip started (called from trips module)
 */
function onTripStarted(trip) {
  broadcast('trip_started', {
    id: trip.id,
    device_id: trip.device_id,
    trip_id: trip.trip_id,
  });
}

/**
 * Handle trip ended (called from trips module)
 */
function onTripEnded(trip) {
  broadcast('trip_ended', {
    id: trip.id,
    device_id: trip.device_id,
    trip_id: trip.trip_id,
    top_speed_kmh: trip.top_speed_kmh,
    sample_count: trip.sample_count,
  });
}

/**
 * Handle geofence status (called from MQTT handler)
 */
function onGeofenceStatus(status) {
  broadcast('geofence_status', status);
}

/**
 * Handle analysis ready (called from analysis poller in Stage 6)
 */
function onAnalysisReady(tripId) {
  broadcast('analysis_ready', { id: tripId });
}

/**
 * Get latest telemetry for a device (for REST API)
 */
function getLatestTelemetry(deviceId) {
  if (deviceId) {
    return latestTelemetry.get(deviceId) || null;
  }
  // Return all devices
  const result = {};
  for (const [id, telemetry] of latestTelemetry.entries()) {
    result[id] = telemetry;
  }
  return result;
}

module.exports = {
  init,
  broadcast,
  onTelemetry,
  onTripStarted,
  onTripEnded,
  onGeofenceStatus,
  onAnalysisReady,
  getLatestTelemetry,
};
