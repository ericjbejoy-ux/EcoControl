#!/usr/bin/env python3
"""
build_demo_datasets.py — assemble the four committed demo facilities (FR-2).

Strategy (documented in docs/data-sources.md):
  1. If a real, permissively-licensed source exists in data/raw, slice it.
  2. Otherwise fall back to the deterministic synthetic generator, so the demo
     always works offline and is reproducible.

Every output CSV is validated with validate_dataset.py semantics and stamped in
data/demo/MANIFEST.json with its provenance + licence.

Usage
-----
    python data/scripts/build_demo_datasets.py
    python data/scripts/build_demo_datasets.py --days 30 --prefer-real
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

sys.path.insert(0, HERE)

from generate_synthetic import PROFILES, generate_dataset  # noqa: E402

DEMO_FILES = {
    "office": "office_tower.csv",
    "hospital": "hospital.csv",
    "campus": "campus.csv",
    "data_center": "data_center.csv",
}

FACILITY_META = {
    "office": {
        "id": "11111111-1111-4111-8111-111111111111",
        "name": "Office Tower A",
        "region": "IN-MH",
        "timezone": "Asia/Kolkata",
        "lat": 19.076,
        "lon": 72.8777,
        "type": "office",
    },
    "hospital": {
        "id": "22222222-2222-4222-8222-222222222222",
        "name": "City General Hospital",
        "region": "GB-LND",
        "timezone": "Europe/London",
        "lat": 51.5074,
        "lon": -0.1278,
        "type": "hospital",
    },
    "campus": {
        "id": "33333333-3333-4333-8333-333333333333",
        "name": "Tech Campus West",
        "region": "US-CA",
        "timezone": "America/Los_Angeles",
        "lat": 37.7749,
        "lon": -122.4194,
        "type": "campus",
    },
    "data_center": {
        "id": "44444444-4444-4444-8444-444444444444",
        "name": "HyperScale DC-1",
        "region": "DE-BE",
        "timezone": "Europe/Berlin",
        "lat": 52.52,
        "lon": 13.405,
        "type": "data_center",
    },
}


def write_csv(rows: list[dict], path: str) -> None:
    fieldnames = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Assemble the demo facility datasets.")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--out", default=os.path.join(ROOT, "data", "demo"))
    parser.add_argument("--raw", default=os.path.join(ROOT, "data", "raw"))
    parser.add_argument(
        "--prefer-real",
        action="store_true",
        help="use a matching dataset from data/raw if present (falls back to synthetic)",
    )
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    from datetime import timedelta

    start = today - timedelta(days=args.days)

    manifest = {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "start": start.isoformat(),
        "days": args.days,
        "facilities": [],
        "notes": (
            "Synthetic datasets are produced by data/scripts/generate_synthetic.py when no "
            "permissively-licensed real data is present. See docs/data-sources.md."
        ),
    }

    for key, profile in PROFILES.items():
        meta = FACILITY_META[key]
        latitude = meta["lat"]

        real_path = os.path.join(args.raw, DEMO_FILES[key])
        used_real = args.prefer_real and os.path.exists(real_path)
        if used_real:
            # A real file must already be in the canonical schema; copy verbatim.
            with open(real_path, encoding="utf-8") as fh:
                rows = list(csv.DictReader(fh))
            source = "real"
        else:
            rows = generate_dataset(profile, args.days, start, latitude)
            source = "synthetic"

        out_path = os.path.join(args.out, DEMO_FILES[key])
        write_csv(rows, out_path)

        manifest["facilities"].append(
            {
                "id": meta["id"],
                "key": key,
                "name": meta["name"],
                "type": meta["type"],
                "region": meta["region"],
                "timezone": meta["timezone"],
                "lat": meta["lat"],
                "lon": meta["lon"],
                "file": DEMO_FILES[key],
                "rows": len(rows),
                "source": source,
                "licence": "CC BY 4.0" if source == "synthetic" else "see docs/data-sources.md",
            }
        )
        print(f"[ok] {key:<12} -> {out_path}  rows={len(rows)}  source={source}")

    manifest_path = os.path.join(args.out, "MANIFEST.json")
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"[ok] manifest: {manifest_path}")


if __name__ == "__main__":
    main()
