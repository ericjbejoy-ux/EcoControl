# CarbonTwin — test datasets (demo)

Upload any of these from the landing page (hero **Upload CSV**, or the dropzone).
Everything is detected automatically — see the Data-quality report.

| File | State | Rows | Tests |
|---|---|---|---|
| pune_office_test.csv | Maharashtra | 96 | full format incl. grid-CI (gCO2/kWh) + carbon (kgCO2) |
| test_mumbai_office_full.csv | Maharashtra | 96 | same full format, office shape |
| test_delhi_hospital.csv | Delhi | 96 | **CI in kgCO2/kWh**, carbon in kgCO2, hospital baseload |
| test_bengaluru_campus_nocarbon.csv | Karnataka | 96 | **no CI/carbon** → falls back to state reference (480) |
| test_hyderabad_datacenter_watts.csv | Telangana | 96 | **power in W**, **carbon in tCO2**, data-centre flat load |
| test_chennai_3day.csv | Tamil Nadu | 288 | **multi-day** file (3 days), no CI/carbon |
| test_kerala_missing.csv | Kerala | 96 | **blank power cells** → missing-% reporting |
| test_gujarat_industrial_mw.csv | Gujarat | 96 | **power in MW**, carbon in kgCO2, industrial shifts |

## Format

Required: `timestamp` (anything with HH:MM) and `power/load`.
Optional, auto-detected: temperature, humidity, solar, grid carbon intensity,
carbon/emissions, state, facility. Units are normalised automatically
(W/kW/MW, g/kg/t CO2, Wh/kWh/MWh).
