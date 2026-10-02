# API Contract Reference

This document defines the exact data formats and protocols used by the Buggy Telemetry Platform.

## MQTT Topics

### Telemetry (ESP32 → Backend)

**Topic**: `reduntech/buggy/telemetry`  
**QoS**: 0 (at most once)  
**Frequency**: 5 Hz (every 200ms)

**Payload Format**:
```json
{
  "device_id": "buggy01",
  "trip_id": "BUGGY_B00042",
  "speed": 42,
  "rawGps": 41,
  "rawAcc": 38,
  "temp": 31.5,
  "gas": 220,
  "pitch": 3,
  "roll": -2,
  "lat": 19.997500,
  "lon": 73.789800,
  "sat": 7,
  "battery": 100,
  "utc": "2026-10-02T09:15:30Z",
  "geo_active": 1,
  "geo_breach": 0,
  "pos_src": 0
}
```

**Field Definitions**:
- `device_id`: Unique identifier for the buggy
- `trip_id`: Unique per power-on session (format: `BUGGY_B#####`)
- `speed`: Fused speed in km/h (GPS when available, else accelerometer)
- `rawGps`: Raw GPS speed in km/h
- `rawAcc`: Raw accelerometer speed in km/h
- `temp`: Ambient temperature in °C
- `gas`: Gas sensor reading in ppm
- `pitch`: Forward/backward tilt in degrees
- `roll`: Left/right tilt in degrees
- `lat`: Latitude (6 decimal places)
- `lon`: Longitude (6 decimal places)
- `sat`: Number of GPS satellites
- `battery`: Battery percentage (0-100)
- `utc`: GPS timestamp (ISO 8601)
- `geo_active`: 1 if geofence is active, 0 otherwise
- `geo_breach`: 1 if outside geofence, 0 otherwise
- `pos_src`: Position source (0=GPS, 1=last known, 2=default, 3=IP, 4=lost)

### Geofence Command (Backend → ESP32)

**Topic**: `reduntech/buggy/geofence`  
**QoS**: 1 (at least once)  
**Retained**: Yes

**Circle Geofence**:
```json
{
  "type": "circle",
  "center": [19.9975, 73.7898],
  "radius_m": 250
}
```

**Polygon Geofence** (note: `coords`, not `coordinates`):
```json
{
  "type": "polygon",
  "coords": [
    [19.997, 73.789],
    [19.998, 73.789],
    [19.998, 73.790],
    [19.997, 73.790]
  ]
}
```

**Clear Geofence**:
```json
{
  "type": "clear"
}
```

### Geofence Status (ESP32 → Backend)

**Topic**: `reduntech/buggy/geofence/status`  
**QoS**: 1

**Payload Format** (note `type` is numeric: 0=none, 1=circle, 2=polygon):
```json
{
  "device_id": "buggy01",
  "ok": true,
  "type": 1,
  "points": 0,
  "info": "applied"
}
```

`info` values: `applied`, `unchanged`, `bad json`, `center missing`, `center out of range`, `radius 10..100000 m`, `polygon needs 3..32 points`, `bad point`, `point out of range`, `unknown type`, `busy, retry`.

## REST API Endpoints

### Authentication

#### POST /api/auth/login

**Request**:
```json
{
  "email": "admin@example.com",
  "password": "password123"
}
```

