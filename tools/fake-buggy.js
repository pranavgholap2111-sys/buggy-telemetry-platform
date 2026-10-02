#!/usr/bin/env node
/**
 * fake-buggy.js — Simulates an ESP32 publishing telemetry at 5 Hz
 * 
 * This script pretends to be the buggy's microcontroller. It:
 *   1. Connects to Mosquitto on localhost:1883
 *   2. Generates a unique trip_id (fixed for this "power-on session")
 *   3. Publishes telemetry JSON every 200 ms to reduntech/buggy/telemetry
 *   4. Subscribes to reduntech/buggy/geofence (retained) and evaluates breaches
 *   5. Simulates a lap around a track with varying speed and GPS quality
 *   6. Implements firmware-identical geofence logic:
 *      - Validates shapes with same limits as firmware
 *      - Uses 3/5 sample confirmation for breach detection
 *      - Detects identical payloads and responds "unchanged"
 *      - Only evaluates with fresh GPS (pos_src=0, sat>=4)
 * 
 * Run:  node fake-buggy.js
 * Fast: node fake-buggy.js --fast   (publishes every 50 ms instead of 200 ms)
 * Breach test: node fake-buggy.js --breach  (drives buggy out of fence)
 * 
 * Press Ctrl+C to stop gracefully.
 */

const mqtt = require('mqtt');

// ─────────────────────────────────────────────────────────────
// CONFIGURATION — tune these to change simulator behavior
// ─────────────────────────────────────────────────────────────
const CONFIG = {
  // MQTT broker (matches docker-compose.yml)
  brokerUrl: 'mqtt://localhost:1883',
  
  // MQTT topics (from contract section 4)
  telemetryTopic: 'reduntech/buggy/telemetry',
  geofenceTopic: 'reduntech/buggy/geofence',
  geofenceStatusTopic: 'reduntech/buggy/geofence/status',
  
  // Device identity
  deviceId: 'buggy01',
  
  // Publish interval in milliseconds (5 Hz = 200 ms)
  publishIntervalMs: 200,
  
  // Starting position (somewhere near Nashik, India — adjust to your campus)
  startLat: 19.997500,
  startLon: 73.789800,
  
  // Track: oval path around the start point
  trackRadiusLat: 0.002,   // ~220 m north-south
  trackRadiusLon: 0.003,   // ~320 m east-west (adjusted for latitude)
  
  // Speed range (km/h)
  minSpeed: 0,
  maxSpeed: 60,
  
  // GPS quality: how often to simulate bad GPS (0.0 = never, 1.0 = always)
  badGpsProbability: 0.05,  // 5% chance per reading
  
  // Sensors: base values with noise
  baseTemp: 31.5,
  tempNoise: 2.0,
  baseGas: 220,
  gasNoise: 50,
  
  // Geofence breach confirmation (matches firmware)
  breachConfirmSamples: 3,   // 3 consecutive outside samples = breach (0.6s)
  clearConfirmSamples: 5,    // 5 consecutive inside samples = clear (1.0s)
};

// ─────────────────────────────────────────────────────────────
// COMMAND-LINE FLAGS
// ─────────────────────────────────────────────────────────────
const FAST_MODE = process.argv.includes('--fast');
const BREACH_MODE = process.argv.includes('--breach');

// ─────────────────────────────────────────────────────────────
// TRIP INITIALIZATION — generate trip_id once per "power-on"
// ─────────────────────────────────────────────────────────────
const tripId = `BUGGY_B${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`;
console.log(`[fake-buggy] Starting new trip: ${tripId}`);
console.log(`[fake-buggy] Device ID: ${CONFIG.deviceId}`);
if (FAST_MODE) console.log('[fake-buggy] ⚡ FAST MODE (50ms interval)');
if (BREACH_MODE) console.log('[fake-buggy] ⚠️  BREACH MODE (will drive outside fence)');
console.log(`[fake-buggy] Connecting to ${CONFIG.brokerUrl}...`);

