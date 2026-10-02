/**
 * api.js — REST API routes
 * 
 * Implements the routes from contract section 5.6.
 * In Stage 3 we implement the routes without auth enforcement.
 * Stage 7 will add JWT validation middleware.
 * 
 * Routes implemented in Stage 3:
 *   GET  /api/health           — public
 *   GET  /api/live/latest      — viewer (no auth yet)
 *   GET  /api/trips            — viewer
 *   GET  /api/trips/:id        — viewer
 *   GET  /api/trips/:id/stream — viewer
 *   POST /api/geofence         — team (no auth yet)
 * 
 * Routes deferred to Stage 7:
 *   POST /api/auth/login
 *   GET  /api/me
 *   GET  /api/trips/:id/summary
 *   POST /api/trips/:id/reanalyze
 *   DELETE /api/trips/:id
 *   GET/POST/DELETE /api/users
 */

const express = require('express');
const trips = require('./trips');
const readings = require('./readings');
const ws = require('./ws');
const mqttClient = require('./mqtt');
const { requireAuth, requireRole } = require('./auth');

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Health check (public)
// ─────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────
// Live latest telemetry (viewer)
// ─────────────────────────────────────────────────────────────
router.get('/live/latest', requireAuth, (req, res) => {
  const deviceId = req.query.device_id;
  const latest = ws.getLatestTelemetry(deviceId);
  
  if (deviceId && !latest) {
    return res.status(404).json({ error: 'Device not found or no telemetry yet' });
  }
  
  res.json(latest);
});

// ─────────────────────────────────────────────────────────────
// List trips (viewer)
// ─────────────────────────────────────────────────────────────
router.get('/trips', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const tripsList = await trips.listTrips(limit, offset);
    res.json(tripsList);
  } catch (err) {
    console.error('[api] Error listing trips:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// Get trip detail (viewer)
// ─────────────────────────────────────────────────────────────
router.get('/trips/:id', requireAuth, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id, 10);
    const trip = await trips.getTripById(tripId);
    
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    
    // Optionally include readings
    if (req.query.include_readings === 'true') {
      const limit = parseInt(req.query.limit || '10000', 10);
      const offset = parseInt(req.query.offset || '0', 10);
      trip.readings = await readings.getReadingsForTrip(tripId, limit, offset);
    }
    
    res.json(trip);
  } catch (err) {
    console.error('[api] Error getting trip:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// Get downsampled readings for replay (viewer)
// ─────────────────────────────────────────────────────────────
router.get('/trips/:id/stream', requireAuth, async (req, res) => {
  try {
    const tripId = parseInt(req.params.id, 10);
    const step = parseInt(req.query.step || '5', 10);
    
    // Verify trip exists
    const trip = await trips.getTripById(tripId);
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    
    const stream = await readings.getStreamForTrip(tripId, step);
    res.json({
      trip_id: tripId,
      step: step,
      count: stream.length,
      readings: stream,
    });
  } catch (err) {
    console.error('[api] Error getting stream:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// Get trip summary / analysis (team)
// ─────────────────────────────────────────────────────────────
router.get('/trips/:id/summary', requireRole('team'), async (req, res) => {
  try {
    const tripId = parseInt(req.params.id, 10);
    const { pool } = require('./db');
    
    const result = await pool.query(
      `SELECT ts.story_text, ts.metrics, ts.created_at, t.analysis_status
       FROM trips t
       LEFT JOIN trip_summaries ts ON ts.trip_pk = t.id
       WHERE t.id = $1`,
      [tripId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Trip not found' });
    }
    
    const row = result.rows[0];
    if (!row.story_text) {
      return res.json({ 
        status: row.analysis_status, 
        message: 'Analysis not yet available' 
      });
    }
    
    res.json({
      status: row.analysis_status,
      story: row.story_text,
      metrics: row.metrics,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error('[api] Error getting summary:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// Deploy geofence command (team+)
// Validates, stores in DB, publishes to MQTT, returns row id
// ─────────────────────────────────────────────────────────────
router.post('/geofence', requireRole('team'), async (req, res) => {
  try {
    const geofence = require('./geofence');
    const userId = req.user ? req.user.id : null;
    const label = req.body.label || null;
    
    const row = await geofence.deployGeofence(req.body, userId, label);
    res.status(201).json(row);
    
  } catch (err) {
    // Validation errors return 400 with the firmware's error message
    const knownErrors = [
      'bad json', 'center missing', 'center out of range',
      'radius 10..100000 m', 'polygon needs 3..32 points',
      'bad point', 'point out of range', 'unknown type'
    ];
    
    if (knownErrors.includes(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    
    console.error('[api] Error deploying geofence:', err.message);
    res.status(500).json({ error: 'Failed to deploy geofence' });
  }
});

// ─────────────────────────────────────────────────────────────
// Get current active geofence (all roles)
// ─────────────────────────────────────────────────────────────
router.get('/geofence/current', requireAuth, async (req, res) => {
  try {
    const geofence = require('./geofence');
    const current = await geofence.getCurrentGeofence();
    
    if (!current) {
      return res.json({ active: false, geofence: null });
    }
    
    res.json({ active: true, geofence: current });
  } catch (err) {
    console.error('[api] Error getting current geofence:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// Get geofence deployment history (team+)
// ─────────────────────────────────────────────────────────────
router.get('/geofence/history', requireRole('team'), async (req, res) => {
  try {
    const geofence = require('./geofence');
    const limit = parseInt(req.query.limit || '20', 10);
    const history = await geofence.getGeofenceHistory(limit);
    res.json(history);
  } catch (err) {
    console.error('[api] Error getting geofence history:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────
// Clear geofence (team+)
// Publishes {"type":"clear"} as retained message
// ─────────────────────────────────────────────────────────────
router.delete('/geofence', requireRole('team'), async (req, res) => {
  try {
    const geofence = require('./geofence');
    const userId = req.user ? req.user.id : null;
    
    const row = await geofence.deployGeofence({ type: 'clear' }, userId, 'clear');
    res.json(row);
  } catch (err) {
    console.error('[api] Error clearing geofence:', err.message);
    res.status(500).json({ error: 'Failed to clear geofence' });
  }
});

// ─────────────────────────────────────────────────────────────
// TODO (Stage 7): Add these routes with auth middleware
// ─────────────────────────────────────────────────────────────
// POST /api/auth/login
// GET  /api/me
// GET  /api/trips/:id/summary
// POST /api/trips/:id/reanalyze
// DELETE /api/trips/:id
// GET/POST/DELETE /api/users

module.exports = router;
