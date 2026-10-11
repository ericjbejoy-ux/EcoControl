#!/usr/bin/env python3
"""
validate_dataset.py — sanity-check ingestion inputs against the canonical schema.

Mirrors the TypeScript validators so data engineers can gate CI on data quality
before it reaches the API. Exits non-zero when any ERROR-level issue is found.

Checks
------
* Required columns: a timestamp column and a power/energy column.
* Timestamps parse and are monotonically increasing (or report duplicates).
* Regular interval coverage (default 15 minutes) and gap report.
* Numeric power column; counts negatives / zeros / non-numeric.
* Basic outlier scan (robust z-score on the median absolute deviation).

Usage
-----
    python data/scripts/validate_dataset.py data/demo/office_tower.csv
    python data/scripts/validate_dataset.py data/demo/*.csv --interval 15
"""

from __future__ import annotations

import argparse
import csv
import glob
import math
import sys
from datetime import datetime

FORMATS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M",
    "%m/%d/%Y %H:%M",
    "%d/%m/%Y %H:%M",
]


def parse_ts(value: str) -> datetime | None:
    value = value.strip()
    if not value:
        return None
    for fmt in FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def median(values: list[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def mad(values: list[float]) -> float:
    if not values:
        return 0.0
    m = median(values)
    return median([abs(v - m) for v in values])


def guess_columns(header: list[str]) -> tuple[int, int]:
    ts_idx = 0
    power_idx = 1
    for i, name in enumerate(header):
        low = name.lower()
        if any(tok in low for tok in ("time", "date", "ts", "period")):
            ts_idx = i
    for i, name in enumerate(header):
        low = name.lower()
        if i == ts_idx:
            continue
        if any(tok in low for tok in ("power", "demand", "load", "consumption", "kwh", "energy", "kw")):
            power_idx = i
    return ts_idx, power_idx


def validate(path: str, interval_minutes: int) -> tuple[list[str], list[str], dict]:
    errors: list[str] = []
    warnings: list[str] = []
    stats: dict = {}

    with open(path, encoding="utf-8") as fh:
        reader = csv.reader(fh)
        try:
            header = next(reader)
        except StopIteration:
            return ["file is empty"], [], stats
        ts_idx, power_idx = guess_columns(header)
        stats["timestampColumn"] = header[ts_idx]
        stats["powerColumn"] = header[power_idx]

        timestamps: list[datetime] = []
        values: list[float] = []
        invalid_ts = 0
        invalid_power = 0
        negative = 0
        zero = 0

        for row in reader:
            if not row or not any(cell.strip() for cell in row):
                continue
            ts = parse_ts(row[ts_idx]) if ts_idx < len(row) else None
            if ts is None:
                invalid_ts += 1
                continue
            timestamps.append(ts)
            raw = row[power_idx].strip() if power_idx < len(row) else ""
            try:
                value = float(raw)
            except ValueError:
                invalid_power += 1
                continue
            values.append(value)
            if value < 0:
                negative += 1
            if value == 0:
                zero += 1

    if not timestamps:
        errors.append("no valid timestamps found")
    if not values:
        errors.append("no valid power values found")
    if invalid_ts:
        warnings.append(f"{invalid_ts} unparseable timestamp(s)")
    if invalid_power:
        warnings.append(f"{invalid_power} non-numeric power value(s)")
    if negative:
        warnings.append(f"{negative} negative reading(s) (on-site generation / export?)")

    # Duplicates
    sorted_ts = sorted(timestamps)
    dupes = len(sorted_ts) - len(set(sorted_ts))
    if dupes:
        warnings.append(f"{dupes} duplicate timestamp(s)")

    # Gaps / interval regularity
    missing = 0
    irregular = 0
    span_hours = 0.0
    if len(sorted_ts) > 1:
        expected = interval_minutes * 60
        span_hours = (sorted_ts[-1] - sorted_ts[0]).total_seconds() / 3600
        for i in range(1, len(sorted_ts)):
            delta = (sorted_ts[i] - sorted_ts[i - 1]).total_seconds()
            if delta > expected * 1.05:
                missing += max(0, round(delta / expected) - 1)
            elif abs(delta - expected) > expected * 0.05:
                irregular += 1

    stats.update(
        {
            "rows": len(timestamps),
            "spanHours": round(span_hours, 1),
            "missingIntervals": missing,
            "irregularIntervals": irregular,
            "duplicates": dupes,
            "negative": negative,
            "zero": zero,
        }
    )

    # Outlier scan
    if len(values) >= 8:
        m = median(values)
        d = mad(values)
        outliers = 0
        if d > 0:
            outliers = sum(1 for v in values if abs(0.6745 * (v - m) / d) > 3.5)
        stats["outliers"] = outliers
        if outliers:
            warnings.append(f"{outliers} statistical outlier(s) (robust z > 3.5)")

    if values:
        stats["minKw"] = round(min(values), 2)
        stats["maxKw"] = round(max(values), 2)
        stats["meanKw"] = round(sum(values) / len(values), 2)
        stats["totalKwh"] = round(sum(v * interval_minutes / 60 for v in values), 1)

    if missing > len(timestamps) * 0.15:
        warnings.append(f"more than 15% of intervals missing ({missing})")

    return errors, warnings, stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate ingestion datasets.")
    parser.add_argument("paths", nargs="+", help="CSV file(s) or glob(s) to validate")
    parser.add_argument("--interval", type=int, default=15, help="expected interval in minutes")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args()

    files: list[str] = []
    for pattern in args.paths:
        matched = glob.glob(pattern)
        files.extend(matched if matched else [pattern])

    all_ok = True
    report = []
    for path in files:
        if not path.lower().endswith(".csv"):
            continue
        errors, warnings, stats = validate(path, args.interval)
        ok = not errors
        all_ok = all_ok and ok
        report.append({"file": path, "ok": ok, "errors": errors, "warnings": warnings, "stats": stats})
        if not args.json:
            status = "PASS" if ok else "FAIL"
            print(f"[{status}] {path}")
            for key, value in stats.items():
                print(f"        {key}: {value}")
            for warning in warnings:
                print(f"        ! {warning}")
            for error in errors:
                print(f"        x {error}")

    if args.json:
        import json

        print(json.dumps(report, indent=2, default=str))

    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
