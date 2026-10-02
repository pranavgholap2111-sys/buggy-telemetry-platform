/**
 * mqtt.js — MQTT client for subscribing to telemetry and publishing geofence
 * 
 * Subscribes to:
 *   - reduntech/buggy/telemetry (QoS 0) — incoming telemetry from ESP32/simulator
 *   - reduntech/buggy/geofence/status (QoS 1) — ESP32 acknowledgement
 * 
 * Publishes to:
 *   - reduntech/buggy/geofence (QoS 1, retained) — geofence command from dashboard
 */

const mqtt = require('mqtt');
const config = require('./config');
const readings = require('./readings');
const ws = require('./ws');

let client = null;

/**
 * Connect to the MQTT broker and set up subscriptions
 */
function connect() {
  console.log(`[mqtt] Connecting to ${config.mqttUrl}...`);

  client = mqtt.connect(config.mqttUrl, {
    clientId: `ingest-${process.pid}-${Date.now()}`,
    clean: true,
    connectTimeout: 5000,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    console.log('[mqtt] ✓ Connected to broker');

    // Subscribe to telemetry (QoS 0 — fire and forget, next reading arrives in 0.2s)
    client.subscribe(config.topics.telemetry, { qos: 0 }, (err) => {
      if (err) {
        console.error('[mqtt] ✗ Failed to subscribe to telemetry:', err.message);
      } else {
        console.log(`[mqtt] ✓ Subscribed to ${config.topics.telemetry}`);
      }
    });

    // Subscribe to geofence status (QoS 1 — we want acknowledgement)
    client.subscribe(config.topics.geofenceStatus, { qos: 1 }, (err) => {
      if (err) {
        console.error('[mqtt] ✗ Failed to subscribe to geofence status:', err.message);
      } else {
        console.log(`[mqtt] ✓ Subscribed to ${config.topics.geofenceStatus}`);
      }
    });
  });

  client.on('message', (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());

      if (topic === config.topics.telemetry) {
        handleTelemetry(payload);
      } else if (topic === config.topics.geofenceStatus) {
        handleGeofenceStatus(payload);
      }
    } catch (err) {
      // Contract rule: "Ignore malformed JSON. Never crash on bad input."
      console.error('[mqtt] ✗ Failed to parse message:', err.message);
    }
  });

  client.on('error', (err) => {
    console.error('[mqtt] ✗ Connection error:', err.message);
  });

  client.on('offline', () => {
    console.warn('[mqtt] ⚠ Broker connection lost, attempting to reconnect...');
  });

  client.on('reconnect', () => {
    console.log('[mqtt] ↻ Reconnecting to broker...');
  });
}

/**
 * Handle incoming telemetry message
 */
function handleTelemetry(telemetry) {
  // Validate required fields (defensive programming)
  if (!telemetry.device_id || !telemetry.trip_id) {
    console.warn('[mqtt] ⚠ Telemetry missing device_id or trip_id, ignoring');
    return;
  }

  // Add to batch buffer (will be flushed every 1 second)
  readings.addReading(telemetry);

  // Relay to WebSocket clients immediately (live view)
  ws.onTelemetry(telemetry);
}

/**
 * Handle geofence status acknowledgement from ESP32
 * Updates the geofences table and broadcasts via WebSocket
 */
async function handleGeofenceStatus(status) {
  console.log('[mqtt] 📍 Geofence ack:', JSON.stringify(status));
  
  // Keep the old WebSocket event for backwards compatibility
  ws.onGeofenceStatus(status);
  
  // Also update the geofences table via the geofence module
  try {
    const geofence = require('./geofence');
    await geofence.handleAck(status);
  } catch (err) {
    console.error('[mqtt] ✗ Error handling geofence ack:', err.message);
  }
}

/**
 * Publish a geofence command (retained, QoS 1)
 * Called from the REST API when the dashboard sends a geofence.
 */
function publishGeofence(geofence) {
  if (!client || !client.connected) {
    throw new Error('MQTT client not connected');
  }

  const payload = JSON.stringify(geofence);
  console.log(`[mqtt] 📍 Publishing geofence: ${payload}`);

  client.publish(config.topics.geofence, payload, {
    qos: 1,
    retain: true,  // contract: "Always publish retained"
  }, (err) => {
    if (err) {
      console.error('[mqtt] ✗ Failed to publish geofence:', err.message);
      throw err;
    }
    console.log('[mqtt] ✓ Geofence published (retained)');
  });
}

/**
 * Disconnect gracefully (call on shutdown)
 */
function disconnect() {
  if (client) {
    client.end(() => {
      console.log('[mqtt] ✓ Disconnected from broker');
    });
  }
}

module.exports = {
  connect,
  publishGeofence,
  disconnect,
};