**Response** (200 OK):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "email": "admin@example.com",
    "role": "engineer"
  }
}
```

**Response** (401 Unauthorized):
```json
{
  "error": "Invalid credentials"
}
```

#### GET /api/auth/me

**Headers**: `Authorization: Bearer <token>`

**Response** (200 OK):
```json
{
  "id": 1,
  "email": "admin@example.com",
  "role": "engineer",
  "created_at": "2026-10-02T09:00:00Z"
}
```

### Trips

#### GET /api/trips

**Headers**: `Authorization: Bearer <token>`

**Response** (200 OK):
```json
[
  {
    "id": 1,
    "device_id": "buggy01",
    "trip_id": "BUGGY_B00042",
    "status": "ended",
    "started_at": "2026-10-02T09:00:00Z",
    "ended_at": "2026-10-02T09:15:30Z",
    "duration_s": 930,
    "top_speed_kmh": 58,
    "sample_count": 4650,
    "analysis_status": "done"
  }
]
```

#### GET /api/trips/:id

**Headers**: `Authorization: Bearer <token>`

**Response** (200 OK):
```json
{
  "id": 1,
  "device_id": "buggy01",
  "trip_id": "BUGGY_B00042",
  "status": "ended",
  "started_at": "2026-10-02T09:00:00Z",
  "ended_at": "2026-10-02T09:15:30Z",
  "duration_s": 930,
  "top_speed_kmh": 58,
  "sample_count": 4650,
  "analysis_status": "done",
  "readings": [
    {
      "time": "2026-10-02T09:00:00Z",
      "speed_kmh": 42,
      "lat": 19.9975,
      "lon": 73.7898,
      "sat": 7,
      "pos_src": 0
    }
  ]
}
```

#### GET /api/trips/:id/stream?step=N

**Headers**: `Authorization: Bearer <token>`  
**Query**: `step` - Downsample factor (keep every Nth reading)

**Response** (200 OK):
```json
{
  "trip_id": 1,
  "step": 5,
  "count": 930,
  "readings": [
    {
      "time": "2026-10-02T09:00:00Z",
      "speed_kmh": 42,
      "lat": 19.9975,
      "lon": 73.7898,
      "sat": 7,
      "pos_src": 0
    }
  ]
}
```

#### GET /api/trips/:id/summary

**Headers**: `Authorization: Bearer <token>`  
**Required Role**: team or engineer

**Response** (200 OK):
```json
{
  "status": "done",
  "story": "The buggy completed a 15.5-minute trip covering 2.3 km. Top speed reached 58 km/h with an average moving speed of 41 km/h. The driver made 3 stops totaling 45 seconds. No hard braking events were detected. GPS data quality was excellent at 98.2%.",
  "metrics": {
    "duration_s": 930,
    "duration_min": 15.5,
    "distance_km": 2.3,
    "top_speed_kmh": 58,
    "avg_speed_kmh": 35,
    "avg_moving_speed_kmh": 41,
    "stop_count": 3,
    "stop_duration_s": 45,
    "hard_brake_count": 0,
    "max_pitch_deg": 8,
    "max_roll_deg": 12,
    "max_temp_c": 34.2,
    "peak_gas_ppm": 280,
    "min_battery_pct": 85,
    "geo_breach_count": 0,
    "geo_breach_time_s": 0,
    "data_quality_pct": 98.2
  },
  "created_at": "2026-10-02T09:20:00Z"
}
```

### Geofence

#### POST /api/geofence

Deploy a geofence. Validates the shape (matching firmware rules), stores in DB, publishes to MQTT (retained, QoS 1).

**Headers**: `Authorization: Bearer <token>`  
**Required Role**: team or engineer

**Request** (Circle):
```json
{
  "type": "circle",
  "center": [19.9975, 73.7898],
  "radius_m": 250,
  "label": "Campus boundary"
}
```

**Request** (Polygon):
```json
{
  "type": "polygon",
  "coords": [[19.99, 73.78], [19.99, 73.80], [20.01, 73.80], [20.01, 73.78]],
  "label": "Track boundary"
}
```

**Response** (201 Created):
```json
{
  "id": 1,
  "device_id": "buggy01",
  "shape": { "type": "circle", "center": [19.9975, 73.7898], "radius_m": 250 },
  "label": "Campus boundary",
  "deployed_by": 1,
  "deployed_at": "2026-10-02T09:15:30Z",
  "ack_status": "pending",
  "ack_info": null,
  "acked_at": null
}
```

**Response** (400 Bad Request — validation error):
```json
{ "error": "radius 10..100000 m" }
```

Possible errors: `bad json`, `center missing`, `center out of range`, `radius 10..100000 m`, `polygon needs 3..32 points`, `bad point`, `point out of range`, `unknown type`.

#### GET /api/geofence/current

Get the current active geofence. The "current fence" = newest row where `ack_status != 'rejected'`. If its shape type is `clear`, there is no active fence.

**Headers**: `Authorization: Bearer <token>`  
**Required Role**: viewer or above

**Response** (200 OK — active fence):
```json
{
  "active": true,
  "geofence": {
    "id": 1,
    "device_id": "buggy01",
    "shape": { "type": "circle", "center": [19.9975, 73.7898], "radius_m": 250 },
    "label": "Campus boundary",
    "deployed_by": 1,
    "deployed_at": "2026-10-02T09:15:30Z",
    "ack_status": "applied",
    "ack_info": "applied",
    "acked_at": "2026-10-02T09:15:31Z"
  }
}
```

**Response** (200 OK — no active fence):
```json
{ "active": false, "geofence": null }
```

#### GET /api/geofence/history?limit=N

Get recent geofence deployments with who deployed them and the result.

**Headers**: `Authorization: Bearer <token>`  
**Required Role**: team or engineer  
**Query**: `limit` — max rows (default 20)

**Response** (200 OK):
```json
[
  {
    "id": 3,
    "device_id": "buggy01",
    "shape": { "type": "clear" },
    "label": "clear",
    "deployed_by": 1,
    "deployed_by_email": "admin@example.com",
    "deployed_at": "2026-10-02T10:00:00Z",
    "ack_status": "applied",
    "ack_info": "applied",
    "acked_at": "2026-10-02T10:00:01Z"
  },
  {
    "id": 2,
    "device_id": "buggy01",
    "shape": { "type": "circle", "center": [19.9975, 73.7898], "radius_m": 250 },
    "label": "Campus boundary",
    "deployed_by": 1,
    "deployed_by_email": "admin@example.com",
    "deployed_at": "2026-10-02T09:15:30Z",
    "ack_status": "applied",
    "ack_info": "applied",
    "acked_at": "2026-10-02T09:15:31Z"
  }
]
```

#### DELETE /api/geofence

Clear the active geofence. Publishes `{"type":"clear"}` as a retained message.

**Headers**: `Authorization: Bearer <token>`  
**Required Role**: team or engineer

**Response** (200 OK):
```json
{
  "id": 4,
  "device_id": "buggy01",
  "shape": { "type": "clear" },
  "label": "clear",
  "deployed_by": 1,
  "deployed_at": "2026-10-02T10:30:00Z",
  "ack_status": "pending",
  "ack_info": null,
  "acked_at": null
}
```

### Users (Engineer Only)

#### GET /api/users

**Headers**: `Authorization: Bearer <token>`  
**Required Role**: engineer

**Response** (200 OK):
```json
[
  {
    "id": 1,
    "email": "admin@example.com",
    "role": "engineer",
    "created_at": "2026-10-02T09:00:00Z"
  },
  {
    "id": 2,
    "email": "viewer@example.com",
    "role": "viewer",
    "created_at": "2026-10-02T10:00:00Z"
  }
]
```

#### POST /api/users

**Headers**: `Authorization: Bearer <token>`  
**Required Role**: engineer

**Request**:
```json
{
  "email": "newuser@example.com",
  "password": "password123",
  "role": "viewer"
}
```

**Response** (201 Created):
```json
{
  "id": 3,
  "email": "newuser@example.com",
  "role": "viewer",
  "created_at": "2026-10-02T11:00:00Z"
}
```

#### DELETE /api/users/:id

**Headers**: `Authorization: Bearer <token>`  
**Required Role**: engineer

**Response** (200 OK):
```json
{
  "message": "User deleted"
}
```

## WebSocket Protocol

### Connection

**URL**: `ws://localhost:4000/ws?token=<jwt_token>`

