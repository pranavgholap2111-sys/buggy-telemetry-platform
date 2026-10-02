/**
 * db.js — PostgreSQL connection pool
 * 
 * A pool keeps multiple connections open and reuses them,
 * which is much faster than opening a new connection for each query.
 * 
 * Usage:
 *   const db = require('./db');
 *   const result = await db.query('SELECT 1 AS test');
 */

const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  // Pool settings: keep 5 connections ready, max 20
  min: 2,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log connection errors (don't crash — the pool will retry)
pool.on('error', (err) => {
  console.error('[db] Unexpected pool error:', err.message);
});

// Test the connection on startup
async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT current_database(), version()');
    console.log(`[db] ✓ Connected to database: ${result.rows[0].current_database}`);
    console.log(`[db]   PostgreSQL ${result.rows[0].version.split(' ')[1]}`);
    client.release();
    return true;
  } catch (err) {
    console.error('[db] ✗ Connection failed:', err.message);
    console.error('[db]   Is PostgreSQL running? Check: docker compose -f infra/docker-compose.yml ps');
    return false;
  }
}

module.exports = { pool, testConnection };
