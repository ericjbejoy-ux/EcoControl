# Data Sources & Provenance (M2 — Data Ingestion)

> Owner: **Member 2 — Data Ingestion & Data Engineering**
> Scope: datasets, connectors, licences, provenance, the offline fallback pack, and
> the deterministic synthetic-data strategy. Traces directly to SRS §10/§11/§13.

CarbonTwin is **offline-first**: the demo and the automated test-suite must run with
no network access and no API keys, yet still behave as if live grid-intensity and
weather data were flowing. That requirement is what shapes every decision below.

---

## 1. What data the platform consumes

| # | Data | Grain | Used by | Source tier |
|---|------|-------|---------|-------------|
| 1 | Facility electricity load | 15 min | ingestion, emissions, replay | upload / demo CSV |
| 2 | Grid carbon intensity (gCO₂/kWh) | 15 min | dynamic Scope 2, forecast | Electricity Maps / CO₂ Signal / cached / synthetic |
| 3 | Weather (temp, humidity, irradiance) | 15 min | HVAC context, comfort band | Open-Meteo / OpenWeather / cached / synthetic |
| 4 | Time-of-use tariffs | hourly | cost/optimisation (M3/M5) | curated pack |

Two **mandatory, live external** feeds (2 and 3) share the same resilience contract:
**Live → Cached → Synthetic**, and every response reports which tier answered
(`dataSource: 'live' | 'cached' | 'synthetic'`). There is no code path that can
return "no data".

---

## 2. Facility load data (the demo archive)

Five committed facilities, each a month of 15-minute readings, live in
[`data/demo/`](../data/demo). They are described by
[`data/demo/MANIFEST.json`](../data/demo/MANIFEST.json), which the seeder reads at
boot. The stable UUIDs are also published by the shared package
(`DEMO_FACILITY_IDS`) so the UI, API and tests agree.

| Facility | `id` | Type | Region | Timezone | Rows | File |
|----------|------|------|--------|----------|------|------|
| Office Tower A | `11111111-1111-4111-8111-111111111111` | office | IN-MH | Asia/Kolkata | 2,871 | `office_tower.csv` |
| City General Hospital | `22222222-2222-4222-8222-222222222222` | hospital | GB-LND | Europe/London | 2,865 | `hospital.csv` |
| Tech Campus West | `33333333-3333-4333-8333-333333333333` | campus | US-CA | America/Los_Angeles | 2,860 | `campus.csv` |
| HyperScale DC-1 | `44444444-4444-4444-8444-444444444444` | data_center | DE-BE | Europe/Berlin | 2,874 | `data_center.csv` |
| Chennai IT Park | `55555555-5555-4555-8555-555555555555` | office | IN-TN | Asia/Kolkata | 2,865 | `chennai_it_park.csv` |

* Window: 30 days at 15-minute resolution (2,880 slots). Row counts are slightly
  below 2,880 by design — the generator injects realistic `missing_rate` gaps so the
  cleaning stage has something meaningful to impute (see §5).
* The first four are synthetic; **Chennai IT Park is real-data-backed** — its
  outdoor temperature / humidity / irradiance are the actual Open-Meteo 2024 Tamil
  Nadu archive and its load is calibrated to the CEA Tamil Nadu demand profile
  (§5a). Its window is 2024-03-30 → 2024-04-29.
* Timestamps are naive **local wall-clock** (`YYYY-MM-DD HH:MM`), i.e. exactly what a
  building BMS exports. The timezone column in the manifest reconstructs UTC
  correctly, including DST transitions (§5).
* Licence: **CC BY 4.0** (synthetic) / CC BY 4.0 + Govt. of India Open Data (Chennai).

CSV columns:

```csv
timestamp,Active Power (kW),Outdoor Temperature (C),Humidity (%),Solar Irradiance (W/m2)
```

---

## 3. Grid carbon intensity — live tier

| Provider | Endpoint used | Auth | Notes |
|----------|---------------|------|-------|
| **Electricity Maps** | `/v3/carbon-intensity/latest`, `/v3/carbon-intensity/history` | `ELECTRICITY_MAPS_TOKEN` | Preferred: per-zone, real-time + history. |
| **CO₂ Signal** | `/v1/latest` | `CO2SIGNAL_TOKEN` | Secondary provider; used if Electricity Maps is unavailable. |

* Client code: `apps/api/src/ingestion/connectors/electricityMaps.client.ts`,
  `.../co2signal.client.ts`.