### Message Format

All messages use JSON with this structure:
```json
{
  "event": "event_name",
  "data": { ... }
}
```

### Events

#### hello (Server → Client)

Sent on connection with latest telemetry for all devices.

```json
{
  "event": "hello",
  "data": {
    "buggy01": {
      "device_id": "buggy01",
      "trip_id": "BUGGY_B00042",
      "speed": 42,
      "lat": 19.9975,
      "lon": 73.7898,
      "server_time": "2026-10-02T09:15:30Z"
    }
  }
}
```

#### telemetry (Server → Client)

Sent for every telemetry message received from ESP32.

```json
{
  "event": "telemetry",
  "data": {
    "device_id": "buggy01",
    "trip_id": "BUGGY_B00042",
    "speed": 42,
    "lat": 19.9975,
    "lon": 73.7898,
    "server_time": "2026-10-02T09:15:30Z"
  }
}
```

#### trip_started (Server → Client)

Sent when a new trip is detected.

```json
{
  "event": "trip_started",
  "data": {
    "id": 1,
    "device_id": "buggy01",
    "trip_id": "BUGGY_B00042"
  }
}
```

#### trip_ended (Server → Client)

Sent when a trip is marked as ended (60s idle timeout).

```json
{
  "event": "trip_ended",
  "data": {
    "id": 1,
    "device_id": "buggy01",
    "trip_id": "BUGGY_B00042",
    "top_speed_kmh": 58,
    "sample_count": 4650
  }
}
```

