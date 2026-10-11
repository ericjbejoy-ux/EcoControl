# CarbonTwin Mock API

The Fastify gateway listens on port `4000` and exposes JSON routes under `/api/v1`. Every response labels mock-backed data with `source: "mock"` where applicable. No external keys or services are required.

## Run and validate

```sh
npm install
npm run dev
npm test
npm run typecheck
```

Or run the API in its Docker container:

```sh
docker compose up --build
```

The WebSocket hub and event contracts are defined but are not connected to a network endpoint yet.

## Routes

| Method | Path | Request | Response notes |
|---|---|---|---|
| GET | `/api/v1/health` | — | `status`, ISO `timestamp`, dependency/service states |
| GET | `/api/v1/facilities` | — | Demo facilities with `id`, `name`, `region`, and `type` |
| GET | `/api/v1/facilities/:id/timeseries` | Optional `from`, `to` ISO timestamps; `res=15m\|1h` | Power/emissions points in `[from, to)`; defaults to 24 hours of 15-minute data (96 points) |
| GET | `/api/v1/carbon/intensity?region=US-CAL-CISO` | `region` required | Current `ci`, 96-value `forecast24h`, `source` |
| GET | `/api/v1/weather?lat=37.77&lon=-122.42` | `lat`, `lon` required | Current conditions and 24 hourly forecast records |
| GET | `/api/v1/facilities/:id/forecast` | — | 96 power forecasts, uncertainty bounds, confidence |
| GET | `/api/v1/facilities/:id/explain?ts=2026-10-07T12:00:00Z` | Optional ISO `ts` | Ranked feature contributions |
| POST | `/api/v1/twin/simulate` | `{ "facilityId": "office-tower-01", "setpoint": 23 }` | 96 temperatures and comfort violation count |
| POST | `/api/v1/scenarios/run` | `{ "facilityId": "office-tower-01", "levers": [] }` | Annualized KPIs and 96-value baseline/scenario series |
| GET | `/api/v1/scenarios/macc` | — | Marginal abatement levers and economics |
| POST | `/api/v1/optimize/schedule` | `{ "facilityId": "office-tower-01" }` | 96 HVAC setpoints and estimated savings |
| POST | `/api/v1/reports/esg` | `{ "facilityId": "office-tower-01", "period": "year" }` | Mock report ID, download URL, and ready status |
| GET | `/api/v1/impact/equivalents?tco2e=25` | `tco2e` required | Tree, vehicle-distance, and home equivalents |
| POST | `/api/v1/copilot/ask` | `{ "question": "How can I lower emissions?" }` | Mock answer and source records |

POST requests use JSON. Invalid input returns HTTP 400 with `{ "error": "Validation failed", "details": [...] }`; unknown facility IDs return HTTP 404. A successful mock workflow should respond well below the 100 ms target in local development.

## Units and alignment

- `powerKw`: kW; mock facilities vary within 50–300 kW.
- `ci`: gCO₂e/kWh; synthetic values are bounded from 200–800.
- `emissionsKg`: kW × 0.25 h × gCO₂e/kWh ÷ 1000.
- Temperature values are °C and generated in the 15–35 °C physical bounds.
- 96-point time series have quarter-hour spacing (24 hours); weather is hourly.
- Timeseries query `from` is inclusive and `to` exclusive; omitted bounds use the 24 hours starting at the current aligned interval. Supported resolutions are `15m` and `1h`; ranges may not exceed seven days.

## WebSocket contract (not connected)

`packages/shared/src/ws.events.ts` validates `tick`, `anomaly`, and `schedule:update` payloads. `apps/api/src/ws/hub.ts` supplies an in-process pub/sub hub, ready to attach to a WebSocket transport later.
