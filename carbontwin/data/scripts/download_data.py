#!/usr/bin/env python3
"""
download_data.py — fetch open smart-meter / carbon-intensity datasets (SRS §13).

Datasets
--------
* Building Data Genome Project 2 (BDG2, CC BY 4.0) — https://github.com/buds-lab/building-data-genome-project-2
* Electricity Maps free tier — https://www.electricitymaps.com/ (needs ELECTRICITY_MAPS_TOKEN)
* Ember yearly electricity data — https://ember-climate.org/data/ (CC BY 4.0)
* Open-Meteo historical weather — https://open-meteo.com/ (no key)

The script is careful with licences: it records provenance in a manifest next to
the downloaded files. It never commits third-party data automatically — that is
`build_demo_datasets.py`'s job, and only for permissively licensed sources.

Usage
-----
    python data/scripts/download_data.py --list
    python data/scripts/download_data.py --dataset bdg2 --out data/raw
    python data/scripts/download_data.py --dataset open-meteo --region IN-MH --days 30
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timedelta

USER_AGENT = "CarbonTwin-Ingestion/0.1 (+https://github.com/carbontwin)"

REGION_CENTROIDS = {
    "IN-MH": (19.076, 72.8777, "Asia/Kolkata"),
    "IN-DL": (28.6139, 77.209, "Asia/Kolkata"),
    "IN-KA": (12.9716, 77.5946, "Asia/Kolkata"),
    "US-CA": (37.7749, -122.4194, "America/Los_Angeles"),
    "US-TX": (29.7604, -95.3698, "America/Chicago"),
    "GB-LND": (51.5074, -0.1278, "Europe/London"),
    "DE-BE": (52.52, 13.405, "Europe/Berlin"),
}

DATASETS = {
    "bdg2": {
        "name": "Building Data Genome Project 2",
        "licence": "CC BY 4.0",
        "url": "https://github.com/buds-lab/building-data-genome-project-2",
        "note": "Hourly electricity/water/steam for 1,636 buildings. Large; clone the repo or use the Zenodo mirror.",
    },
    "electricity-maps": {
        "name": "Electricity Maps API",
        "licence": "Commercial / free tier",
        "url": "https://portal.electricitymaps.com/",
        "note": "Requires ELECTRICITY_MAPS_TOKEN. Do not redistribute the raw API responses.",
    },
    "ember": {
        "name": "Ember yearly electricity data",
        "licence": "CC BY 4.0",
        "url": "https://ember-climate.org/data/data-tools/data-explorer/",
        "note": "Annual country/region carbon-intensity factors — used for FR-9 static comparison.",
    },
    "open-meteo": {
        "name": "Open-Meteo historical weather",
        "licence": "CC BY 4.0",
        "url": "https://archive-api.open-meteo.com/v1/archive",
        "note": "No API key required.",
    },
    "co2signal": {
        "name": "CO2 Signal / Electricity Maps",
        "licence": "Commercial / free tier",
        "url": "https://www.co2signal.com/",
        "note": "Requires a token. Do not redistribute raw responses.",
    },
}


def _get(url: str, headers: dict[str, str] | None = None, timeout: int = 30) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        return response.read()


def download_open_meteo(region: str, days: int, out_dir: str) -> str:
    if region not in REGION_CENTROIDS:
        raise SystemExit(f"Unknown region {region}. Choose from: {', '.join(REGION_CENTROIDS)}")
    lat, lon, _tz = REGION_CENTROIDS[region]
    end = datetime.utcnow().date()
    start = end - timedelta(days=days)

    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat}&longitude={lon}"
        f"&start_date={start.isoformat()}&end_date={end.isoformat()}"
        "&hourly=temperature_2m,relative_humidity_2m,shortwave_radiation,wind_speed_10m,cloud_cover"
        "&timezone=UTC&wind_speed_unit=ms"
    )
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"open-meteo_{region}_{start}_{end}.json")
    print(f"[..] Open-Meteo {region}: {url}")
    try:
        payload = _get(url)
    except urllib.error.URLError as err:
        raise SystemExit(f"Open-Meteo download failed: {err}") from err
    with open(path, "wb") as fh:
        fh.write(payload)
    print(f"[ok] wrote {path} ({len(payload) / 1024:.1f} kB)")
    return path


def write_manifest(out_dir: str, entries: list[dict]) -> None:
    os.makedirs(out_dir, exist_ok=True)
    manifest_path = os.path.join(out_dir, "MANIFEST.json")
    existing: list[dict] = []
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, encoding="utf-8") as fh:
                existing = json.load(fh).get("datasets", [])
        except (json.JSONDecodeError, OSError):
            existing = []
    merged = {e["id"]: e for e in existing}
    for entry in entries:
        merged[entry["id"]] = entry
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(
            {"updatedAt": datetime.utcnow().isoformat() + "Z", "datasets": list(merged.values())},
            fh,
            indent=2,
        )
    print(f"[ok] manifest updated: {manifest_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download open datasets for the CarbonTwin ingestion layer.")
    parser.add_argument("--list", action="store_true", help="list available datasets and exit")
    parser.add_argument("--dataset", choices=sorted(DATASETS.keys()), help="dataset to download")
    parser.add_argument("--region", default="IN-MH", help="region code (for weather)")
    parser.add_argument("--days", type=int, default=30, help="number of days")
    parser.add_argument("--out", default="data/raw", help="output directory")
    args = parser.parse_args()

    if args.list or not args.dataset:
        print("Available datasets:\n")
        for key, meta in DATASETS.items():
            print(f"  {key:<16} {meta['name']}")
            print(f"  {'':<16} licence: {meta['licence']}")
            print(f"  {'':<16} {meta['url']}")
            print(f"  {'':<16} {meta['note']}\n")
        return

    os.makedirs(args.out, exist_ok=True)

    if args.dataset == "open-meteo":
        path = download_open_meteo(args.region, args.days, args.out)
        write_manifest(
            args.out,
            [
                {
                    "id": f"open-meteo-{args.region}-{datetime.utcnow().date()}",
                    "name": DATASETS["open-meteo"]["name"],
                    "licence": DATASETS["open-meteo"]["licence"],
                    "url": DATASETS["open-meteo"]["url"],
                    "path": path,
                    "downloadedAt": datetime.utcnow().isoformat() + "Z",
                }
            ],
        )
        return

    if args.dataset in ("electricity-maps", "co2signal"):
        token = os.environ.get("ELECTRICITY_MAPS_TOKEN") if args.dataset == "electricity-maps" else os.environ.get("CO2SIGNAL_TOKEN")
        if not token:
            raise SystemExit(
                f"{args.dataset} requires a token environment variable. "
                "Set it or run with USE_FALLBACK_DATA=true instead."
            )
        print(
            f"[!] {args.dataset} data is licensed for runtime use only — the script will NOT save it to disk.\n"
            "    Use the running API (GET /api/v1/carbon/intensity) and its cache instead."
        )
        return

    meta = DATASETS[args.dataset]
    print(
        f"[i] {meta['name']} ({meta['licence']})\n"
        f"    {meta['url']}\n"
        f"    {meta['note']}\n"
        "    This dataset is large and/or licensed; download it manually into "
        f"{args.out} and re-run build_demo_datasets.py."
    )
    write_manifest(
        args.out,
        [
            {
                "id": args.dataset,
                "name": meta["name"],
                "licence": meta["licence"],
                "url": meta["url"],
                "path": None,
                "note": "manual download required",
                "recordedAt": datetime.utcnow().isoformat() + "Z",
            }
        ],
    )


if __name__ == "__main__":
    main()
