#!/usr/bin/env python3
"""
build_reference_datasets.py — integrate the supplied real / government datasets
in ``data/raw`` into the M2 ingestion layer.

The raw archive (see ``data/raw/README.md`` for full provenance) contains:

  * ``india_global_electricity_mix.csv``      Ember (CC BY 4.0) — annual generation mix
  * ``tamil_nadu_weather_solar_2024.csv``     Open-Meteo (CC BY 4.0) — hourly 2024
  * ``chennai_weather_2024.csv``              Open-Meteo (CC BY 4.0) — hourly 2024
  * ``india_states_daily_energy_MU.csv``      CEA / data.gov.in — daily energy by state
  * ``india_states_peak_demand_MW.csv``       CEA / data.gov.in — daily peak demand by state

From them this script derives three things and keeps everything deterministic so
the demo and the test-suite stay reproducible:

  1. A **real India grid carbon intensity** for the ``IN-TN`` region, computed
     from the Ember 2024 generation mix and standard lifecycle emission factors,
     plus a solar-aware diurnal shape derived from measured Tamil Nadu irradiance.
  2. **Tamil Nadu climate parameters** (``baseC``/``seasonalAmpC``/``diurnalAmpC``)
     measured from the Open-Meteo archive, merged into the offline fallback pack.
  3. A **real-demand-calibrated demo facility** — *Chennai IT Park* (region
     ``IN-TN``) — whose outdoor temperature / humidity / irradiance columns are the
     actual 2024 Tamil Nadu weather and whose load is shaped by the real CEA Tamil
     Nadu demand profile.

Outputs
-------
  data/cache/grid_ci_fallback.json   (+ IN-TN region)
  data/cache/weather_fallback.json   (+ IN-TN region)
  data/cache/demand_profiles.json    (new — per-region monthly/weekly demand factors)
  data/demo/chennai_it_park.csv      (new demo facility, real-weather backed)
  data/demo/MANIFEST.json            (+ Chennai IT Park entry)
  data/raw/DERIVED_MANIFEST.json     (provenance + every derived number)

Usage
-----
    python data/scripts/build_reference_datasets.py
    python data/scripts/build_reference_datasets.py --window-start 2024-03-30 --days 30
    python data/scripts/build_reference_datasets.py --dry-run
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from statistics import mean

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

RAW_DIR = os.path.join(ROOT, "data", "raw")
CACHE_DIR = os.path.join(ROOT, "data", "cache")
DEMO_DIR = os.path.join(ROOT, "data", "demo")

INTERVAL_MINUTES = 15
STEPS_PER_DAY = 24 * 60 // INTERVAL_MINUTES  # 96

# Region + facility identity (kept in sync with packages/shared/src/constants.ts).
REGION = "IN-TN"
TIMEZONE = "Asia/Kolkata"
IST_OFFSET = timedelta(hours=5, minutes=30)

FACILITY_ID = "55555555-5555-4555-8555-555555555555"
FACILITY_KEY = "chennai"
FACILITY_NAME = "Chennai IT Park"
FACILITY_FILE = "chennai_it_park.csv"
FACILITY_LAT = 13.0827
FACILITY_LON = 80.2707

def _utcnow() -> str:
    """Timezone-aware UTC timestamp (avoids the deprecated datetime.utcnow)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


# Lifecycle emission factors (gCO2e/kWh) — IPCC AR5 / Ember methodology medians.
EMISSION_FACTORS_G_PER_KWH = {
    "Coal": 820,
    "Gas": 490,
    "Oil": 650,
    "Nuclear": 12,
    "Hydropower": 24,
    "Solar": 48,
    "Wind": 11,
    "Bioenergy": 230,
    "Other renewables": 40,
}

MIX_COLUMNS = ["Other renewables", "Bioenergy", "Solar", "Wind", "Hydropower", "Nuclear", "Gas", "Oil", "Coal"]

# A generic India "duck curve" (mean ≈ 1.0) used as the base for the derived
# diurnal shape; the measured solar term then deepens the midday dip.
INDIA_DIURNAL_BASE = [
    0.93, 0.9, 0.89, 0.87, 0.9, 0.97, 1.03, 1.07, 1.03, 1.0, 0.97, 0.94,
    0.93, 0.91, 0.9, 0.9, 0.91, 0.97, 1.04, 1.09, 1.04, 1.0, 0.96, 0.93,
]

