/**
 * config.js — loads environment variables and exports typed config
 * 
 * All configuration in one place. Other modules import from here
 * instead of reading process.env directly.
 */

require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),

  // PostgreSQL
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'buggy',
    password: process.env.DB_PASSWORD || 'buggy_dev_pw',
    database: process.env.DB_NAME || 'buggy_telemetry',
  },

  // MQTT
  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',

  // JWT (used in Stage 7)
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtExpiry: process.env.JWT_EXPIRY || '12h',

  // Trip logic
  tripIdleTimeoutS: parseInt(process.env.TRIP_IDLE_TIMEOUT_S || '60', 10),

  // MQTT topics (from contract section 5.1)
  topics: {
    telemetry: 'reduntech/buggy/telemetry',
    geofence: 'reduntech/buggy/geofence',
    geofenceStatus: 'reduntech/buggy/geofence/status',
  },
};

module.exports = config;
