# Ingest Service

Node.js backend that sits at the center of the telemetry platform.

## What it does

1. **Subscribes to MQTT** telemetry from the ESP32/simulator
2. **Creates/updates trips** in PostgreSQL (keyed on `device_id + trip_id`)
3. **Batch-inserts readings** every 1 second (not row-by-row — 10× faster)
4. **Detects trip end** after 60 s of inactivity
5. **Relays live data** to browsers via WebSocket
6. **Serves REST API** for the dashboard (trips, geofence, health)
7. **Publishes geofence** commands (retained, QoS 1)

## Quick start

```powershell
# 1. Make sure infrastructure is running (Stage 1)
docker compose -f infra/docker-compose.yml ps

# 2. Make sure simulator is running (Stage 2)
#    (open a separate terminal for the simulator)

# 3. Install dependencies (only needed once)
cd ingest
npm install

# 4. Copy .env.example to .env (already done for you)
# copy .env.example .env

# 5. Start the ingest service
npm start

# Or with auto-reload on file changes:
npm run dev
```

## Endpoints

| Route | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check (public) |
| `/api/live/latest` | GET | Latest telemetry per device |
| `/api/trips` | GET | List trips |
| `/api/trips/:id` | GET | Trip detail (optionally include readings) |
| `/api/trips/:id/stream?step=N` | GET | Downsampled readings for replay |
| `/api/geofence` | POST | Publish geofence command |
| `/ws` | WebSocket | Live telemetry relay |

## Testing

### REST API

```powershell
# Health check
curl http://localhost:4000/api/health

# Latest telemetry
curl http://localhost:4000/api/live/latest

# List trips
curl http://localhost:4000/api/trips

# Trip detail with readings
curl "http://localhost:4000/api/trips/1?include_readings=true"

# Downsampled stream (every 5th row)
curl "http://localhost:4000/api/trips/1/stream?step=5"
```

### WebSocket

Open `tools/ws-test.html` in a browser, or use the Node.js test client:

```powershell
node tools/ws-test-client.js
```

### Geofence

```powershell
# Deploy a circle geofence
curl -X POST http://localhost:4000/api/geofence \
  -H "Content-Type: application/json" \
  -d '{"type":"circle","center":[19.9975,73.7898],"radius_m":250}'

# Clear geofence
curl -X POST http://localhost:4000/api/geofence \
  -H "Content-Type: application/json" \
  -d '{"type":"clear"}'
```

## Architecture

```
MQTT (telemetry) ──→ readings.js ──→ batch INSERT ──→ PostgreSQL
                       │
                       └──→ ws.js ──→ WebSocket ──→ browser

MQTT (geofence status) ──→ ws.js ──→ WebSocket ──→ browser

REST API ──→ api.js ──→ trips.js / readings.js ──→ PostgreSQL
                │
                └──→ mqtt.js ──→ MQTT (geofence command)
```

## Configuration

See `.env.example` for all environment variables.

## Files

| File | Purpose |
|---|---|
| `src/index.js` | Entry point, starts everything |
| `src/config.js` | Loads env vars, exports typed config |
| `src/db.js` | PostgreSQL connection pool |
| `src/mqtt.js` | MQTT client (subscribe + publish) |
| `src/trips.js` | Trip lifecycle (create, update, end) |
| `src/readings.js` | Batched telemetry inserts |
| `src/ws.js` | WebSocket server and broadcast |
| `src/api.js` | REST API routes |
| `src/roles.js` | Role-permission map (for Stage 7) |
