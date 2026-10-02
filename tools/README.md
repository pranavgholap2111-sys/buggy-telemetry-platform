# Simulator — fake-buggy.js

A Node.js script that pretends to be the ESP32 on the buggy. It publishes
realistic telemetry to Mosquitto at 5 Hz and subscribes to geofence commands.

## Quick start

```powershell
# 1. Make sure infrastructure is running (Stage 1)
docker compose -f infra/docker-compose.yml up -d

# 2. Install dependencies (only needed once)
cd tools
npm install

# 3. Run the simulator
node fake-buggy.js

# Or use the npm script:
npm start

# Fast mode (10× speed, for testing):
npm run fast
```

## What it does

- Connects to `mqtt://localhost:1883`
- Generates a random trip ID (e.g. `BUGGY_B00042`) — fixed for this run
- Publishes telemetry JSON every 200 ms to `reduntech/buggy/telemetry`
- Subscribes to `reduntech/buggy/geofence` and sends acknowledgements
- Simulates a lap around a track with varying speed and GPS quality
- Occasionally drops satellites to simulate GPS loss (`pos_src` changes)

## Configuration

Edit the `CONFIG` object at the top of `fake-buggy.js`:

| Key | Default | Meaning |
|---|---|---|
| `brokerUrl` | `mqtt://localhost:1883` | MQTT broker address |
| `deviceId` | `buggy01` | Buggy identifier |
| `publishIntervalMs` | `200` | Publish interval (5 Hz) |
| `startLat`, `startLon` | `19.9975, 73.7898` | Track center (your campus) |
| `trackRadiusLat`, `trackRadiusLon` | `0.002, 0.003` | Track size (~220×320 m) |
| `minSpeed`, `maxSpeed` | `0, 60` | Speed range in km/h |
| `badGpsProbability` | `0.05` | Chance of GPS degradation per reading |
| `baseTemp`, `tempNoise` | `31.5, 2.0` | Temperature simulation |
| `baseGas`, `gasNoise` | `220, 50` | Gas sensor simulation |

## Verification

Open a second terminal and subscribe to see the messages:

```powershell
docker exec -it buggy-mosquitto mosquitto_sub -t "reduntech/buggy/telemetry" -v
```

You should see JSON messages arriving every 200 ms.

## Stopping

Press `Ctrl+C`. The script will disconnect gracefully and print a summary.
