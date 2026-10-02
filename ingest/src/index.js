/**
 * index.js — main entry point for the ingest service
 * 
 * This file:
 *   1. Tests the database connection
 *   2. Connects to the MQTT broker
 *   3. Starts the Express HTTP server
 *   4. Attaches the WebSocket server to HTTP
 *   5. Starts periodic tasks (idle trip detection, analysis polling)
 *   6. Handles graceful shutdown
 */

const http = require('http');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./db');
const mqttClient = require('./mqtt');
const readings = require('./readings');
const ws = require('./ws');
const trips = require('./trips');
const api = require('./api');

// ─────────────────────────────────────────────────────────────
// 1. Create Express app
// ─────────────────────────────────────────────────────────────
const app = express();

// Middleware
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
}));
app.use(express.json());  // Parse JSON request bodies

// Extract user from JWT (sets req.user if valid token, doesn't reject)
const { extractUser } = require('./auth');
app.use(extractUser);

// Request logging (simple)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[http] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Mount API routes
const authRoutes = require('./authRoutes');
app.use('/api/auth', authRoutes);
app.use('/api', api);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[http] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─────────────────────────────────────────────────────────────
// 2. Create HTTP server and attach WebSocket
// ─────────────────────────────────────────────────────────────
const server = http.createServer(app);
ws.init(server);

// ─────────────────────────────────────────────────────────────
// 3. Periodic tasks
// ─────────────────────────────────────────────────────────────

// Check for idle trips every 5 seconds
let idleCheckTimer = null;
function startIdleCheck() {
  idleCheckTimer = setInterval(async () => {
    try {
      const endedTrips = await trips.checkIdleTrips();
      for (const trip of endedTrips) {
        ws.onTripEnded(trip);
      }
    } catch (err) {
      console.error('[main] Idle check error:', err.message);
    }
  }, 5000);
  console.log('[main] ✓ Idle trip check started (every 5s)');
}

// Poll for newly completed analyses and emit WebSocket events
let analysisPollTimer = null;
let lastKnownDoneTrips = new Set();

async function initializeDoneTrips() {
  try {
    const { pool } = require('./db');
    const result = await pool.query(
      "SELECT id FROM trips WHERE analysis_status = 'done'"
    );
    for (const row of result.rows) {
      lastKnownDoneTrips.add(row.id);
    }
    console.log(`[main] ✓ Initialized ${lastKnownDoneTrips.size} known completed analyses`);
  } catch (err) {
    console.error('[main] Error initializing done trips:', err.message);
  }
}

function startAnalysisPoll() {
  analysisPollTimer = setInterval(async () => {
    try {
      const { pool } = require('./db');
      const result = await pool.query(
        "SELECT id FROM trips WHERE analysis_status = 'done'"
      );
      for (const row of result.rows) {
        if (!lastKnownDoneTrips.has(row.id)) {
          // New analysis completed!
          lastKnownDoneTrips.add(row.id);
          console.log(`[main] 📈 Analysis ready for trip ${row.id}`);
          ws.onAnalysisReady(row.id);
        }
      }
    } catch (err) {
      console.error('[main] Analysis poll error:', err.message);
    }
  }, 5000);
  console.log('[main] ✓ Analysis poller started (every 5s)');
}

// ─────────────────────────────────────────────────────────────
// 4. Startup sequence
// ─────────────────────────────────────────────────────────────
async function start() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Buggy Telemetry Ingest Service');
  console.log('═══════════════════════════════════════════════════\n');

  // Test database connection
  const dbOk = await db.testConnection();
  if (!dbOk) {
    console.error('[main] ✗ Database connection failed. Exiting.');
    process.exit(1);
  }

  // Connect to MQTT broker
  mqttClient.connect();

  // Start batch flush timer for readings
  readings.startFlushTimer();

  // Initialize known completed analyses (so we don't re-emit old events)
  await initializeDoneTrips();

  // Start idle trip detection
  startIdleCheck();

  // Start analysis poller (emits WebSocket events when Python finishes)
  startAnalysisPoll();

  // Start HTTP server
  server.listen(config.port, () => {
    console.log(`[main] ✓ HTTP server listening on port ${config.port}`);
    console.log(`[main]   REST API: http://localhost:${config.port}/api/health`);
    console.log(`[main]   WebSocket: ws://localhost:${config.port}/ws`);
    console.log('\n[main] ✓ All systems ready. Waiting for telemetry...\n');
  });
}

// ─────────────────────────────────────────────────────────────
// 5. Graceful shutdown
// ─────────────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[main] 🛑 Received ${signal}, shutting down gracefully...`);

  // Stop timers
  if (idleCheckTimer) clearInterval(idleCheckTimer);
  if (analysisPollTimer) clearInterval(analysisPollTimer);
  readings.stopFlushTimer();

  // Flush any remaining readings
  console.log('[main] Flushing remaining readings...');
  await readings.flush();

  // Disconnect MQTT
  mqttClient.disconnect();

  // Close HTTP server
  server.close(() => {
    console.log('[main] ✓ HTTP server closed');
  });

  // Close database pool
  await db.pool.end();
  console.log('[main] ✓ Database pool closed');

  console.log('[main] ✓ Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Catch unhandled errors (don't crash silently)
process.on('unhandledRejection', (reason) => {
  console.error('[main] ✗ Unhandled promise rejection:', reason);
});

// ─────────────────────────────────────────────────────────────
// Go!
// ─────────────────────────────────────────────────────────────
start().catch((err) => {
  console.error('[main] ✗ Startup failed:', err.message);
  process.exit(1);
});