* Called only when `USE_FALLBACK_DATA` is **not** `true` **and** a token is present
  **and** the requested window is "recent" (≤ 31 days; history older than that is
  served from cache/synthetic to avoid pointless network calls).
* Region → provider zone mapping and coordinates are centralised in
  `connectors/fallbackProvider.ts` (`coordsForRegion`).

**Provider licences:** Electricity Maps and CO₂ Signal are commercial APIs. Their
terms govern the *live* tier only; no provider data is redistributed in this
repository. Anything committed here is either synthetic or openly licensed.

---

## 4. Weather — live tier

| Provider | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| **Open-Meteo** | `/v1/forecast` (current + hourly) | none | Default. Free, no key. |
| **OpenWeather** | `/data/2.5/forecast` | `OPENWEATHER_KEY` | Optional fallback when a key is supplied. |

* Client code: `connectors/openMeteo.client.ts`, `connectors/openWeather.client.ts`.
* Window clamp: 14 days (finer forecast grids are only meaningful over that horizon).
* **Open-Meteo** data is licensed **CC BY 4.0** — attribution retained in
  [`data/cache/weather_fallback.json`](../data/cache/weather_fallback.json).

---

## 5. The offline fallback pack (committed)

Everything needed to run token-free lives in [`data/cache/`](../data/cache) and is
loaded once at boot via `loadFallbackPack(cacheDir)` in
`connectors/fallbackProvider.ts`.

| File | Contents | Role |
|------|----------|------|
| `grid_ci_fallback.json` | Per-region `annualAverageCi` (gCO₂/kWh) + 24-point diurnal shape | Seeds the synthetic CI model and `ANNUAL_AVERAGE_CI`. |
| `weather_fallback.json` | Per-region `lat/lon/timezone`, `baseC`, `seasonalAmpC`, `diurnalAmpC` | Seeds the synthetic weather model. |
| `demand_profiles.json` | Per-region monthly / weekday demand factors + peak-demand stats | Consumption modelling; derived from CEA state tables (§5a). |
| `tariffs.json` | Time-of-use prices, peak/shoulder windows, demand charge | Informational for M2; consumed by M3/M5. |

Sources for these numbers: **Ember** annual electricity carbon intensities and
typical regional "duck-curve" diurnal shapes (grid CI), **Open-Meteo climate
normals 2000–2020** per city centroid (weather), and published retail tariff
schedules (tariffs). If a file is missing, the provider falls back to the compiled-in
defaults — boot never fails.

---

## 5a. Real & government reference datasets (`data/raw`)

A drop of openly-licensed real datasets was integrated into the packs above and
into one demo facility. The raw files are committed under
[`data/raw/`](../data/raw) (see its `README.md` for the full provenance table,
including the three broken downloads that were deliberately **not** copied).

| Raw dataset | Source / licence | What the script derives |
|-------------|------------------|-------------------------|
| `india_global_electricity_mix.csv` | Ember — CC BY 4.0 | India 2024 generation-mix weighted **grid CI = 634.6 gCO₂/kWh** (lifecycle factors, IPCC AR5/Ember medians) → `IN-TN` in `grid_ci_fallback.json`. |
| `tamil_nadu_weather_solar_2024.csv` | Open-Meteo — CC BY 4.0 | Measured `IN-TN` climate (`baseC 28.43`, `seasonalAmpC 3.77`, `diurnalAmpC 4.96`) → `weather_fallback.json`; also the Chennai demo weather. |
| `india_states_daily_energy_MU.csv`, `india_states_peak_demand_MW.csv` | CEA / data.gov.in — Govt. of India Open Data | Tamil Nadu monthly/weekday demand factors + peak-demand stats → `demand_profiles.json`; calibrates the Chennai demo load. |

Everything is produced deterministically by
[`data/scripts/build_reference_datasets.py`](../data/scripts/build_reference_datasets.py):

```powershell
npm run data:reference    # re-derive the packs + the Chennai demo CSV
```

It writes `data/cache/{grid_ci_fallback,weather_fallback,demand_profiles}.json`, the
`data/demo/chennai_it_park.csv` facility, a `MANIFEST.json` entry, and an auditable
`data/raw/DERIVED_MANIFEST.json` recording every input and derived number.

Refinements applied while integrating: Open-Meteo timestamps are UTC and are
converted to **IST** for the demo; timestamps/values are de-duplicated to the
canonical 15-minute local grid; the Tamil Nadu file is preferred over the sparse
Chennai point sample because it carries `global_tilted_irradiance`; the intensity is
recomputed from the generation mix rather than copied, so provenance is auditable.

