# `data/raw` — supplied real / government datasets

This folder holds the **real, openly-licensed** datasets that back the
reference packs and the `Chennai IT Park` demo facility. They are consumed by
[`data/scripts/build_reference_datasets.py`](../scripts/build_reference_datasets.py),
which derives everything the ingestion layer actually loads (see
[`../../docs/data-sources.md`](../../docs/data-sources.md) §5a).

Nothing here is redistributed under a proprietary licence; each file carries its
original licence below. Re-run `npm run data:reference` to regenerate the derived
outputs.

## Usable datasets

| File | Source | Licence | Grain | Used for |
|------|--------|---------|-------|----------|
| `india_global_electricity_mix.csv` | [Ember](https://ember-energy.org/) yearly electricity data | CC BY 4.0 | annual (1965–2025) | India grid carbon intensity (2024 mix → **634.6 gCO₂/kWh**) |
| `tamil_nadu_weather_solar_2024.csv` | Open-Meteo historical archive | CC BY 4.0 | hourly (2024) | Tamil Nadu climate params + the Chennai demo weather |
| `chennai_weather_2024.csv` | Open-Meteo historical archive | CC BY 4.0 | hourly (2024) | Cross-check for the Chennai centroid |
| `india_states_daily_energy_MU.csv` | Central Electricity Authority via [data.gov.in](https://data.gov.in/) | Government of India Open Data | daily, per state (2013-01-01 → 2024-04-28) | Tamil Nadu demand seasonality |
| `india_states_peak_demand_MW.csv` | Central Electricity Authority via data.gov.in | Government of India Open Data | daily, per state (2013-01-01 → 2024-04-28) | Tamil Nadu peak-demand reference |

`iex_electricity_demand_prices.csv` is a small (46-row) IEX extract whose first
column is not a parseable date/time index, so its column semantics are ambiguous.
It is retained for reference only and is **not** used in any derivation.

## Not usable (broken downloads)

Three files in the original drop could not be used and were **not** copied here:

| File | Why |
|------|-----|
| `bdg2_building_metadata.csv` | **Git-LFS pointer** (`version https://git-lfs.github.com/spec/v1`), not the real data — the LFS objects were never fetched. |
| `india_hourly_grid_demand_solar_wind.xlsx` | Actually a **404 JSON error response** (and it leaked a bearer token). Not a spreadsheet. Do not commit. |
| `CEA_User_Guide_v22.pdf` | Actually an **HTML login page** (`Central Electricity Authority - Login`), not a PDF. |

Re-download those from their canonical sources if real BDG2 / CEA hourly data is
needed later.

## Refinements applied

* Timestamps in the Open-Meteo files are **UTC** (`utc_offset_seconds=0`); the
  Chennai demo converts them to **IST (Asia/Kolkata, +05:30)** and emits naive
  local wall-clock timestamps, matching the other demo facilities.
* The Tamil Nadu weather file is preferred over the point-sample Chennai file for
  the demo because it also carries `global_tilted_irradiance`, needed for the
  rooftop-PV term.
* The India grid intensity is derived as a generation-mix weighted average of
  lifecycle emission factors (IPCC AR5 / Ember medians), not copied from a single
  headline number, so the provenance is auditable.
* The derived diurnal CI shape is the generic India duck curve deepened by the
  measured solar term (more irradiance ⇒ cleaner grid).

## Attribution

Ember (CC BY 4.0) and Open-Meteo (CC BY 4.0) require attribution when
redistributed; the CEA / data.gov.in tables are Government of India Open Data.
Attribution is retained in this file, in `data/cache/*.json`, and in
`docs/data-sources.md`.