// ─────────────────────────────────────────────────────────────
// SIMULATION STATE
// ─────────────────────────────────────────────────────────────
const state = {
  // Position and movement
  angle: 0,
  angularSpeed: 0.02,
  speed: 0,
  
  // GPS quality
  satellites: 8,
  posSrc: 0,
  lastGoodLat: CONFIG.startLat,
  lastGoodLon: CONFIG.startLon,
  
  // Geofence (starts with NO fence — firmware boots with none)
  geofence: null,            // null = no fence loaded
  lastPayload: null,         // raw JSON string of last applied fence (for identical check)
  geoActive: 0,              // 0 = no fence, 1 = fence loaded
  geoBreach: 0,              // 0 = inside/no fence, 1 = outside
  
  // Breach confirmation counters (firmware uses 3/5 sample logic)
  outsideCount: 0,           // consecutive samples outside fence
  insideCount: 0,            // consecutive samples inside fence
  
  // Counters
  sampleCount: 0
};

// ─────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

function addNoise(base, range) {
  return base + (Math.random() * 2 - 1) * range;
}

/**
 * Haversine distance between two GPS coordinates in meters
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function round(value, decimals) {
  return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}

/**
 * Point-in-polygon test using ray casting algorithm
 * Returns true if point (lat, lon) is inside the polygon
 */
function pointInPolygon(lat, lon, coords) {
  let inside = false;
  const n = coords.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [latI, lonI] = coords[i];
    const [latJ, lonJ] = coords[j];
    
    if (((lonI > lon) !== (lonJ > lon)) &&
        (lat < (latJ - latI) * (lon - lonI) / (lonJ - lonI) + latI)) {
      inside = !inside;
    }
  }
  
  return inside;
}

// ─────────────────────────────────────────────────────────────
// SIMULATION LOGIC
// ─────────────────────────────────────────────────────────────

function updateSpeed() {
  const baseSpeed = 35;
  const variation = 20;
  const targetSpeed = baseSpeed + variation * Math.sin(state.angle * 2);
  
  state.speed += (targetSpeed - state.speed) * 0.1;
  state.speed = Math.max(CONFIG.minSpeed, Math.min(CONFIG.maxSpeed, state.speed));
}

function updatePosition() {
  state.angularSpeed = (state.speed / 100) * 0.05;
  
  // In breach mode, drive further out to trigger breach
  let radiusLat = CONFIG.trackRadiusLat;
  let radiusLon = CONFIG.trackRadiusLon;
  if (BREACH_MODE) {
    radiusLat *= 2.5;  // Drive 2.5x further out
    radiusLon *= 2.5;
  }
  
  state.angle += state.angularSpeed;
  
  const lat = CONFIG.startLat + radiusLat * Math.sin(state.angle);
  const lon = CONFIG.startLon + radiusLon * Math.cos(state.angle);
  
  // Simulate GPS quality degradation
  if (Math.random() < CONFIG.badGpsProbability) {
    state.satellites = Math.floor(Math.random() * 3) + 1;
    state.posSrc = Math.random() < 0.5 ? 1 : 4;
  } else {
    state.satellites = Math.floor(Math.random() * 4) + 7;
    state.posSrc = 0;
    state.lastGoodLat = lat;
    state.lastGoodLon = lon;
  }
}

/**
 * Evaluate geofence breach with firmware-identical logic:
 *   - Only evaluate when pos_src=0 and sat>=4 (fresh GPS fix)
 *   - Breach raised after 3 consecutive outside samples (0.6s)
 *   - Breach cleared after 5 consecutive inside samples (1.0s)
 *   - With no GPS fix, alarm stays in previous state
 */