#### analysis_ready (Server → Client)

Sent when Python worker completes trip analysis.

```json
{
  "event": "analysis_ready",
  "data": {
    "id": 1
  }
}
```

#### geofence_status (Server → Client)

Sent when ESP32 acknowledges geofence command (raw ack from MQTT).

```json
{
  "event": "geofence_status",
  "data": {
    "device_id": "buggy01",
    "ok": true,
    "type": 1,
    "points": 0,
    "info": "applied"
  }
}
```

#### geofence_updated (Server → Client)

Sent whenever the current geofence changes or its ack status updates. All dashboards receive this to stay in sync.

```json
{
  "event": "geofence_updated",
  "data": {
    "id": 1,
    "shape": { "type": "circle", "center": [19.9975, 73.7898], "radius_m": 250 },
    "ack_status": "applied",
    "ack_info": "applied",
    "deployed_by": 1,
    "deployed_at": "2026-10-02T09:15:30Z"
  }
}
```

Possible `ack_status` values: `pending` (just deployed, waiting for ack), `applied` (buggy confirmed), `unchanged` (same fence re-sent), `rejected` (buggy rejected with error), `no_response` (no ack within 10s — buggy may be offline).

## Error Responses

### 400 Bad Request

```json
{
  "error": "Invalid request format"
}
```

### 401 Unauthorized

```json
{
  "error": "Authentication required"
}
```

### 403 Forbidden

```json
{
  "error": "Insufficient permissions"
}
```

### 404 Not Found

```json
{
  "error": "Resource not found"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal server error"
}
```

## Role Permissions

| Endpoint | Viewer | Team | Engineer |
|---|---|---|---|
| POST /api/auth/login | ✅ | ✅ | ✅ |
| GET /api/auth/me | ✅ | ✅ | ✅ |
| GET /api/trips | ✅ | ✅ | ✅ |
| GET /api/trips/:id | ✅ | ✅ | ✅ |
| GET /api/trips/:id/stream | ✅ | ✅ | ✅ |
| GET /api/trips/:id/summary | ❌ | ✅ | ✅ |
| GET /api/geofence/current | ✅ | ✅ | ✅ |
| POST /api/geofence | ❌ | ✅ | ✅ |
| DELETE /api/geofence | ❌ | ✅ | ✅ |
| GET /api/geofence/history | ❌ | ✅ | ✅ |
| GET /api/users | ❌ | ❌ | ✅ |
| POST /api/users | ❌ | ❌ | ✅ |
| DELETE /api/users/:id | ❌ | ❌ | ✅ |

## Database Schema

### trips table

```sql
CREATE TABLE trips (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  top_speed_kmh REAL,
  sample_count INTEGER,
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE(device_id, trip_id)
);
```

### readings table

```sql
CREATE TABLE readings (
  id BIGSERIAL PRIMARY KEY,
  trip_pk BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  time TIMESTAMPTZ NOT NULL,
  speed_kmh REAL,
  raw_gps_kmh REAL,
  raw_acc_kmh REAL,
  temp_c REAL,
  gas_ppm INTEGER,
  pitch_deg INTEGER,
  roll_deg INTEGER,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  sat INTEGER,
  battery_pct INTEGER,
  gps_utc TIMESTAMPTZ,
  geo_active BOOLEAN,
  geo_breach BOOLEAN,
  pos_src SMALLINT
);

CREATE INDEX idx_readings_trip_time ON readings(trip_pk, time);
```

### trip_summaries table

```sql
CREATE TABLE trip_summaries (
  trip_pk BIGINT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  story TEXT,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### users table

```sql
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'team', 'engineer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### geofences table

```sql
CREATE TABLE geofences (
  id           BIGSERIAL PRIMARY KEY,
  device_id    TEXT NOT NULL DEFAULT 'buggy01',
  shape        JSONB NOT NULL,                    -- exactly what was published (circle / polygon / clear)
  label        TEXT,
  deployed_by  BIGINT REFERENCES users(id),
  deployed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ack_status   TEXT NOT NULL DEFAULT 'pending',   -- pending | applied | unchanged | rejected | no_response
  ack_info     TEXT,
  acked_at     TIMESTAMPTZ
);

CREATE INDEX geofences_device_time ON geofences (device_id, deployed_at DESC);
```

The **current fence** = the newest row where `ack_status != 'rejected'`. If its `shape.type` is `clear`, there is no active fence.
