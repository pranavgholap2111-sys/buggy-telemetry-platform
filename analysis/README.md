# Python Analysis Worker

Analyzes completed trips and generates metrics and stories.

## What it does

- Polls the database every 5 seconds for trips with `analysis_status = 'pending'`
- Computes metrics: duration, distance, speed stats, stops, hard braking, safety flags, data quality
- Generates a rule-based story using text templates
- Writes results to `trip_summaries` table
- Marks trip as `analysis_status = 'done'`

## Setup

### 1. Install Python dependencies

```powershell
cd D:\buggy-platform\buggy-platform\analysis
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Run the worker

```powershell
python worker.py
```

You should see:
```
[2026-10-02 10:30:00] INFO ✓ Connected to database
[2026-10-02 10:30:00] INFO ✓ Worker ready. Polling for pending trips...
```

### 3. Test it

1. Stop the simulator (Ctrl+C in Terminal 2)
2. Wait 65 seconds for the trip to end
3. The worker will automatically detect the pending trip and analyze it
4. You'll see logs like:
   ```
   [2026-10-02 10:31:05] INFO ▶ Analyzing trip 1 (BUGGY_B39153)...
   [2026-10-02 10:31:05] INFO   Fetched 4865 readings
   [2026-10-02 10:31:05] INFO   Computed metrics: top_speed=53.0 km/h, distance=1.23 km
   [2026-10-02 10:31:05] INFO   Generated story (245 chars)
   [2026-10-02 10:31:05] INFO ✓ Trip 1 analysis complete
   ```

### 4. View results

Open the trip detail page in your browser (`http://localhost:3000/trips/1`).

You'll see a new section at the bottom: **📈 Trip Analysis** with:
- **Trip Story**: A paragraph describing the trip
- **Metrics Grid**: All computed metrics (duration, distance, top speed, etc.)

## Configuration

Edit `.env` to change:
- Database connection (should match docker-compose.yml)
- `POLL_INTERVAL_S`: How often to check for pending trips (default: 5 seconds)

Edit `worker.py` to change analysis thresholds:
- `MOVING_SPEED_THRESHOLD_KMH`: Below this speed = stopped (default: 5)
- `HARD_ACCEL_THRESHOLD_KMH`: Speed change in 1 second = hard accel (default: 15)
- `HARD_BRAKE_THRESHOLD_KMH`: Speed change in 1 second = hard brake (default: 15)
- `GAS_WARNING_PPM`: Gas warning threshold (default: 1500)
- `GAS_CRITICAL_PPM`: Gas critical threshold (default: 1800)
- `TEMP_WARNING_C`: Temperature warning (default: 45°C)
- `BATTERY_LOW_PCT`: Battery low threshold (default: 20%)

## Metrics computed

| Metric | Description |
|--------|-------------|
| `duration_s` | Trip duration in seconds |
| `duration_min` | Trip duration in minutes |
| `top_speed_kmh` | Maximum speed reached |
| `avg_speed_kmh` | Average speed over entire trip |
| `avg_moving_speed_kmh` | Average speed when moving (>5 km/h) |
| `distance_km` | Total distance (haversine on accurate GPS) |
| `distance_estimated` | True if distance was estimated from speed×time |
| `stop_count` | Number of stops (speed ≤5 km/h) |
| `stop_duration_s` | Total time stopped |
| `hard_accel_count` | Hard acceleration events (≥15 km/h in 1s) |
| `hard_brake_count` | Hard braking events (≥15 km/h in 1s) |
| `max_pitch_deg` | Maximum pitch angle |
| `max_roll_deg` | Maximum roll angle |
| `max_temp_c` | Maximum temperature |
| `time_above_temp_warning_s` | Time spent above 45°C |
| `peak_gas_ppm` | Peak gas sensor reading |
| `time_above_gas_warning_s` | Time spent above 1500 ppm |
| `min_battery_pct` | Minimum battery level |
| `geo_breach_count` | Number of geofence breaches |
| `geo_breach_time_s` | Total time outside geofence |
| `data_quality_pct` | Percentage of readings with accurate GPS |
| `total_samples` | Total number of telemetry samples |

## Story generation

The story is built from templates using f-strings. Example:

> "The buggy completed a 2.5-minute trip, covering 1.23 km. Top speed reached 53 km/h, with an average moving speed of 38 km/h. Driving was smooth with no hard acceleration or braking events. The buggy stopped 2 time(s) for a total of 15 seconds. No safety issues detected. Data quality was excellent (95.3% accurate GPS)."

The story adapts based on the metrics:
- If hard braking > 5: warns about aggressive driving
- If gas ≥ 1500: shows warning
- If gas ≥ 1800: shows critical alert
- If temperature ≥ 45°C: shows warning
- If battery ≤ 20%: shows warning
- If geofence breached: shows breach info
- If data quality < 70%: warns about poor GPS

## Files

| File | Purpose |
|------|---------|
| `worker.py` | Main analysis worker |
| `requirements.txt` | Python dependencies (psycopg2, pandas) |
| `.env` | Database connection settings |
| `.env.example` | Template for .env |

## Troubleshooting

**"Database connection failed"**
- Check PostgreSQL is running: `docker compose ps`
- Verify `.env` has correct credentials

**"No pending trips found"**
- Make sure you stopped the simulator and waited 65 seconds
- Check trip status in database: `docker exec -it buggy-postgres psql -U buggy -d buggy_telemetry -c "SELECT id, status, analysis_status FROM trips;"`

**Analysis fails**
- Check worker logs for error messages
- Verify readings exist: `docker exec -it buggy-postgres psql -U buggy -d buggy_telemetry -c "SELECT count(*) FROM readings WHERE trip_pk = 1;"`
