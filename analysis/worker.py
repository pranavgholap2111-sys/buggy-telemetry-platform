#!/usr/bin/env python3
"""
worker.py — Trip analysis worker

Polls the database for ended trips that need analysis, computes metrics,
generates a rule-based story, and writes results to trip_summaries.

Run:  python worker.py
"""

import os
import sys
import time
import math
import json
import logging
from datetime import datetime, timedelta

import psycopg2
import psycopg2.extras
import pandas as pd

# ─────────────────────────────────────────────────────────────
# CONFIGURATION — tune these thresholds to change analysis behavior
# ─────────────────────────────────────────────────────────────

# Polling
POLL_INTERVAL_S = int(os.getenv('POLL_INTERVAL_S', '5'))

# Database
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5433')),
    'user': os.getenv('DB_USER', 'buggy'),
    'password': os.getenv('DB_PASSWORD', 'buggy_dev_pw'),
    'dbname': os.getenv('DB_NAME', 'buggy_telemetry'),
}

# Metric thresholds
MOVING_SPEED_THRESHOLD_KMH = 5      # below this = stopped
HARD_ACCEL_THRESHOLD_KMH = 15       # speed change in 1 second
HARD_BRAKE_THRESHOLD_KMH = 15       # speed change in 1 second
GAS_WARNING_PPM = 1500
GAS_CRITICAL_PPM = 1800
TEMP_WARNING_C = 45
BATTERY_LOW_PCT = 20

# Earth radius for haversine (meters)
EARTH_RADIUS_M = 6371000

# ─────────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger('analysis')

# ─────────────────────────────────────────────────────────────
# UTILITY FUNCTIONS
# ─────────────────────────────────────────────────────────────

def haversine(lat1, lon1, lat2, lon2):
    """Calculate distance between two GPS coordinates in meters."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return EARTH_RADIUS_M * c


def get_db_connection():
    """Create a new database connection."""
    return psycopg2.connect(**DB_CONFIG)


def claim_pending_trip(conn):
    """
    Find and claim one pending trip using SELECT ... FOR UPDATE SKIP LOCKED.
    Returns the trip row or None if no trips are pending.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute("""
            SELECT id, device_id, trip_id, started_at, ended_at, sample_count
            FROM trips
            WHERE analysis_status = 'pending'
            ORDER BY ended_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        """)
        row = cur.fetchone()
        if row:
            # Mark as running
            cur.execute(
                "UPDATE trips SET analysis_status = 'running' WHERE id = %s",
                (row['id'],)
            )
            conn.commit()
            return dict(row)
    return None


def fetch_readings(conn, trip_pk):
    """Fetch all readings for a trip, ordered by time."""
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute("""
            SELECT "time", speed_kmh, raw_gps_kmh, raw_acc_kmh, temp_c, gas_ppm,
                   pitch_deg, roll_deg, lat, lon, sat, battery_pct,
                   geo_active, geo_breach, pos_src
            FROM readings
            WHERE trip_pk = %s
            ORDER BY "time" ASC
        """, (trip_pk,))
        return [dict(row) for row in cur.fetchall()]