# CEA state tables: 1 date column + 38 entity columns + a trailing "Total".
CEA_STATE = "Tamil Nadu"


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _read_csv(path: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def _f(value: str | None) -> float | None:
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _round(value: float, ndigits: int) -> float:
    return round(value, ndigits)


# ---------------------------------------------------------------------------
# 1. Grid carbon intensity from the Ember generation mix
# ---------------------------------------------------------------------------

def derive_grid_intensity(raw_dir: str, year: int | None) -> dict:
    rows = _read_csv(os.path.join(raw_dir, "india_global_electricity_mix.csv"))
    india = [r for r in rows if (r.get("Entity") or "").strip() == "India"]
    if not india:
        raise SystemExit("india_global_electricity_mix.csv has no 'India' rows")

    def _row_year(r: dict) -> int | None:
        try:
            return int((r.get("Year") or "").strip())
        except ValueError:
            return None

    complete = [r for r in india if all(_f(r.get(c)) is not None for c in MIX_COLUMNS)]
    if not complete:
        raise SystemExit("no complete India generation-mix rows found")

    if year is not None:
        match = [r for r in complete if _row_year(r) == year]
        if not match:
            raise SystemExit(f"no complete India generation mix for year {year}")
        chosen = match[0]
    else:
        chosen = max(complete, key=lambda r: _row_year(r) or 0)

    year_used = _row_year(chosen)
    mix = {c: _f(chosen.get(c)) or 0.0 for c in MIX_COLUMNS}
    total_twh = sum(mix.values())
    if total_twh <= 0:
        raise SystemExit("India generation mix is empty for the chosen year")

    emissions = sum(mix[c] * EMISSION_FACTORS_G_PER_KWH[c] for c in MIX_COLUMNS)
    annual_ci = emissions / total_twh

    # Share of carbon-free / low-carbon generation, for the doc block.
    low_carbon = mix["Nuclear"] + mix["Hydropower"] + mix["Solar"] + mix["Wind"] + mix["Other renewables"]
    return {
        "year": year_used,
        "mixTWh": {c: _round(mix[c], 2) for c in MIX_COLUMNS},
        "totalTWh": _round(total_twh, 2),
        "annualAverageCi": _round(annual_ci, 1),
        "lowCarbonSharePct": _round(100 * low_carbon / total_twh, 1),
    }


# ---------------------------------------------------------------------------
# 2. Weather archive parsing (Open-Meteo layout with 3 preamble lines)
# ---------------------------------------------------------------------------

WEATHER_FILES = {
    "tamil_nadu": "tamil_nadu_weather_solar_2024.csv",
    "chennai": "chennai_weather_2024.csv",
}


def _load_weather(path: str) -> list[dict]:
    """Parse an Open-Meteo export into a list of hourly records (UTC)."""
    with open(path, encoding="utf-8-sig") as fh:
        lines = fh.read().splitlines()

    header_idx = next((i for i, ln in enumerate(lines) if ln.lower().startswith("time,")), None)
    if header_idx is None:
        raise SystemExit(f"{os.path.basename(path)}: could not locate the 'time' header row")

    header = [h.strip() for h in lines[header_idx].split(",")]
    records: list[dict] = []
    for line in lines[header_idx + 1 :]:
        if not line.strip():
            continue
        cells = line.split(",")
        rec: dict = {}
        for name, cell in zip(header, cells):
            rec[name] = cell.strip()
        ts = datetime.fromisoformat(rec["time"])
        records.append(
            {
                "utc": ts,
                "tempC": _f(rec.get("temperature_2m (°C)")) or 0.0,
                "humidityPct": _f(rec.get("relative_humidity_2m (%)")) or 0.0,
                "dniWm2": _f(rec.get("direct_normal_irradiance (W/m²)")) or 0.0,
                "gtiWm2": _f(rec.get("global_tilted_irradiance (W/m²)")) or 0.0,
            }
        )
    return records


def derive_climate(records: list[dict]) -> dict:
    """Mean temperature + annual/diurnal amplitudes measured from the archive."""
    temps = [r["tempC"] for r in records]
    base = mean(temps)

    by_month: dict[int, list[float]] = {}
    for r in records:
        by_month.setdefault(r["utc"].month, []).append(r["tempC"])
    monthly = {m: mean(v) for m, v in by_month.items()}
    seasonal_amp = (max(monthly.values()) - min(monthly.values())) / 2

    by_day: dict[str, list[float]] = {}
    for r in records:
        by_day.setdefault(r["utc"].date().isoformat(), []).append(r["tempC"])
    daily_ranges = [max(v) - min(v) for v in by_day.values() if len(v) > 1]
    diurnal_amp = (mean(daily_ranges) / 2) if daily_ranges else 4.0

    # Diurnal CI shape: a generic India duck curve deepened by the measured
    # solar term (more irradiance ⇒ cleaner grid), normalized to mean 1.0.
    by_hour: dict[int, list[float]] = {}
    for r in records:
        by_hour.setdefault(r["utc"].hour, []).append(r["gtiWm2"])
    hourly = [mean(by_hour.get(h, [0.0])) for h in range(24)]
    peak = max(hourly) or 1.0
    norm = [h / peak for h in hourly]
    diurnal = [base * (1.0 - 0.18 * n) for base, n in zip(INDIA_DIURNAL_BASE, norm)]
    diurnal_mean = mean(diurnal)
    diurnal = [d / diurnal_mean for d in diurnal]

    return {
        "baseC": _round(base, 2),
        "seasonalAmpC": _round(seasonal_amp, 2),
        "diurnalAmpC": _round(diurnal_amp, 2),
        "monthlyMeansC": {str(m): _round(v, 2) for m, v in sorted(monthly.items())},
        "diurnalCi": [_round(d, 4) for d in diurnal],
    }


# ---------------------------------------------------------------------------
# 3. CEA state demand (daily energy + peak) → seasonal / weekly factors
# ---------------------------------------------------------------------------

def derive_demand_profile(raw_dir: str) -> dict:
    energy = _read_csv(os.path.join(raw_dir, "india_states_daily_energy_MU.csv"))
    peak = _read_csv(os.path.join(raw_dir, "india_states_peak_demand_MW.csv"))

    def _series(rows: list[dict[str, str]]) -> list[tuple[datetime, float]]:
        out: list[tuple[datetime, float]] = []
        for row in rows:
            date = (row.get("Date") or "").strip()
            value = _f(row.get(CEA_STATE))
            if not date or value is None or value <= 0:
                continue
            try:
                dt = datetime.strptime(date, "%Y-%m-%d")
            except ValueError:
                continue
            out.append((dt, value))
        return out

    energy_series = _series(energy)
    peak_series = _series(peak)
    if not energy_series:
        raise SystemExit("CEA energy table has no Tamil Nadu column")

    daily_energy = [v for _, v in energy_series]
    overall = mean(daily_energy)

    by_month: dict[int, list[float]] = {}
    for dt, value in energy_series:
        by_month.setdefault(dt.month, []).append(value)
    monthly_factors = {str(m): _round(mean(v) / overall, 4) for m, v in sorted(by_month.items())}

    by_weekday: dict[int, list[float]] = {}
    for dt, value in energy_series:
        by_weekday.setdefault(dt.weekday(), []).append(value)
    weekday_factors = {str(d): _round(mean(v) / overall, 4) for d, v in sorted(by_weekday.items())}

    peak_values = [v for _, v in peak_series]
    return {
        "state": CEA_STATE,
        "unitEnergy": "MU (million units = GWh) per day",
        "unitPeak": "MW per day",
        "rangeEnergy": f"{energy_series[0][0].date()} .. {energy_series[-1][0].date()}",
        "daysEnergy": len(energy_series),
        "meanDailyEnergyMU": _round(overall, 2),
        "peakDemandMW": {
            "min": _round(min(peak_values), 1) if peak_values else None,
            "max": _round(max(peak_values), 1) if peak_values else None,
            "mean": _round(mean(peak_values), 1) if peak_values else None,
        },
        "monthlyFactors": monthly_factors,
        "weekdayFactors": weekday_factors,
    }


# ---------------------------------------------------------------------------
# 4. Build the real-weather-backed demo facility
# ---------------------------------------------------------------------------

def _interpolate_hourly(records: list[dict], at: datetime) -> dict:
    """Linear interpolation of the hourly archive onto an arbitrary timestamp."""
    if not records:
        raise SystemExit("no weather records to interpolate")
    first, last = records[0]["utc"], records[-1]["utc"]
    if at <= first:
        return records[0]
    if at >= last:
        return records[-1]
    lower = at.replace(minute=0, second=0, microsecond=0)
    for i, rec in enumerate(records):
        if rec["utc"] == lower:
            upper = records[min(i + 1, len(records) - 1)]
            break
    else:
        return records[0]
    frac = (at - lower).total_seconds() / 3600.0
    return {
        "tempC": rec["tempC"] + frac * (upper["tempC"] - rec["tempC"]),
        "humidityPct": rec["humidityPct"] + frac * (upper["humidityPct"] - rec["humidityPct"]),
        "gtiWm2": max(0.0, rec["gtiWm2"] + frac * (upper["gtiWm2"] - rec["gtiWm2"])),
    }


def _occupancy(dt: datetime) -> float:
    """Weekday office/IT-park occupancy ramp (0..1)."""
    hour = dt.hour + dt.minute / 60
    start, end = 8.0, 20.0
    morning = 1.0 / (1.0 + math.exp(-(hour - start) / 1.1))
    evening = 1.0 / (1.0 + math.exp(-(end - hour) / 1.3))
    occ = morning * evening
    if dt.weekday() >= 5:
        occ *= 0.45
    return max(0.0, min(1.0, occ))


def build_facility_rows(weather: list[dict], demand: dict, start: datetime, days: int) -> list[dict]:
    rng = random.Random(55555)
    base_kw, peak_kw = 210.0, 780.0
    monthly = demand["monthlyFactors"]
    rows: list[dict] = []

    for step in range(days * STEPS_PER_DAY):
        local = start + timedelta(minutes=step * INTERVAL_MINUTES)
        utc = local - IST_OFFSET
        wx = _interpolate_hourly(weather, utc.replace(tzinfo=None))

        temp_c = wx["tempC"]
        gti = wx["gtiWm2"]

        occ = _occupancy(local)
        cooling = max(0.0, temp_c - 24.0)
        hvac_unit = min(1.2, cooling / 10.0)
        solar_unit = gti / 1000.0
        shape = 0.55 * occ + 0.38 * hvac_unit * (0.3 + 0.7 * occ) + 0.07 * solar_unit * occ
        power = (base_kw + (peak_kw - base_kw) * shape) * monthly.get(str(local.month), 1.0)
        power -= 0.055 * gti  # on-site rooftop PV offsets net import
        power += rng.gauss(0, base_kw * 0.012)

        rows.append(
            {
                "timestamp": local.strftime("%Y-%m-%d %H:%M"),
                "Active Power (kW)": round(max(5.0, power), 3),
                "Outdoor Temperature (C)": round(temp_c + rng.gauss(0, 0.15), 2),
                "Humidity (%)": round(min(100.0, max(10.0, wx["humidityPct"])), 1),
                "Solar Irradiance (W/m2)": round(gti, 1),
            }
        )

    _inject_anomalies(rows, rng)
    return rows


def _inject_anomalies(rows: list[dict], rng: random.Random) -> None:
    """Mirror the synthetic generator's dirty-data artefacts (gaps + spikes)."""
    keep: list[dict] = []
    for i, row in enumerate(rows):
        if i > 0 and i < len(rows) - 1 and rng.random() < 0.004:
            continue
        keep.append(row)
    rows[:] = keep

    if len(rows) > 400:
        gap_start = rng.randint(100, len(rows) - 120)
        del rows[gap_start : gap_start + rng.randint(3, 6)]

    for _ in range(3):
        idx = rng.randint(10, len(rows) - 10)
        rows[idx]["Active Power (kW)"] = round(rows[idx]["Active Power (kW)"] * rng.uniform(2.2, 2.8), 3)


def write_csv(rows: list[dict], path: str) -> None:
    fieldnames = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


# ---------------------------------------------------------------------------
# 5. Merge derived values into the committed cache + manifest
# ---------------------------------------------------------------------------

def _load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def update_grid_cache(path: str, ci: dict, climate: dict) -> None:
    data = _load_json(path) if os.path.exists(path) else {"regions": {}}
    data.setdefault("regions", {})[REGION] = {
        "annualAverageCi": ci["annualAverageCi"],
        "diurnal": climate["diurnalCi"],
    }
    data["generatedAt"] = _utcnow()
    data["source"] = (
        "Ember annual electricity data (CC BY 4.0) + derived diurnal shapes; "
        "IN-TN intensity derived from the 2024 India generation mix via "
        "data/scripts/build_reference_datasets.py"
    )
    data["derived"] = {
        "region": REGION,
        "method": "generation-mix weighted lifecycle emission factors (IPCC AR5 / Ember)",
        "sourceYear": ci["year"],
        "mixTWh": ci["mixTWh"],
        "lowCarbonSharePct": ci["lowCarbonSharePct"],
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")


def update_weather_cache(path: str, climate: dict) -> None:
    data = _load_json(path) if os.path.exists(path) else {"regions": {}}
    data.setdefault("regions", {})[REGION] = {
        "lat": FACILITY_LAT,
        "lon": FACILITY_LON,
        "timezone": TIMEZONE,
        "baseC": climate["baseC"],
        "seasonalAmpC": climate["seasonalAmpC"],
        "diurnalAmpC": climate["diurnalAmpC"],
    }
    data["generatedAt"] = _utcnow()
    data["source"] = (
        "Open-Meteo historical archive 2024 (CC BY 4.0); IN-TN parameters measured "
        "from data/raw/tamil_nadu_weather_solar_2024.csv by "
        "data/scripts/build_reference_datasets.py"
    )
    data["derived"] = {"region": REGION, "monthlyMeansC": climate["monthlyMeansC"]}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")


def write_demand_cache(path: str, demand: dict) -> None:
    payload = {
        "_comment": (
            "Per-region demand shape factors derived from CEA daily state energy and "
            "peak-demand tables (data.gov.in open data). Factors are normalised to a mean "
            "of 1.0 and are informational for M2 / consumed by load modelling."
        ),
        "generatedAt": _utcnow(),
        "source": "Central Electricity Authority (CEA) daily state tables, data.gov.in",
        "regions": {REGION: demand},
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")


def update_demo_manifest(path: str, rows: int, start: datetime, days: int, ci: dict) -> None:
    data = _load_json(path) if os.path.exists(path) else {"facilities": []}
    entry = {
        "id": FACILITY_ID,
        "key": FACILITY_KEY,
        "name": FACILITY_NAME,
        "type": "office",
        "region": REGION,
        "timezone": TIMEZONE,
        "lat": FACILITY_LAT,
        "lon": FACILITY_LON,
        "file": FACILITY_FILE,
        "start": start.isoformat(),
        "end": (start + timedelta(days=days)).isoformat(),
        "rows": rows,
        "source": "real-weather+gov-demand",
        "licence": "CC BY 4.0 (Open-Meteo weather) + Government of India open data (CEA)",
        "provenance": {
            "weather": "data/raw/tamil_nadu_weather_solar_2024.csv",
            "demand": "data/raw/india_states_daily_energy_MU.csv",
            "gridIntensity": f"data/raw/india_global_electricity_mix.csv ({ci['year']})",
        },
    }
    facilities = [f for f in data.get("facilities", []) if f.get("key") != FACILITY_KEY]
    facilities.append(entry)
    data["facilities"] = facilities
    notes = data.get("notes", "")
    marker = "The Chennai IT Park facility is backed by real Open-Meteo 2024 weather and CEA demand."
    if marker not in notes:
        data["notes"] = (notes + " " + marker).strip()
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")


def write_derived_manifest(path: str, ci: dict, climate: dict, demand: dict, rows: int, start: datetime, days: int) -> None:
    payload = {
        "generatedAt": _utcnow(),
        "generator": "data/scripts/build_reference_datasets.py",
        "inputs": {
            "electricityMix": "data/raw/india_global_electricity_mix.csv",
            "weatherTamilNadu": "data/raw/tamil_nadu_weather_solar_2024.csv",
            "weatherChennai": "data/raw/chennai_weather_2024.csv",
            "demandEnergy": "data/raw/india_states_daily_energy_MU.csv",
            "demandPeak": "data/raw/india_states_peak_demand_MW.csv",
        },
        "region": REGION,
        "gridIntensity": ci,
        "climate": climate,
        "demand": demand,
        "demoFacility": {
            "id": FACILITY_ID,
            "key": FACILITY_KEY,
            "file": FACILITY_FILE,
            "start": start.isoformat(),
            "days": days,
            "rows": rows,
        },
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Derive reference packs + a real-data demo facility from data/raw.")
    parser.add_argument("--year", type=int, default=2024, help="Ember mix year (default 2024)")
    parser.add_argument("--window-start", default="2024-03-30", help="demo window start (local IST)")
    parser.add_argument("--days", type=int, default=30, help="demo window length in days")
    parser.add_argument("--raw", default=RAW_DIR)
    parser.add_argument("--dry-run", action="store_true", help="compute and print, write nothing")
    args = parser.parse_args()

    for name in WEATHER_FILES.values():
        if not os.path.exists(os.path.join(args.raw, name)):
            raise SystemExit(f"missing raw dataset: {os.path.join(args.raw, name)}")

    ci = derive_grid_intensity(args.raw, args.year)
    tn_weather = _load_weather(os.path.join(args.raw, WEATHER_FILES["tamil_nadu"]))
    chennai_weather = _load_weather(os.path.join(args.raw, WEATHER_FILES["chennai"]))
    climate = derive_climate(tn_weather)
    demand = derive_demand_profile(args.raw)

    start = datetime.fromisoformat(args.window_start)
    rows = build_facility_rows(tn_weather, demand, start, args.days)

    print("=== derived reference values ===")
    print(f"region                : {REGION}")
    print(f"grid CI ({ci['year']})        : {ci['annualAverageCi']} gCO2/kWh  (low-carbon {ci['lowCarbonSharePct']}%)")
    print(f"climate               : base={climate['baseC']}C  seasonalAmp={climate['seasonalAmpC']}C  diurnalAmp={climate['diurnalAmpC']}C")
    print(f"TN demand range       : {demand['rangeEnergy']}  mean {demand['meanDailyEnergyMU']} MU/day")
    print(f"chennai weather hours : {len(chennai_weather)}  (cross-check)")
    print(f"demo rows             : {len(rows)}  window {start.date()} + {args.days}d  -> {FACILITY_FILE}")

    if args.dry_run:
        print("\n[dry-run] no files written")
        return

    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(DEMO_DIR, exist_ok=True)

    write_csv(rows, os.path.join(DEMO_DIR, FACILITY_FILE))
    update_grid_cache(os.path.join(CACHE_DIR, "grid_ci_fallback.json"), ci, climate)
    update_weather_cache(os.path.join(CACHE_DIR, "weather_fallback.json"), climate)
    write_demand_cache(os.path.join(CACHE_DIR, "demand_profiles.json"), demand)
    update_demo_manifest(os.path.join(DEMO_DIR, "MANIFEST.json"), len(rows), start, args.days, ci)
    write_derived_manifest(
        os.path.join(args.raw, "DERIVED_MANIFEST.json"), ci, climate, demand, len(rows), start, args.days
    )

    print("\n[ok] wrote:")
    for rel in (
        "data/demo/" + FACILITY_FILE,
        "data/demo/MANIFEST.json",
        "data/cache/grid_ci_fallback.json",
        "data/cache/weather_fallback.json",
        "data/cache/demand_profiles.json",
        "data/raw/DERIVED_MANIFEST.json",
    ):
        print(f"     {rel}")


if __name__ == "__main__":
    sys.exit(main())