---

## 6. Synthetic data — why, and how

### Why synthetic at all?

1. **Determinism.** Demos and tests must be reproducible byte-for-byte. Real meter
   data is not.
2. **Licensing safety.** Many public smart-meter sets have unclear or
   non-redistributable terms. We never commit those.
3. **Physical plausibility.** A flat random walk makes weak demos and cannot
   exercise the cleaning/quality stages. The generator produces archetype-specific,
   physically shaped load curves instead.

### Contracts the generator honours

* **Interval:** strict 15 minutes (96 steps/day).
* **Deterministic:** a fixed seed per archetype (`office=101`, `hospital=202`,
  `campus=303`, `data_center=404`). Same seed ⇒ identical file.
* **Physically shaped:** occupancy sigmoid ramps, cooling-degree-driven HVAC,
  optional rooftop PV offset, and archetype night-floors (hospitals/DC run 24/7).
* **Realistically messy:** injected missing samples, sensor outliers and small
  noise, so the importer's gap-filling and outlier stages are genuinely exercised.
* **DST-aware:** naive local timestamps are emitted so the ingestion timezone
  validator can resolve them (e.g. London's March/October transitions).

### Real-data upgrade path

`data/scripts/download_data.py` fetches openly licensed alternatives and records a
provenance manifest **without committing them**. `build_demo_datasets.py --prefer-real`
will slice a real, permissively licensed source from `data/raw/` if present and fall
back to synthetic otherwise. So swapping in real data later is a data-only change.

---

## 7. Scripts

All under [`data/scripts/`](../data/scripts). Python 3.11+; standard library only.

| Script | Purpose |
|--------|---------|
| `generate_synthetic.py` | Deterministic 15-min profiles for the four archetypes. `--days`, `--facility`, `--out`. |
| `build_demo_datasets.py` | Assemble `data/demo/*.csv` + `MANIFEST.json`. `--days`, `--prefer-real`. |
| `build_reference_datasets.py` | Derive the real reference packs + the Chennai demo from `data/raw`. `--year`, `--window-start`, `--days`, `--dry-run`. |
| `validate_dataset.py` | Schema/gap/outlier sanity gate for any CSV (mirrors the TS validators). Exits non-zero on ERROR. |
| `download_data.py` | Fetch openly licensed reference datasets into `data/raw/` with a provenance manifest. |

```powershell
# Regenerate the committed demo archive (deterministic)
python data/scripts/build_demo_datasets.py --days 30

# Re-derive the real/government reference packs + Chennai demo
python data/scripts/build_reference_datasets.py

# Validate it (CI gate)
python data/scripts/validate_dataset.py data/demo/*.csv --interval 15
```

---

## 8. Open datasets referenced (for swapping in real data)

| Dataset | Licence | Use |
|---------|---------|-----|
| Building Data Genome Project 2 (BDG2) | CC BY 4.0 | Real building meter profiles |
| Ember yearly electricity data | CC BY 4.0 | Annual grid carbon intensities — **used** for India (§5a) |
| Open-Meteo historical weather | CC BY 4.0 | Weather normals / history — **used** for Tamil Nadu (§5a) |
| CEA daily state energy & peak demand (data.gov.in) | Govt. of India Open Data | Tamil Nadu demand shape — **used** (§5a) |
| IEX electricity demand/prices | Open exchange data | Candidate demand series (sample ambiguous — not used) |
| Electricity Maps (free tier) | Commercial ToS | Live grid CI |

Attribution: when redistributing anything derived from the CC BY 4.0 sources above,
retain this file and the source links.

---

## 9. Compliance summary (SRS traceability)

| Requirement | How this document / code satisfies it |
|-------------|----------------------------------------|
| FR-2 seeded demo facilities | `data/demo/*` + `MANIFEST.json` + `DEMO_FACILITY_IDS`. |
| FR-3 grid carbon intensity | Live → cached → synthetic ladder (§3, §5). |
| FR-4 weather | Live → cached → synthetic ladder (§4, §5). |
| FR-5 data quality | Messy synthetic inputs exercise gap/outlier handling (§6). |
| NFR-2 offline resilience | Committed fallback pack; no-key Open-Meteo default (§5, §6). |
| §13 data strategy | Deterministic generator, licence-safe, real-data upgrade path (§6, §7). |
