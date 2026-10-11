#!/usr/bin/env python3
"""
generate_synthetic.py — realistic fallback profiles (SRS §13).

Creates believable 15-minute smart-meter datasets for four facility archetypes
(office tower, hospital, campus, data centre) when open datasets are unavailable
or a licence is unclear. Output is deterministic (fixed seed) so demos and tests
are reproducible.

Usage
-----
    python data/scripts/generate_synthetic.py                # all four, 30 days
    python data/scripts/generate_synthetic.py --days 14
    python data/scripts/generate_synthetic.py --facility office --out data/demo
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import random
from dataclasses import dataclass
from datetime import datetime, timedelta

INTERVAL_MINUTES = 15
STEPS_PER_DAY = 24 * 60 // INTERVAL_MINUTES  # 96


# ---------------------------------------------------------------------------
# Facility archetypes
# ---------------------------------------------------------------------------
@dataclass
class Profile:
    key: str
    name: str
    base_kw: float
    peak_kw: float
    start_hour: float
    end_hour: float
    weekend_scale: float
    occ_weight: float
    hvac_weight: float
    solar_weight: float
    night_floor: float
    missing_rate: float
    seed: int
    has_solar: bool = False
    flat_load: bool = False
    tags: tuple[str, ...] = ()


PROFILES: dict[str, Profile] = {
    "office": Profile(
        key="office",
        name="Office Tower A",
        base_kw=170,
        peak_kw=640,
        start_hour=7.5,
        end_hour=19.0,
        weekend_scale=0.34,
        occ_weight=0.60,
        hvac_weight=0.32,
        solar_weight=0.08,
        night_floor=0.05,
        missing_rate=0.004,
        seed=101,
        tags=("weekday-peak", "commercial"),
    ),
    "hospital": Profile(
        key="hospital",
        name="City General Hospital",
        base_kw=520,
        peak_kw=960,
        start_hour=0.0,
        end_hour=24.0,
        weekend_scale=0.97,
        occ_weight=0.32,
        hvac_weight=0.58,
        solar_weight=0.10,
        night_floor=0.85,
        missing_rate=0.002,
        seed=202,
        tags=("24/7", "critical"),
    ),
    "campus": Profile(
        key="campus",
        name="Tech Campus West",
        base_kw=140,
        peak_kw=720,
        start_hour=7.0,
        end_hour=22.0,
        weekend_scale=0.40,
        occ_weight=0.54,
        hvac_weight=0.34,
        solar_weight=0.12,
        night_floor=0.06,
        missing_rate=0.006,
        seed=303,
        has_solar=True,
        tags=("campus", "solar"),
    ),
    "data_center": Profile(
        key="data_center",
        name="HyperScale DC-1",
        base_kw=1380,
        peak_kw=1680,
        start_hour=0.0,
        end_hour=24.0,
        weekend_scale=1.0,
        occ_weight=0.10,
        hvac_weight=0.70,
        solar_weight=0.0,
        night_floor=0.95,
        missing_rate=0.001,
        seed=404,
        flat_load=True,
        tags=("datacenter", "flat-load"),
    ),
}


# ---------------------------------------------------------------------------
# Weather model (mirrors the TypeScript fallback provider)
# ---------------------------------------------------------------------------
def outdoor_temperature(dt: datetime, lat: float, base: float) -> float:
    day_of_year = dt.timetuple().tm_yday
    southern = lat < 0
    peak_day = 20 if southern else 200
    seasonal = math.cos(2 * math.pi * (day_of_year - peak_day) / 365)
    lon = -122.4  # pointer for the local solar clock used by the demo regions
    hour = dt.hour + dt.minute / 60
    solar_hour = hour - lon / 15
    diurnal = math.cos(2 * math.pi * (solar_hour - 15) / 24)
    return base + (13 * seasonal) + (8 * diurnal)


def irradiance(dt: datetime, lat: float) -> float:
    day_of_year = dt.timetuple().tm_yday
    declination = 23.45 * math.sin(2 * math.pi * (284 + day_of_year) / 365)
    hour = dt.hour + dt.minute / 60
    hour_angle = 15 * (hour - 12)
    lat_rad = math.radians(lat)
    sin_elev = math.sin(lat_rad) * math.sin(math.radians(declination)) + math.cos(lat_rad) * math.cos(
        math.radians(declination)
    ) * math.cos(math.radians(hour_angle))
    if sin_elev <= 0:
        return 0.0
    return 1000.0 * (sin_elev ** 1.15)


def humidity(dt: datetime, temp_c: float) -> float:
    hour = dt.hour + dt.minute / 60
    return max(15.0, min(100.0, 72 - 0.5 * temp_c + 6 * math.sin(2 * math.pi * (hour - 4) / 24)))


# ---------------------------------------------------------------------------
# Load simulation
# ---------------------------------------------------------------------------
def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def occupancy_factor(dt: datetime, profile: Profile) -> float:
    """0..1 smooth occupancy ramp between start and end hour."""
    weekday = dt.weekday()  # 0 = Monday
    hour = dt.hour + dt.minute / 60

    if profile.start_hour >= profile.end_hour:  # 24/7 facility
        return 1.0 if weekday < 5 else profile.weekend_scale

    morning = _sigmoid((hour - profile.start_hour) / 1.2)
    evening = _sigmoid((profile.end_hour - hour) / 1.4)
    occ = morning * evening
    if weekday >= 5:
        occ *= profile.weekend_scale
    return max(0.0, min(1.0, occ))


def simulate_step(dt: datetime, profile: Profile, lat: float, rng: random.Random):
    temp_c = outdoor_temperature(dt, lat, 18.0) + rng.gauss(0, 0.6)
    irr = max(0.0, irradiance(dt, lat) * (1 - 0.3 * rng.random()))
    hum = humidity(dt, temp_c)

    occ = occupancy_factor(dt, profile)
    cdd = max(0.0, temp_c - 22.0)
    hvac_unit = min(1.2, cdd / 12.0)
    solar_unit = irr / 1000.0
    hvac_mod = profile.night_floor + (1 - profile.night_floor) * occ

    span = profile.peak_kw - profile.base_kw
    if profile.flat_load:
        shape = 0.55 + 0.40 * hvac_unit
    else:
        shape = (
            profile.occ_weight * occ
            + profile.hvac_weight * hvac_unit * hvac_mod
            + profile.solar_weight * solar_unit * occ
        )

    power = profile.base_kw + span * shape

    # Rooftop PV: an on-site array offsets net load on sunny daytime hours.
    if profile.has_solar:
        power -= 0.07 * irr

    power += rng.gauss(0, profile.base_kw * 0.012)
    return max(5.0, power), temp_c, irr, hum


# ---------------------------------------------------------------------------
# Dataset generation
# ---------------------------------------------------------------------------
def generate_dataset(profile: Profile, days: int, start: datetime, lat: float) -> list[dict]:
    rng = random.Random(profile.seed)
    rows: list[dict] = []
    total_steps = days * STEPS_PER_DAY

    for step in range(total_steps):
        dt = start + timedelta(minutes=step * INTERVAL_MINUTES)
        power, temp_c, irr, hum = simulate_step(dt, profile, lat, rng)
        rows.append(
            {
                "timestamp": dt.strftime("%Y-%m-%d %H:%M"),
                "Active Power (kW)": round(power, 3),
                "Outdoor Temperature (C)": round(temp_c, 2),
                "Humidity (%)": round(hum, 1),
                "Solar Irradiance (W/m2)": round(irr, 1),
            }
        )

    _inject_anomalies(rows, profile, rng)
    return rows


def _inject_anomalies(rows: list[dict], profile: Profile, rng: random.Random) -> None:
    """Add realistic dirty-data artefacts so the quality report is meaningful."""
    keep: list[dict] = []
    for i, row in enumerate(rows):
        if i > 0 and i < len(rows) - 1 and rng.random() < profile.missing_rate:
            continue
        keep.append(row)
    rows[:] = keep

    if len(rows) > 400:
        gap_start = rng.randint(100, len(rows) - 120)
        gap_len = rng.randint(3, 7)
        del rows[gap_start : gap_start + gap_len]

    for _ in range(3):
        idx = rng.randint(10, len(rows) - 10)
        rows[idx]["Active Power (kW)"] = round(rows[idx]["Active Power (kW)"] * rng.uniform(2.2, 2.8), 3)


def write_csv(rows: list[dict], path: str) -> None:
    if not rows:
        raise ValueError("no rows to write")
    fieldnames = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic 15-min smart-meter datasets.")
    parser.add_argument("--days", type=int, default=30, help="number of days to generate (default 30)")
    parser.add_argument("--out", default="data/demo", help="output directory")
    parser.add_argument("--facility", choices=sorted(PROFILES.keys()), default=None)
    parser.add_argument("--start", default=None, help="ISO start date (default: N days before today)")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    if args.start:
        start = datetime.fromisoformat(args.start).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        start = today - timedelta(days=args.days)

    keys = [args.facility] if args.facility else list(PROFILES.keys())
    filename = {
        "office": "office_tower.csv",
        "hospital": "hospital.csv",
        "campus": "campus.csv",
        "data_center": "data_center.csv",
    }
    latitude = {"office": 19.076, "hospital": 51.5074, "campus": 37.7749, "data_center": 52.52}

    for key in keys:
        profile = PROFILES[key]
        rows = generate_dataset(profile, args.days, start, latitude[key])
        path = os.path.join(args.out, filename[key])
        write_csv(rows, path)
        powers = [r["Active Power (kW)"] for r in rows]
        p95 = sorted(powers)[int(len(powers) * 0.95)]
        total_kwh = sum(p * 0.25 for p in powers)
        print(
            f"[ok] {profile.name:<24} -> {path}  rows={len(rows):>5}  "
            f"kWh={total_kwh:>10.0f}  typical(95p)={p95:>7.0f} kW  spikes={max(powers):>7.0f} kW"
        )


if __name__ == "__main__":
    main()
