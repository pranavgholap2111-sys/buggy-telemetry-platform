#!/usr/bin/env node
/**
 * ws-test-client.js — simple WebSocket client for testing
 * 
 * Connects to the ingest service WebSocket and prints all events.
 * Run this while the simulator is running to see live telemetry.
 * 
 * Usage:  node tools/ws-test-client.js
 */

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:4000/ws';

console.log(`Connecting to ${WS_URL}...`);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✓ Connected\n');
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    const { event, data: payload } = msg;

    switch (event) {
      case 'hello':
        console.log(`📡 HELLO — ${Object.keys(payload.latest).length} device(s) active`);
        break;

      case 'telemetry':
        console.log(`📊 TELEMETRY — speed=${payload.speed} km/h, ` +
                    `pos=(${payload.lat}, ${payload.lon}), sat=${payload.sat}, ` +
                    `geo_breach=${payload.geo_breach}`);
        break;

      case 'trip_started':
        console.log(`🚗 TRIP STARTED — id=${payload.id}, device=${payload.device_id}, trip=${payload.trip_id}`);
        break;

      case 'trip_ended':
        console.log(`🏁 TRIP ENDED — id=${payload.id}, top=${payload.top_speed_kmh} km/h, ` +
                    `samples=${payload.sample_count}`);
        break;

      case 'geofence_status':
        console.log(`📍 GEOFENCE STATUS — ok=${payload.ok}, type=${payload.type}, info=${payload.info}`);
        break;

      case 'analysis_ready':
        console.log(`📈 ANALYSIS READY — trip id=${payload.id}`);
        break;

      default:
        console.log(`❓ UNKNOWN EVENT: ${event}`, payload);
    }
  } catch (err) {
    console.error('Failed to parse message:', err.message);
  }
});

ws.on('error', (err) => {
  console.error('✗ WebSocket error:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(`\n✓ Disconnected (code=${code}, reason=${reason || 'none'})`);
  process.exit(0);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping...');
  ws.close();
});
