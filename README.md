# 🏎️ RedunTech Buggy Telemetry Platform

A complete real-time telemetry system for a student-built electric racing buggy. Built as a learning project — every component is documented and explained.

## What it does

- **Live monitoring**: Real-time speed, temperature, gas, GPS, pitch/roll on a dashboard
- **Trip recording**: Every driving session is stored with full telemetry history
- **Replay**: Watch any past trip with a time scrubber (like a video player)
- **Analysis**: Python worker automatically computes metrics and generates trip stories
- **Geofencing**: Draw a boundary on the map; the buggy alerts when it leaves
- **Multi-user**: Login system with viewer/team/engineer roles

## Architecture

```
ESP32 (or Simulator)
    │ MQTT (port 1883)
    ▼
Mosquitto Broker ──── Node.js Ingest ──── PostgreSQL
                         │                    │
                         │ WebSocket          │
                         ▼                    │
                    React Dashboard ◄─────────┘
                         (port 3000)
                         
                    Python Worker (polls DB for analysis)
```

## Tech Stack

| Component | Technology | Port |
|---|---|---|
| Message Broker | Eclipse Mosquitto 2.0 | 1883 |
| Database | PostgreSQL 16 | 5433 |
| Backend | Node.js 20 + Express | 4000 |
| Frontend | React + Vite + Tailwind | 3000 |
| Analysis | Python 3.11 + pandas | — |
| Maps | Leaflet + OpenStreetMap | — |

## Quick Start

### Prerequisites

- **Docker Desktop** installed and running
- **Node.js 20+** installed
- **Python 3.11+** installed
- **Git** (optional, for version control)

### 1. Start Infrastructure

```powershell
cd buggy-platform\infra
docker compose up -d
```

Verify both containers are running:
```powershell
docker compose ps
```

### 2. Start Simulator

```powershell
cd buggy-platform\tools
npm install
node fake-buggy.js
```

### 3. Start Ingest Service

```powershell
cd buggy-platform\ingest
npm install
npm start
```

### 4. Start Python Analysis Worker

```powershell
cd buggy-platform\analysis
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
python worker.py
```

### 5. Start Dashboard

```powershell
cd buggy-platform
npm install
npm run dev
```

### 6. Create First User

```powershell
cd buggy-platform\tools
npm install bcryptjs pg dotenv
node create-first-user.js
```

### 7. Open Browser

Go to **http://localhost:3000** and login with your credentials.

## Project Structure

```
buggy-platform/
├── infra/                    # Docker infrastructure
│   ├── docker-compose.yml    # Mosquitto + PostgreSQL
│   └── mosquitto/            # Broker configuration
├── db/
│   └── schema.sql            # Database tables
├── tools/
│   ├── fake-buggy.js         # ESP32 simulator
│   └── create-first-user.js  # Bootstrap engineer account
├── ingest/                   # Node.js backend
│   └── src/
│       ├── index.js          # Entry point
│       ├── config.js         # Environment config
│       ├── db.js             # Database pool
│       ├── mqtt.js           # MQTT client
│       ├── trips.js          # Trip lifecycle
│       ├── readings.js       # Batched inserts
│       ├── ws.js             # WebSocket server
│       ├── api.js            # REST endpoints
│       ├── auth.js           # JWT + bcrypt
│       ├── authRoutes.js     # Login + user management
│       └── roles.js          # Permission map
├── analysis/                 # Python worker
│   ├── worker.py             # Trip analysis
│   └── requirements.txt
├── src/                      # React frontend
│   ├── App.tsx               # Router + auth
│   ├── contexts/             # Auth context
│   ├── hooks/                # WebSocket hook
│   ├── components/           # UI components
│   └── lib/                  # Types + utilities
└── docs/                     # Documentation
    ├── ARCHITECTURE.md
    └── CONTRACT.md
```

## User Roles

| Role | Live View | Trips | Analysis | Geofence | User Mgmt |
|---|---|---|---|---|---|
| **Viewer** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Team** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Engineer** | ✅ | ✅ | ✅ | ✅ | ✅ |

## Ports Reference

| Port | Service | Purpose |
|---|---|---|
| 1883 | Mosquitto | MQTT messaging |
| 5433 | PostgreSQL | Database |
| 4000 | Node.js | REST API + WebSocket |
| 3000 | Vite | Dashboard UI |

## Stopping Everything

```powershell
# Stop all Docker containers
docker compose -f infra/docker-compose.yml down

# Stop Node/Python processes: press Ctrl+C in each terminal
```

## Troubleshooting

| Problem | Solution |
|---|---|
| Port 5432 already in use | Changed to 5433 in docker-compose.yml |
| `npm install` fails | Delete `node_modules` and retry |
| Python venv won't activate | Use `.\venv\Scripts\activate` (with dot-backslash) |
| Dashboard shows "Disconnected" | Check ingest service is running on port 4000 |
| No trips appear | Stop simulator, wait 65s for idle timeout |
| Analysis not showing | Check Python worker is running |

## Documentation

- **[Architecture Guide](docs/ARCHITECTURE.md)** — Detailed system design and data flow
- **[API Contract](docs/CONTRACT.md)** — Complete API reference and data formats
- **[Free Hosting Guide](docs/FREE_HOSTING.md)** — How to deploy to cloud for free

## Development Status

✅ **Stage 1**: Infrastructure (Docker, Mosquitto, PostgreSQL)  
✅ **Stage 2**: Simulator (fake ESP32)  
✅ **Stage 3**: Ingest Service (Node.js backend)  
✅ **Stage 4**: Live Dashboard (React frontend)  
✅ **Stage 5**: Trips & Replay (historical data)  
✅ **Stage 6**: Python Analysis (metrics and stories)  
✅ **Stage 7**: Auth & Roles (login, JWT, permissions)  
✅ **Stage 8**: Hardening & Docs (security, documentation)

**Project Status**: ✅ Complete

## Security Notes

### Development (Current)
- Anonymous MQTT access (easy setup)
- Simple passwords in `.env` files
- No HTTPS (localhost only)

### Production (Before Deploying)
- Enable MQTT authentication (see `infra/mosquitto/mosquitto.conf`)
- Use strong passwords and rotate JWT secret
- Enable HTTPS (use reverse proxy or platform's auto-HTTPS)
- Review `docs/FREE_HOSTING.md` for deployment options

## License

MIT — Free to use, modify, and share.

## Credits

Built as a student learning project. All tools used are free and open-source.

---

**Ready to deploy?** Check out [docs/FREE_HOSTING.md](docs/FREE_HOSTING.md) for free cloud hosting options.
