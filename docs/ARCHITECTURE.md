# Architecture Guide

## System Overview

The Buggy Telemetry Platform follows a **microservices-inspired architecture** where each component has a single responsibility and communicates through well-defined interfaces.

## Data Flow

### Live Telemetry (Real-time)

```
1. ESP32/Simulator publishes JSON to MQTT topic every 200ms
2. Mosquitto broker routes message to all subscribers
3. Node.js ingest service receives message
4. Message is added to in-memory buffer
5. Every 1 second, buffer is flushed to PostgreSQL (batch insert)
6. Simultaneously, message is broadcast via WebSocket to all connected browsers
7. React dashboard updates gauges, charts, and map in real-time
```

### Trip Lifecycle

```
1. First telemetry message with new trip_id → trip created in DB (status='live')
2. Every message updates last_seen_at timestamp
3. Every 5 seconds, ingest checks for idle trips (no messages for 60s)
4. Idle trip marked as ended (status='ended', analysis_status='pending')
5. Python worker detects pending trip (polls every 5s)
6. Worker computes metrics and generates story
7. Worker writes to trip_summaries table (analysis_status='done')
8. Ingest detects completed analysis and broadcasts via WebSocket
9. Dashboard shows analysis results
```

### Geofence Flow

```
1. User draws geofence on dashboard map
2. Dashboard sends POST /api/geofence with JSON
3. Ingest validates and publishes to MQTT (retained, QoS 1)
4. Mosquitto delivers to ESP32
5. ESP32 evaluates geofence and sets geo_breach flag
6. ESP32 publishes acknowledgement to geofence/status topic
7. Ingest receives acknowledgement and broadcasts via WebSocket
8. Dashboard shows confirmation
```

## Component Details

### Mosquitto (Message Broker)

**Purpose**: Decouples ESP32 from backend. Multiple subscribers can receive the same message.

**Key Features**:
- Retained messages: Geofence command persists for new subscribers
- QoS levels: Telemetry uses QoS 0 (fast), geofence uses QoS 1 (reliable)
- Persistence: Messages survive broker restart

**Configuration** (`infra/mosquitto/mosquitto.conf`):
- Port 1883: Standard MQTT
- Port 9001: WebSocket (reserved for future)
- Anonymous access: Enabled for development (disable in production)

### PostgreSQL (Database)

**Purpose**: Persistent storage for trips, readings, analysis results, and users.

**Key Tables**:
- `trips`: One row per driving session
- `readings`: One row per telemetry sample (~5 Hz)
- `trip_summaries`: Analysis results (JSONB metrics)
- `users`: Login accounts with roles

**Performance**:
- Batch inserts: 5 readings/second buffered, flushed every 1 second
- Index on (trip_pk, time): Fast queries for trip replay
- JSONB for metrics: Flexible schema for analysis results

### Node.js Ingest Service

**Purpose**: Central hub connecting MQTT, database, WebSocket, and REST API.

**Key Modules**:
- `mqtt.js`: Subscribes to telemetry, publishes geofence
- `readings.js`: Batches and inserts telemetry to DB
- `trips.js`: Manages trip lifecycle (create, update, end)
- `ws.js`: Broadcasts live data to browsers
- `api.js`: REST endpoints for dashboard
- `auth.js`: JWT authentication and role enforcement

**Performance Optimizations**:
- Batch inserts: UNNEST() for multi-row INSERT
- Connection pooling: Reuses database connections
- In-memory trip cache: Avoids DB lookups on every message

### React Dashboard

**Purpose**: User interface for live monitoring, trip history, and analysis.

**Key Features**:
- Real-time updates via WebSocket
- Role-based UI (hide features user can't access)
- Leaflet maps with OpenStreetMap tiles
- Recharts for data visualization
- JWT stored in localStorage

**State Management**:
- AuthContext: User session and token
- useWebSocket hook: Live telemetry stream
- Component-level state: Replay position, chart data, etc.

### Python Analysis Worker

**Purpose**: Post-trip analysis and story generation.

**Key Features**:
- Polls database for pending trips
- Computes 20+ metrics (distance, speed, stops, safety flags)
- Generates rule-based story using templates
- Writes results to trip_summaries table

**Metrics Computed**:
- Duration, distance, top speed, average speed
- Stop count and duration
- Hard acceleration/braking events
- Max pitch/roll, temperature, gas
- Geofence breach count and duration
- Data quality percentage

## Security Model

### Authentication

- Passwords hashed with bcrypt (10 rounds)
- JWT tokens with 12-hour expiry
- Token sent in Authorization header (REST) and URL query (WebSocket)

### Authorization

- Role-based access control (RBAC)
- Permissions enforced on backend (never trust frontend)
- Three roles: viewer, team, engineer
- Permission map in `ingest/src/roles.js`

### Network Security

- All services run on localhost (development)
- CORS configured to allow only dashboard origin
- No secrets in code (use .env files)

## Deployment Considerations

### Development (Current)

- All services on localhost
- Anonymous MQTT access
- Simple passwords in .env
- No HTTPS

### Production (Future)

- Use reverse proxy (nginx) for HTTPS
- Enable MQTT authentication
- Use strong passwords and rotate JWT secret
- Deploy to cloud (see FREE_HOSTING.md)
- Add rate limiting and request logging