function evaluateGeofence() {
  // No fence loaded
  if (!state.geofence || state.geofence.type === 'clear') {
    state.geoActive = 0;
    state.geoBreach = 0;
    state.outsideCount = 0;
    state.insideCount = 0;
    return;
  }
  
  state.geoActive = 1;
  
  // Only evaluate with good GPS (firmware rule)
  if (state.posSrc !== 0 || state.satellites < 4) {
    // Can't evaluate — keep previous breach status
    return;
  }
  
  // Get current position
  const currentLat = CONFIG.startLat + 
    (BREACH_MODE ? CONFIG.trackRadiusLat * 2.5 : CONFIG.trackRadiusLat) * Math.sin(state.angle);
  const currentLon = CONFIG.startLon + 
    (BREACH_MODE ? CONFIG.trackRadiusLon * 2.5 : CONFIG.trackRadiusLon) * Math.cos(state.angle);
  
  // Check if outside fence
  let isOutside = false;
  
  if (state.geofence.type === 'circle') {
    const [centerLat, centerLon] = state.geofence.center;
    const distance = haversineDistance(currentLat, currentLon, centerLat, centerLon);
    isOutside = distance > state.geofence.radius_m;
  } else if (state.geofence.type === 'polygon') {
    isOutside = !pointInPolygon(currentLat, currentLon, state.geofence.coords);
  }
  
  // Apply 3/5 sample confirmation logic
  if (isOutside) {
    state.outsideCount++;
    state.insideCount = 0;
    
    // Breach raised after 3 consecutive outside samples
    if (state.outsideCount >= CONFIG.breachConfirmSamples) {
      state.geoBreach = 1;
    }
  } else {
    state.insideCount++;
    state.outsideCount = 0;
    
    // Breach cleared after 5 consecutive inside samples
    if (state.insideCount >= CONFIG.clearConfirmSamples) {
      state.geoBreach = 0;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// TELEMETRY CONSTRUCTION
// ─────────────────────────────────────────────────────────────

function buildTelemetry() {
  let radiusLat = CONFIG.trackRadiusLat;
  let radiusLon = CONFIG.trackRadiusLon;
  if (BREACH_MODE) {
    radiusLat *= 2.5;
    radiusLon *= 2.5;
  }
  
  const currentLat = CONFIG.startLat + radiusLat * Math.sin(state.angle);
  const currentLon = CONFIG.startLon + radiusLon * Math.cos(state.angle);
  
  const lat = state.posSrc === 0 ? currentLat : state.lastGoodLat;
  const lon = state.posSrc === 0 ? currentLon : state.lastGoodLon;
  
  const rawGps = state.posSrc === 0 ? Math.round(state.speed + addNoise(0, 2)) : 0;
  const rawAcc = Math.round(state.speed + addNoise(0, 3));
  
  const temp = round(addNoise(CONFIG.baseTemp, CONFIG.tempNoise), 1);
  const gas = Math.round(addNoise(CONFIG.baseGas, CONFIG.gasNoise));
  
  const pitch = Math.round(Math.sin(state.angle * 3) * 5);
  const roll = Math.round(Math.cos(state.angle * 2) * 4);
  
  const utc = new Date().toISOString();
  
  return {
    device_id: CONFIG.deviceId,
    trip_id: tripId,
    speed: Math.round(state.speed),
    rawGps: rawGps,
    rawAcc: rawAcc,
    temp: temp,
    gas: gas,
    pitch: pitch,
    roll: roll,
    lat: round(lat, 6),
    lon: round(lon, 6),
    sat: state.satellites,
    battery: 100,
    utc: utc,
    geo_active: state.geoActive,
    geo_breach: state.geoBreach,
    pos_src: state.posSrc
  };
}

// ─────────────────────────────────────────────────────────────
// GEOFENCE VALIDATION (matches firmware rules exactly)
// ─────────────────────────────────────────────────────────────

/**
 * Validate a geofence command. Returns { ok: true } or { ok: false, info: "error string" }
 * Error strings match the firmware exactly.
 */
function validateGeofence(geofence) {
  if (!geofence || typeof geofence !== 'object') {
    return { ok: false, info: 'bad json' };
  }
  
  if (!geofence.type) {
    return { ok: false, info: 'unknown type' };
  }
  
  // ── Clear ──
  if (geofence.type === 'clear') {
    return { ok: true };
  }
  
  // ── Circle ──
  if (geofence.type === 'circle') {
    if (!geofence.center || !Array.isArray(geofence.center) || geofence.center.length !== 2) {
      return { ok: false, info: 'center missing' };
    }
    const [lat, lon] = geofence.center;
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return { ok: false, info: 'center missing' };
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { ok: false, info: 'center out of range' };
    }
    if (typeof geofence.radius_m !== 'number' || geofence.radius_m < 10 || geofence.radius_m > 100000) {
      return { ok: false, info: 'radius 10..100000 m' };
    }
    return { ok: true };
  }
  
  // ── Polygon ──
  if (geofence.type === 'polygon') {
    if (!geofence.coords || !Array.isArray(geofence.coords)) {
      return { ok: false, info: 'polygon needs 3..32 points' };
    }
    if (geofence.coords.length < 3 || geofence.coords.length > 32) {
      return { ok: false, info: 'polygon needs 3..32 points' };
    }
    for (const point of geofence.coords) {
      if (!Array.isArray(point) || point.length !== 2) {
        return { ok: false, info: 'bad point' };
      }
      const [lat, lon] = point;
      if (typeof lat !== 'number' || typeof lon !== 'number') {
        return { ok: false, info: 'bad point' };
      }
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return { ok: false, info: 'point out of range' };
      }
    }
    return { ok: true };
  }
  
  return { ok: false, info: 'unknown type' };
}

// ─────────────────────────────────────────────────────────────
// MQTT CONNECTION AND MESSAGE HANDLING
// ─────────────────────────────────────────────────────────────

const client = mqtt.connect(CONFIG.brokerUrl, {
  clientId: `fake-buggy-${CONFIG.deviceId}-${Date.now()}`,
  clean: true,
  connectTimeout: 4000,
  reconnectPeriod: 5000
});

/**
 * Send an acknowledgement on the geofence/status topic
 */
function sendAck(ok, type, points, info) {
  const ack = {
    device_id: CONFIG.deviceId,
    ok: ok,
    type: type,    // 0=none, 1=circle, 2=polygon
    points: points,
    info: info
  };
  const payload = JSON.stringify(ack);
  client.publish(CONFIG.geofenceStatusTopic, payload, { qos: 1 });
  console.log(`[fake-buggy] 📍 Sent ack: ok=${ok}, type=${type}, info="${info}"`);
}

client.on('connect', () => {
  console.log('[fake-buggy] ✓ Connected to broker');
  console.log(`[fake-buggy] Publishing to: ${CONFIG.telemetryTopic}`);
  console.log(`[fake-buggy] Subscribing to: ${CONFIG.geofenceTopic}`);
  console.log('[fake-buggy] Press Ctrl+C to stop\n');
  
  // Subscribe to geofence commands (QoS 1)
  client.subscribe(CONFIG.geofenceTopic, { qos: 1 }, (err) => {
    if (err) {
      console.error('[fake-buggy] ✗ Failed to subscribe to geofence:', err.message);
    } else {
      console.log('[fake-buggy] ✓ Subscribed to geofence topic');
    }
  });
  
  startPublishing();
});

client.on('error', (err) => {
  console.error('[fake-buggy] ✗ MQTT error:', err.message);
});

client.on('offline', () => {
  console.log('[fake-buggy] ⚠ Broker connection lost, attempting to reconnect...');
});

client.on('reconnect', () => {
  console.log('[fake-buggy] ↻ Reconnecting to broker...');
});

// Handle incoming geofence commands
client.on('message', (topic, message) => {
  if (topic !== CONFIG.geofenceTopic) return;
  
  const rawPayload = message.toString();
  console.log(`[fake-buggy] 📍 Received geofence: ${rawPayload}`);
  
  // Parse JSON
  let geofence;
  try {
    geofence = JSON.parse(rawPayload);
  } catch (err) {
    console.error('[fake-buggy] ✗ Bad JSON');
    sendAck(false, 0, 0, 'bad json');
    return;
  }
  
  // Check for identical payload (firmware compares raw JSON string)
  if (state.lastPayload === rawPayload) {
    console.log('[fake-buggy] ↩ Identical payload — responding "unchanged"');
    const typeNum = geofence.type === 'circle' ? 1 : geofence.type === 'polygon' ? 2 : 0;
    const points = geofence.type === 'polygon' && geofence.coords ? geofence.coords.length : 0;
    sendAck(true, typeNum, points, 'unchanged');
    return;
  }
  
  // Validate
  const validation = validateGeofence(geofence);
  if (!validation.ok) {
    console.error(`[fake-buggy] ✗ Validation failed: ${validation.info}`);
    sendAck(false, 0, 0, validation.info);
    return;
  }
  
  // Apply the fence
  state.geofence = geofence;
  state.lastPayload = rawPayload;
  state.outsideCount = 0;
  state.insideCount = 0;
  
  if (geofence.type === 'clear') {
    state.geoActive = 0;
    state.geoBreach = 0;
    console.log('[fake-buggy] ✓ Geofence cleared');
    sendAck(true, 0, 0, 'applied');
  } else if (geofence.type === 'circle') {
    state.geoActive = 1;
    console.log(`[fake-buggy] ✓ Circle geofence applied (radius: ${geofence.radius_m} m)`);
    sendAck(true, 1, 0, 'applied');
  } else if (geofence.type === 'polygon') {
    state.geoActive = 1;
    console.log(`[fake-buggy] ✓ Polygon geofence applied (${geofence.coords.length} points)`);
    sendAck(true, 2, geofence.coords.length, 'applied');
  }
});

// ─────────────────────────────────────────────────────────────
// PUBLISHING LOOP
// ─────────────────────────────────────────────────────────────

let publishTimer = null;

function startPublishing() {
  const interval = FAST_MODE ? 50 : CONFIG.publishIntervalMs;
  
  console.log(`[fake-buggy] Publishing every ${interval} ms${FAST_MODE ? ' (FAST MODE)' : ''}\n`);
  
  publishTimer = setInterval(() => {
    updateSpeed();
    updatePosition();
    evaluateGeofence();
    
    const telemetry = buildTelemetry();
    const payload = JSON.stringify(telemetry);
    
    client.publish(CONFIG.telemetryTopic, payload, { qos: 0 }, (err) => {
      if (err) {
        console.error('[fake-buggy] ✗ Failed to publish:', err.message);
      }
    });
    
    state.sampleCount++;
    
    // Log every 5 seconds (25 samples at 5 Hz)
    if (state.sampleCount % 25 === 0) {
      const breachStr = state.geoBreach ? '🚨 BREACH' : 'inside';
      const fenceStr = state.geoActive ? `fence=${state.geofence.type}` : 'no fence';
      console.log(`[fake-buggy] 📊 #${state.sampleCount}: speed=${telemetry.speed} km/h, ` +
                  `pos=(${telemetry.lat}, ${telemetry.lon}), sat=${telemetry.sat}, ` +
                  `${fenceStr}, ${breachStr}`);
    }
  }, interval);
}

// ─────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n[fake-buggy] 🛑 Stopping...');
  if (publishTimer) {
    clearInterval(publishTimer);
  }
  client.end(() => {
    console.log(`[fake-buggy] ✓ Published ${state.sampleCount} samples total`);
    console.log('[fake-buggy] ✓ Disconnected from broker');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  process.emit('SIGINT');
});
