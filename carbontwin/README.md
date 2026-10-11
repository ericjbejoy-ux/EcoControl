# CarbonTwin — Data Ingestion (Member 2)

Standalone, offline-first data-ingestion layer: CSV/Parquet import, schema detection,
cleaning, data-quality scoring, dynamic Scope 2 emissions, grid-intensity & weather
connectors (Live → Cached → Synthetic), and a replay engine.

> **Always run commands from THIS folder** (`...\EcoControl\carbontwin`). There is no
> `package.json` in the parent folders, so npm will fail there.

## Quick start (PowerShell)

Open **Windows Terminal / PowerShell** and run these one line at a time.

```powershell
cd "C:\Users\nicol\OneDrive\Desktop\Schneider\EcoControl\carbontwin"
npm install
npm start
```

The first start takes ~10–20 s while it seeds the 5 demo facilities (every boot
re-runs the seed **idempotently** — it skips facilities that already exist and
adds any that are missing, so upgrading the code self-heals an existing
`data/.store`). Wait for `Ingestion API listening`, then test from a **second**
PowerShell window:

```powershell
curl.exe http://localhost:4000/health
curl.exe http://localhost:4000/api/v1/facilities
curl.exe "http://localhost:4000/api/v1/carbon/intensity?region=IN-MH"
```

Stop the server with **Ctrl + C**. For auto-reload during development use `npm run dev`.

## Tests

```powershell
npm test
npm run test:coverage
```

## What works

- 147 tests pass across 11 suites; coverage above the configured thresholds.
- Live boot seeds 5 facilities: Office Tower A, City General Hospital, Tech Campus West, HyperScale DC-1, and **Chennai IT Park**.
- Chennai IT Park is real-data-backed: Open-Meteo 2024 Tamil Nadu weather + CEA demand-shaped load, on the derived `IN-TN` grid intensity (≈635 gCO₂/kWh).
- Endpoints: `/health`, `/api/v1/facilities`, `/:id/timeseries`, `/:id/quality`,
  `/:id/emissions`, `/:id/stats`, `/:id/replay`, `/api/v1/carbon/intensity`, `/api/v1/weather`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness + facility count |
| GET | `/api/v1/facilities` | List facilities |
| GET | `/api/v1/facilities/demo` | Curated demo catalogue |
| POST | `/api/v1/facilities` | Create facility (JSON) |
| POST | `/api/v1/facilities/upload` | Upload CSV/Parquet (multipart) |
| POST | `/api/v1/facilities/seed` | (Re)seed demo facilities |
| GET | `/api/v1/facilities/:id` | Facility detail |
| GET | `/api/v1/facilities/:id/timeseries` | 15-min series (downsampled) |
| GET | `/api/v1/facilities/:id/stats` | Summary stats |
| GET | `/api/v1/facilities/:id/quality` | Data-quality report |
| GET | `/api/v1/facilities/:id/emissions` | Dynamic vs static emissions |
| POST | `/api/v1/facilities/:id/replay` | Control replay |
| GET | `/api/v1/facilities/replay/status` | Replay status |
| GET | `/api/v1/carbon/intensity` | Grid carbon intensity |
| GET | `/api/v1/weather` | Weather by location |
| GET | `/api/v1/ingestion/health` | Ingestion subsystem health |

## Environment variables

`PORT`, `HOST`, `LOG_LEVEL`, `DEFAULT_REGION`,
`ELECTRICITY_MAPS_TOKEN`, `CO2SIGNAL_TOKEN`, `OPENWEATHER_KEY`,
`USE_FALLBACK_DATA`, `INGESTION_PERSISTENCE` (`memory`|`file`),
`ENABLE_SCHEDULER`, `SEED_ON_START`.

No keys are required: without tokens the connectors serve the committed offline
fallback pack and label responses `dataSource: "synthetic"`.

## Data scripts (optional)

```powershell
npm run data:build      # regenerate data/demo (30 days, deterministic)
npm run data:reference  # re-derive the real/government packs + Chennai demo from data/raw
npm run data:validate   # gate data/demo/*.csv (exits non-zero on ERROR)
```

See [`docs/data-sources.md`](docs/data-sources.md) for datasets, licences and provenance.
