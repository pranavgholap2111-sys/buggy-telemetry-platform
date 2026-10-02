# Web Dashboard (Stage 4)

React + Vite + Tailwind CSS live telemetry dashboard.

## What it shows

- **Speed gauge** — fused speed (GPS + accelerometer) as a circular dial
- **Raw speeds** — GPS speed and accelerometer speed side by side
- **Sensors** — temperature, gas (MQ-6), battery with color thresholds
- **Pitch & roll** — chassis attitude indicator (like an airplane horizon)
- **Speed chart** — rolling 60-second history
- **Map** — Leaflet map with vehicle marker and trail
- **Status bar** — WebSocket connection state, last packet time
- **Alarms** — colored badges when thresholds are exceeded

## Quick start

```powershell
# 1. Make sure ingest service is running (Stage 3)
#    Terminal 1: cd ingest && npm start

# 2. Make sure simulator is running (Stage 2)
#    Terminal 2: cd tools && node fake-buggy.js

# 3. Start the dashboard (development mode with hot reload)
cd web
npm install          # only needed once
npm run dev

# 4. Open browser to http://localhost:5173
```

## Configuration

Create a `.env` file in this folder:

```
VITE_WS_URL=ws://localhost:4000/ws
VITE_TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
```

| Variable | Default | Meaning |
|---|---|---|
| `VITE_WS_URL` | `ws://localhost:4000/ws` | WebSocket endpoint |
| `VITE_TILE_URL` | OpenStreetMap | Map tile provider URL |

## Files

| File | Purpose |
|---|---|
| `src/App.tsx` | Entry point, renders LiveDashboard |
| `src/hooks/useWebSocket.ts` | Custom hook: connects to WebSocket, manages state |
| `src/lib/types.ts` | TypeScript interfaces matching the contract |
| `src/components/LiveDashboard.tsx` | Main layout, combines all components |
| `src/components/SpeedGauge.tsx` | Circular SVG speedometer |
| `src/components/MiniGauge.tsx` | Small vertical gauge (temp, gas, battery) |
| `src/components/PitchRoll.tsx` | Chassis attitude indicator |
| `src/components/SpeedChart.tsx` | Rolling 60s speed chart (Recharts) |
| `src/components/MapView.tsx` | Leaflet map with marker and trail |
| `src/components/StatusBar.tsx` | Connection status and last packet time |
| `src/components/AlarmIndicators.tsx` | Warning badges for threshold violations |

## Contract rules implemented

- ✅ Position accuracy: `pos_src === 0 && sat >= 4` → accurate (green marker + trail)
- ✅ Approximate position: otherwise → faded marker, no trail, "Approx. Position" label
- ✅ Alarm thresholds: gas ≥1500 (warning), ≥1800 (critical), temp ≥45°C, battery ≤20%, geo_breach=1
- ✅ Rolling chart: last 60 seconds of speed data
- ✅ Connection status: connecting/connected/disconnected/error with auto-reconnect
- ✅ Last packet time: updates every second showing "N s ago"