def compute_metrics(readings, trip):
    """Compute all metrics for a trip."""
    if not readings:
        return {}

    df = pd.DataFrame(readings)
    df['time'] = pd.to_datetime(df['time'])

    # ── Duration ─────────────────────────────────────────────
    duration_s = (df['time'].max() - df['time'].min()).total_seconds()
    duration_min = duration_s / 60

    # ── Speed metrics ────────────────────────────────────────
    top_speed = float(df['speed_kmh'].max())
    avg_speed = float(df['speed_kmh'].mean())

    # Moving average (only when speed > threshold)
    moving = df[df['speed_kmh'] > MOVING_SPEED_THRESHOLD_KMH]
    avg_moving_speed = float(moving['speed_kmh'].mean()) if len(moving) > 0 else 0

    # ── Distance ─────────────────────────────────────────────
    # Use haversine on accurate GPS positions only
    accurate = df[(df['pos_src'] == 0) & (df['sat'] >= 4)].copy()
    distance_estimated = False

    if len(accurate) >= 2:
        distances = []
        for i in range(1, len(accurate)):
            d = haversine(
                accurate.iloc[i-1]['lat'], accurate.iloc[i-1]['lon'],
                accurate.iloc[i]['lat'], accurate.iloc[i]['lon']
            )
            distances.append(d)
        distance_m = sum(distances)
    else:
        # Estimate from speed × time
        distance_m = float(avg_speed * (duration_s / 3600) * 1000)
        distance_estimated = True

    distance_km = distance_m / 1000

    # ── Stops ────────────────────────────────────────────────
    stopped = df['speed_kmh'] <= MOVING_SPEED_THRESHOLD_KMH
    stop_count = 0
    stop_duration_s = 0
    in_stop = False
    stop_start = None

    for i, row in df.iterrows():
        if row['speed_kmh'] <= MOVING_SPEED_THRESHOLD_KMH:
            if not in_stop:
                in_stop = True
                stop_start = row['time']
                stop_count += 1
        else:
            if in_stop:
                in_stop = False
                stop_duration_s += (row['time'] - stop_start).total_seconds()

    # ── Hard acceleration / braking ──────────────────────────
    hard_accel_count = 0
    hard_brake_count = 0

    for i in range(1, len(df)):
        dt = (df.iloc[i]['time'] - df.iloc[i-1]['time']).total_seconds()
        if dt <= 1.5:  # within ~1 second
            dv = df.iloc[i]['speed_kmh'] - df.iloc[i-1]['speed_kmh']
            if dv >= HARD_ACCEL_THRESHOLD_KMH:
                hard_accel_count += 1
            elif dv <= -HARD_BRAKE_THRESHOLD_KMH:
                hard_brake_count += 1

    # ── Pitch and roll ───────────────────────────────────────
    max_pitch = int(abs(df['pitch_deg']).max())
    max_roll = int(abs(df['roll_deg']).max())

    # ── Temperature ──────────────────────────────────────────
    max_temp = float(df['temp_c'].max())
    time_above_temp_warning = 0
    if max_temp >= TEMP_WARNING_C:
        above = df[df['temp_c'] >= TEMP_WARNING_C]
        if len(above) > 1:
            time_above_temp_warning = (above['time'].max() - above['time'].min()).total_seconds()

    # ── Gas ──────────────────────────────────────────────────
    peak_gas = int(df['gas_ppm'].max())
    time_above_gas_warning = 0
    if peak_gas >= GAS_WARNING_PPM:
        above = df[df['gas_ppm'] >= GAS_WARNING_PPM]
        if len(above) > 1:
            time_above_gas_warning = (above['time'].max() - above['time'].min()).total_seconds()

    # ── Battery ──────────────────────────────────────────────
    min_battery = int(df['battery_pct'].min())

    # ── Geofence ─────────────────────────────────────────────
    geo_breach_count = int(df['geo_breach'].sum())
    geo_breach_time_s = 0
    if geo_breach_count > 0:
        breached = df[df['geo_breach'] == True]
        if len(breached) > 1:
            geo_breach_time_s = (breached['time'].max() - breached['time'].min()).total_seconds()

    # ── Data quality ─────────────────────────────────────────
    total_rows = len(df)
    accurate_rows = len(df[(df['pos_src'] == 0) & (df['sat'] >= 4)])
    data_quality_pct = round((accurate_rows / total_rows) * 100, 1) if total_rows > 0 else 0

    return {
        'duration_s': round(duration_s, 1),
        'duration_min': round(duration_min, 1),
        'top_speed_kmh': round(top_speed, 1),
        'avg_speed_kmh': round(avg_speed, 1),
        'avg_moving_speed_kmh': round(avg_moving_speed, 1),
        'distance_km': round(distance_km, 2),
        'distance_estimated': distance_estimated,
        'stop_count': stop_count,
        'stop_duration_s': round(stop_duration_s, 1),
        'hard_accel_count': hard_accel_count,
        'hard_brake_count': hard_brake_count,
        'max_pitch_deg': max_pitch,
        'max_roll_deg': max_roll,
        'max_temp_c': round(max_temp, 1),
        'time_above_temp_warning_s': round(time_above_temp_warning, 1),
        'peak_gas_ppm': peak_gas,
        'time_above_gas_warning_s': round(time_above_gas_warning, 1),
        'min_battery_pct': min_battery,
        'geo_breach_count': geo_breach_count,
        'geo_breach_time_s': round(geo_breach_time_s, 1),
        'data_quality_pct': data_quality_pct,
        'total_samples': total_rows,
    }


def generate_story(metrics, trip):
    """Generate a rule-based trip story using templates."""
    if not metrics:
        return "No data available for analysis."

    parts = []

    # Opening
    parts.append(
        f"The buggy completed a {metrics['duration_min']:.1f}-minute trip, "
        f"covering {metrics['distance_km']:.2f} km."
    )

    # Speed
    parts.append(
        f"Top speed reached {metrics['top_speed_kmh']:.0f} km/h, "
        f"with an average moving speed of {metrics['avg_moving_speed_kmh']:.0f} km/h."
    )

    # Smoothness
    if metrics['hard_brake_count'] == 0 and metrics['hard_accel_count'] == 0:
        parts.append("Driving was smooth with no hard acceleration or braking events.")
    elif metrics['hard_brake_count'] > 5:
        parts.append(
            f"⚠️ {metrics['hard_brake_count']} hard braking events detected — "
            f"consider smoother deceleration."
        )
    else:
        parts.append(
            f"{metrics['hard_accel_count']} hard acceleration and "
            f"{metrics['hard_brake_count']} hard braking events were recorded."
        )

    # Stops
    if metrics['stop_count'] > 0:
        parts.append(
            f"The buggy stopped {metrics['stop_count']} time(s) "
            f"for a total of {metrics['stop_duration_s']:.0f} seconds."
        )

    # Safety flags
    safety = []
    if metrics['peak_gas_ppm'] >= GAS_CRITICAL_PPM:
        safety.append(f"🔴 CRITICAL: Gas peaked at {metrics['peak_gas_ppm']} ppm")
    elif metrics['peak_gas_ppm'] >= GAS_WARNING_PPM:
        safety.append(f"🟡 Gas warning: peaked at {metrics['peak_gas_ppm']} ppm")

    if metrics['max_temp_c'] >= TEMP_WARNING_C:
        safety.append(f"🟡 High temperature: {metrics['max_temp_c']}°C")

    if metrics['min_battery_pct'] <= BATTERY_LOW_PCT:
        safety.append(f"🟡 Low battery: {metrics['min_battery_pct']}%")

    if metrics['geo_breach_count'] > 0:
        safety.append(
            f"📍 Geofence breached {metrics['geo_breach_count']} time(s) "
            f"for {metrics['geo_breach_time_s']:.0f}s total"
        )

    if safety:
        parts.append("Safety flags: " + "; ".join(safety) + ".")
    else:
        parts.append("No safety issues detected.")

    # Data quality
    if metrics['data_quality_pct'] >= 90:
        parts.append(f"Data quality was excellent ({metrics['data_quality_pct']}% accurate GPS).")
    elif metrics['data_quality_pct'] >= 70:
        parts.append(f"Data quality was good ({metrics['data_quality_pct']}% accurate GPS).")
    else:
        parts.append(
            f"⚠️ Data quality was poor ({metrics['data_quality_pct']}% accurate GPS) — "
            f"distance may be estimated."
        )

    return " ".join(parts)


def save_summary(conn, trip_pk, metrics, story):
    """Write the analysis results to trip_summaries."""
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO trip_summaries (trip_pk, story_text, metrics)
            VALUES (%s, %s, %s)
            ON CONFLICT (trip_pk) DO UPDATE
            SET story_text = EXCLUDED.story_text,
                metrics = EXCLUDED.metrics,
                created_at = now()
        """, (trip_pk, story, json.dumps(metrics)))


def mark_done(conn, trip_pk):
    """Mark the trip as analyzed."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE trips SET analysis_status = 'done' WHERE id = %s",
            (trip_pk,)
        )
    conn.commit()


def mark_failed(conn, trip_pk, error_msg):
    """Mark the trip analysis as failed."""
    log.error(f"Analysis failed for trip {trip_pk}: {error_msg}")
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE trips SET analysis_status = 'failed' WHERE id = %s",
            (trip_pk,)
        )
    conn.commit()


# ─────────────────────────────────────────────────────────────
# MAIN LOOP
# ─────────────────────────────────────────────────────────────

def process_one_trip(conn):
    """Try to process one pending trip. Returns True if a trip was processed."""
    trip = claim_pending_trip(conn)
    if not trip:
        return False

    trip_pk = trip['id']
    log.info(f"▶ Analyzing trip {trip_pk} ({trip['trip_id']})...")

    try:
        readings = fetch_readings(conn, trip_pk)
        log.info(f"  Fetched {len(readings)} readings")

        metrics = compute_metrics(readings, trip)
        log.info(f"  Computed metrics: top_speed={metrics.get('top_speed_kmh')} km/h, "
                 f"distance={metrics.get('distance_km')} km")

        story = generate_story(metrics, trip)
        log.info(f"  Generated story ({len(story)} chars)")

        save_summary(conn, trip_pk, metrics, story)
        mark_done(conn, trip_pk)

        log.info(f"✓ Trip {trip_pk} analysis complete")
        return True

    except Exception as e:
        mark_failed(conn, trip_pk, str(e))
        return True  # we processed it (even though it failed)


def main():
    log.info("=" * 50)
    log.info("  Buggy Trip Analysis Worker")
    log.info("=" * 50)
    log.info(f"Database: {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['dbname']}")
    log.info(f"Poll interval: {POLL_INTERVAL_S}s")
    log.info("")

    # Test database connection
    try:
        conn = get_db_connection()
        log.info("✓ Connected to database")
    except Exception as e:
        log.error(f"✗ Database connection failed: {e}")
        log.error("  Is PostgreSQL running? Check: docker compose -f infra/docker-compose.yml ps")
        sys.exit(1)

    log.info("✓ Worker ready. Polling for pending trips...")
    log.info("")

    while True:
        try:
            # Reconnect if connection was lost
            if conn.closed:
                conn = get_db_connection()

            processed = process_one_trip(conn)
            if not processed:
                # No pending trips, wait before polling again
                time.sleep(POLL_INTERVAL_S)

        except KeyboardInterrupt:
            log.info("\n🛑 Worker stopped by user")
            break
        except psycopg2.OperationalError as e:
            log.warning(f"Database connection lost: {e}. Reconnecting in 5s...")
            time.sleep(5)
            try:
                conn = get_db_connection()
            except Exception:
                pass
        except Exception as e:
            log.error(f"Unexpected error: {e}")
            time.sleep(POLL_INTERVAL_S)

    conn.close()
    log.info("✓ Worker shutdown complete")


if __name__ == '__main__':
    main()
