# Software Requirements Specification (SRS)

## CarbonTwin — AI-Powered Software Digital Twin & Net Zero Command Center
**Schneider Electric Co-Creation Challenge · Top-30 Round Build**
**Version:** 2.0 (React + Node.js + FastAPI rebuild) · **Team size:** 4

> *"Decarbonize any building without installing a single sensor."*
> (Working name: **CarbonTwin**. Rename freely; search/replace across the repo.)

---

## Table of Contents
1. Introduction
2. Overall Description
3. System Architecture
4. Functional Requirements
5. AI / ML / Digital Twin Specification
6. API Specification
7. Frontend UX Specification & Prototype Walkthrough
8. Non-Functional Requirements
9. Tech Stack (Final)
10. Repository Structure (Folders & Files)
11. Work Distribution (4 Members)
12. Timeline & Milestones
13. Data Strategy
14. Testing & Quality
15. Deployment
16. Risks & Mitigations
17. Demo Script & Judging Strategy
18. Acceptance Criteria

---

## 1. Introduction

### 1.1 Purpose
This document specifies the requirements, architecture, folder structure, and team work split for building a production-grade, visually striking web platform for the upcoming rounds of the Schneider Electric Co-Creation Challenge.

### 1.2 Problem Statement
Organizations pursuing sustainability compliance cannot install IoT hardware across all facilities immediately due to capital cost and retrofit approvals. Commercial facilities rely on static utility data, annual-average emission factors, and have **no scenario-planning tools** to test operational changes before implementing them.

### 1.3 Solution Summary
A **100% software, hardware-free** platform that:
1. Ingests 15-minute smart meter logs (CSV/Parquet) + live Weather and Grid Carbon Intensity APIs.
2. Computes **dynamic Scope 2 emissions** in near real time (kWh × live gCO₂/kWh).
3. Runs a **physics-informed RC thermal Digital Twin** to simulate indoor temperature under HVAC throttling, without sensors.
4. Forecasts 24h energy/emissions with **LightGBM** and explains spikes with **SHAP (XAI)**.
5. Lets managers run **What-If scenarios** (peak shaving, load shifting, solar, setpoint changes) with instant **ROI + abatement cost ($/tCO₂e)**.
6. Produces an **optimized carbon-aware HVAC schedule** and an **audit-ready ESG PDF**.

### 1.4 Scope
**In scope:** web app, API gateway, ML/Twin microservice, data ingestion, simulation, optimization, reporting, demo dataset.
**Out of scope:** physical IoT hardware, real BMS write-back (shown as a simulated "virtual control" roadmap only).

### 1.5 Definitions
| Term | Meaning |
|---|---|
| Digital Twin | Software model that mimics building thermal + energy behavior |
| RC Model | Resistor-Capacitor lumped thermal circuit |
| CI | Grid Carbon Intensity (gCO₂/kWh) |
| XAI / SHAP | Explainable AI / SHapley Additive exPlanations |
| MACC | Marginal Abatement Cost Curve |
| MPC | Model Predictive Control |
| tCO₂e | Tonnes of CO₂ equivalent |

---

## 2. Overall Description

### 2.1 User Personas
| Persona | Goal | Key Screens |
|---|---|---|
| **Facility Manager (Priya)** | Cut emissions without hurting comfort | Command Center, Simulator, Auto-Pilot |
| **Sustainability / ESG Officer (Arjun)** | Audit-ready reports, compliance | Reports, Portfolio |
| **CFO / Executive (Meera)** | ROI and cost of abatement | MACC, ROI cards |
| **Judge (evaluator)** | Understand impact in 3 minutes | Demo mode / Guided tour |

### 2.2 Assumptions & Dependencies
- Open smart meter datasets are available (see §13).
- Electricity Maps / CO2 Signal free tier available; **cached fallback is mandatory** so demo never fails.
- Docker available on dev machines.

---

## 3. System Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         REACT FRONTEND (Vite + TS)                         │
│  Command Center · 3D Twin · Simulator · Auto-Pilot · MACC · Reports · Tour │
└───────────────▲──────────────────────────────▲─────────────────────────────┘
                │ REST (JSON)                  │ WebSocket (live stream)
┌───────────────┴──────────────────────────────┴─────────────────────────────┐
│                     NODE.JS API GATEWAY (Express/Fastify + TS)             │
│  Auth · Upload · Ingestion · Carbon calc · Caching · Scenario orchestration │
│  WebSocket hub · PDF report engine (Puppeteer) · Rate-limit · Validation    │
└───────┬───────────────────┬──────────────────────────┬─────────────────────┘
        │                   │                          │
        ▼                   ▼                          ▼
┌───────────────┐   ┌────────────────────┐   ┌───────────────────────────────┐
│ PostgreSQL /  │   │ Redis (cache,      │   │ PYTHON FASTAPI ML SERVICE     │
│ TimescaleDB   │   │ pub/sub, jobs)     │   │ RC Twin (SciPy) · LightGBM    │
│ (time-series) │   │                    │   │ SHAP · Optimizer (MPC) · Anom.│
└───────────────┘   └────────────────────┘   └───────────────────────────────┘
        ▲
        │
┌───────┴──────────────────────────────────────┐
│ External: Electricity Maps/CO2 Signal, Open- │
│ Meteo/OpenWeather, Smart-meter CSV/Parquet   │
└──────────────────────────────────────────────┘
```

**Why this split?** Node.js owns I/O, real-time, and the product experience. Python owns scientific computing (SciPy, LightGBM, SHAP have no equal in Node). A clean HTTP contract between them lets the ML person and the backend person work in parallel.

---

## 4. Functional Requirements

Priority: **P0** = must demo, **P1** = should, **P2** = wow/stretch.

### 4.1 Data Ingestion
| ID | Requirement | Pri |
|---|---|---|
| FR-1 | Upload CSV/Parquet smart meter file via drag-and-drop with schema auto-detection and validation | P0 |
| FR-2 | Pre-loaded demo facilities (office tower, hospital, campus, data center) | P0 |
| FR-3 | Fetch live Grid Carbon Intensity by region; fallback to cached/historic profile on failure | P0 |
| FR-4 | Fetch weather (temp, humidity, irradiance, forecast) | P0 |
| FR-5 | Data quality report (missing intervals, outliers, auto-imputation) | P1 |
| FR-6 | Replay mode: stream historic data as if live (1 day = 60 s) for demos | P0 |

### 4.2 Carbon Intelligence
| ID | Requirement | Pri |
|---|---|---|
| FR-7 | Compute dynamic Scope 2: `E(t) = P(t) · Δt · CI(t)` per 15-min interval | P0 |
| FR-8 | Live "Carbon Clock": kg CO₂e emitted today, projected end-of-day, vs. baseline | P0 |
| FR-9 | Compare dynamic vs. annual-average factor to show the error of static accounting | P1 |
| FR-10 | Carbon heatmap (hour × day) | P1 |

### 4.3 Physics-Informed Digital Twin
| ID | Requirement | Pri |
|---|---|---|
| FR-11 | RC thermal model simulating indoor temperature given outdoor temp, solar, occupancy, HVAC state | P0 |
| FR-12 | Auto-calibration of R and C from historical energy + weather via SciPy `least_squares` | P1 |
| FR-13 | HVAC throttle slider (0–100%) with instant temperature drift curve and comfort-band violation flag | P0 |
| FR-14 | 3D building visualization colored by temperature and emissions in real time | P1 (wow) |
| FR-15 | Multi-zone support (2–5 zones) | P2 |

### 4.4 Predictive AI & Explainability
| ID | Requirement | Pri |
|---|---|---|
| FR-16 | 24h energy and emissions forecast (LightGBM) with 80% prediction interval | P0 |
| FR-17 | SHAP global importance + per-spike local explanation (waterfall) | P0 |
| FR-18 | Plain-English explanation: "Spike at 14:15 driven 41% by outdoor temp, 27% by grid CI" | P0 |
| FR-19 | Anomaly detection on consumption (flag wasteful operation e.g. weekend AHU running) | P1 |
| FR-20 | Model card (MAE, MAPE, R², training window) viewable in UI | P1 |

### 4.5 Scenario Simulator & Economics
| ID | Requirement | Pri |
|---|---|---|
| FR-21 | Scenario library: HVAC peak shaving, load shifting, rooftop solar, setpoint relaxation, LED/VFD retrofit, battery storage | P0 |
| FR-22 | Parameterized scenarios with sliders; run in < 2 s | P0 |
| FR-23 | Outputs: kWh saved, tCO₂e avoided, cost saved, CAPEX, payback, NPV, abatement cost ($/tCO₂e) | P0 |
| FR-24 | Side-by-side scenario comparison and stacking (combine 3 levers) | P0 |
| FR-25 | **MACC chart** (marginal abatement cost curve) ranking levers | P1 (wow) |
| FR-26 | Net Zero Roadmap: pathway to target year with milestone chart | P1 |

### 4.6 Optimization / Virtual Control
| ID | Requirement | Pri |
|---|---|---|
| FR-27 | **Carbon-Aware Auto-Pilot**: MPC produces 24h HVAC schedule minimizing `Σ CI(t)·P(t)` subject to comfort band | P0 |
| FR-28 | Before/After timeline with comfort band and CI overlay | P0 |
| FR-29 | Export schedule as CSV/JSON (BMS-ready format, simulated write-back) | P1 |
| FR-30 | Pre-cooling demonstration (e.g. cool at 4 AM when CI lowest) | P0 |

### 4.7 Reporting
| ID | Requirement | Pri |
|---|---|---|
| FR-31 | One-click audit-ready **ESG PDF**: summary, methodology, emissions, scenarios, assumptions, charts | P0 |
| FR-32 | Methodology appendix aligned with GHG Protocol Scope 2 (location-based dynamic) | P1 |
| FR-33 | Shareable read-only link of a scenario | P2 |

### 4.8 Experience & Wow Features
| ID | Requirement | Pri |
|---|---|---|
| FR-34 | **Guided Demo Mode**: auto-tour that walks judges through the product in 3 minutes | P0 |
| FR-35 | **Carbon Time Machine**: scrub any past day and replay emissions + twin state | P1 (wow) |
| FR-36 | **Portfolio map**: multiple facilities on a map with live emission rings | P1 |
| FR-37 | **Ask the Twin** copilot: natural-language questions answered from computed results (LLM with tool access to the API) | P2 (wow) |
| FR-38 | Impact equivalents: trees, car-km, homes powered | P1 |
| FR-39 | Dark/light theme, fully responsive, keyboard accessible | P1 |

---

## 5. AI / ML / Digital Twin Specification

### 5.1 RC Thermal Model (single zone)
```
C · dT_in/dt = (T_out − T_in)/R  +  Q_int  +  Q_solar  −  COP · P_hvac · u(t)
```
- `T_in` indoor temp (°C), `T_out` outdoor temp, `R` envelope thermal resistance, `C` thermal capacitance
- `Q_int` internal gains (occupancy, equipment), `Q_solar` solar gain from irradiance × window factor
- `u(t) ∈ [0,1]` HVAC throttle, `COP` coefficient of performance (temperature-dependent: `COP = a − b·(T_out − 24)`)
- Solved with `scipy.integrate.solve_ivp` (RK45) at 1-minute internal step, reported at 15-min resolution.
- Calibration: `scipy.optimize.least_squares` to fit `R, C, window_factor` from historical load + weather (power → implied cooling load proxy).
- Comfort band default: **22–26 °C** (configurable).

### 5.2 Dynamic Emissions
```
Emissions_kg(t) = Power_kW(t) · 0.25h · CI_g_per_kWh(t) / 1000
```

### 5.3 Forecasting (LightGBM)
- **Target:** kW at 15-min resolution, horizon 96 steps (24h).
- **Features:** hour, day-of-week, holiday flag, lag 1/4/96/672, rolling mean/std, temp, humidity, irradiance, forecast weather, CI (lag + forecast), occupancy proxy.
- **Uncertainty:** quantile LightGBM (q10, q50, q90) → prediction band.
- **Validation:** time-series split (no leakage), metrics MAE, RMSE, MAPE, R².
- **Target:** MAPE < 12% on held-out week (office/campus type).

### 5.4 Explainable AI
- `shap.TreeExplainer` → global bar/beeswarm + local waterfall for selected timestamp.
- Feature groups rolled up for readability: *Weather, Time-of-day, Grid carbon, Occupancy, Historical pattern*.
- NLG templater converts top-3 SHAP contributions to a human sentence (FR-18).

### 5.5 Carbon-Aware Optimizer (MPC)
Decision variables: `u_t ∈ [u_min, 1]` for t = 0..95.
```
minimize    Σ  CI_t · P_hvac_t(u_t)  +  λ · Σ (comfort_violation_t)²  +  μ · Σ |u_t − u_{t−1}|
subject to  T_in,t+1 = f_RC(T_in,t, u_t, weather_t)     (twin as constraint)
            T_min ≤ T_in,t ≤ T_max  (soft)
```
Solver: `scipy.optimize.minimize (SLSQP)` or linearized `scipy.optimize.linprog`; receding horizon replans every 15 min in the demo.

### 5.6 Scenario Engine
| Scenario | Method |
|---|---|
| Peak shaving | Cap HVAC/total load at X% of peak; twin checks comfort impact |
| Load shifting | Shift flexible load to low-CI windows (optimizer) |
| Rooftop solar | PV yield from irradiance × area × efficiency; net load recalculated |
| Setpoint relaxation | Twin re-simulated with +1/+2 °C setpoint |
| Retrofit (LED/VFD) | % load reduction on component share |
| Battery | Simple dispatch: charge at low CI, discharge at high CI |

### 5.7 Economics
```
Annual saving ($)       = ΔkWh · tariff  (+ demand-charge reduction)
Abatement cost ($/tCO₂e) = (Annualized CAPEX − Annual saving) / tCO₂e avoided
Payback (yrs)           = CAPEX / Annual saving
NPV                     = Σ saving_y/(1+r)^y − CAPEX
```
Negative abatement cost = "pays for itself" (highlight in green in MACC).

### 5.8 Anomaly Detection
Isolation Forest or residual-z-score on forecast error; flagged intervals shown as markers with "estimated wasted kgCO₂e".

---

## 6. API Specification

**Base URL:** `/api/v1`  ·  JSON  ·  WebSocket at `/ws`

### 6.1 Node Gateway
| Method | Endpoint | Description |
|---|---|---|
| POST | `/facilities/upload` | Upload CSV/Parquet, returns facility id + data quality report |
| GET | `/facilities` | List facilities (demo + uploaded) |
| GET | `/facilities/:id/timeseries?from&to&res` | Power + emissions series |
| GET | `/carbon/intensity?region` | Live CI + 24h forecast (cached) |
| GET | `/weather?lat&lon` | Weather + forecast (cached) |
| GET | `/facilities/:id/forecast` | 24h forecast + SHAP summary (proxies ML) |
| GET | `/facilities/:id/explain?ts` | Local SHAP for a timestamp |
| POST | `/twin/simulate` | `{facilityId, throttleProfile, setpoint, window}` → temp curve |
| POST | `/scenarios/run` | `{facilityId, levers:[{type, params}]}` → KPIs + series |
| GET | `/scenarios/macc?facilityId` | MACC dataset |
| POST | `/optimize/schedule` | Returns optimal 24h schedule + savings |
| POST | `/reports/esg` | Generates PDF, returns download URL |
| GET | `/impact/equivalents?tco2e` | Trees, km, homes |
| POST | `/copilot/ask` | Natural-language Q&A (P2) |
| GET | `/health` | Liveness + dependency status |

### 6.2 WebSocket Events
| Event | Payload |
|---|---|
| `tick` | `{ts, powerKw, ci, emissionsKg, tempIn, tempOut}` (replay or live) |
| `anomaly` | `{ts, severity, estWasteKg}` |
| `schedule:update` | New MPC plan |

### 6.3 ML Service (FastAPI, internal)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/ml/train` | Train/refresh model for facility |
| POST | `/ml/forecast` | 96-step forecast with quantiles |
| POST | `/ml/explain` | SHAP values for ts / global |
| POST | `/twin/calibrate` | Fit R, C |
| POST | `/twin/simulate` | RC simulation |
| POST | `/optimize` | MPC schedule |
| POST | `/scenario/evaluate` | Lever evaluation |
| POST | `/anomaly/detect` | Anomaly flags |
| GET | `/ml/model-card/:facilityId` | Metrics & metadata |

### 6.4 Sample: `/scenarios/run`
```json
{
  "facilityId": "office-tower-01",
  "levers": [
    { "type": "hvac_peak_shaving", "params": { "capPct": 85 } },
    { "type": "rooftop_solar", "params": { "kWp": 250 } },
    { "type": "load_shifting", "params": { "flexiblePct": 20 } }
  ]
}
```
```json
{
  "kpis": {
    "kwhSavedYear": 412300,
    "tco2eAvoidedYear": 186.4,
    "costSavedYear": 51200,
    "capex": 240000,
    "paybackYears": 4.7,
    "abatementCostPerTco2e": -38.2,
    "comfortViolationHours": 0
  },
  "series": { "baseline": [], "scenario": [], "tempIn": [] }
}
```

---

## 7. Frontend UX Specification & Prototype Walkthrough

### 7.1 Design Language
- **Theme:** "Mission Control": deep navy `#0B1220`, electric green `#3DCD58` (Schneider Electric green), cyan `#22D3EE` for twin/thermal, amber `#F59E0B` for warnings, glassmorphism cards, subtle grid background.
- **Typography:** Inter (UI), JetBrains Mono (numbers/telemetry).
- **Motion:** Framer Motion page transitions, animated count-up KPIs, pulsing live indicators, smooth chart morphing between scenarios.
- **Alignment with Schneider branding:** use green accents, "Life Is On" energy-management tone; do not use official logos without permission.

### 7.2 Screens

#### Screen 1 — Landing / Facility Select
Hero with animated grid-carbon "pulse" background. Cards for demo facilities + big **"Upload your smart meter data"** drop zone + **"Start Guided Demo"** button.

#### Screen 2 — Command Center (home)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ● LIVE   Facility: Office Tower A ▾   Region: IN-SO ▾   ☀/☾   [Demo Tour]    │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────────┤
│ CARBON CLOCK │ GRID CI NOW  │ POWER NOW    │ TODAY vs BASE│ NET ZERO PROGRESS│
│ 1,284 kgCO2e │ 612 g/kWh ▲  │ 842 kW       │ −14.2% ▼     │  ◔ 38% to 2040   │
├──────────────┴──────────────┴──────────────┴──────────────┴─────────────────┤
│  Power (kW) + Emissions overlay + CI band (live, streaming)                  │
│  ░░░▒▒▓▓▓█████▓▓▒▒░░░  ← forecast cone (p10–p90) extends to the right        │
├───────────────────────────────────────┬──────────────────────────────────────┤
│ 3D DIGITAL TWIN (rotatable)           │ WHY IS EMISSIONS HIGH? (SHAP)         │
│ Building colored by zone temperature  │ ▇▇▇▇▇ Outdoor temp   41%              │
│ Pulsing red floors = high emissions   │ ▇▇▇▇  Grid carbon    27%              │
│                                       │ ▇▇▇   Time of day    18%              │
├───────────────────────────────────────┴──────────────────────────────────────┤
│ Anomaly feed: ⚠ 02:15 AHU-3 running unoccupied · est. waste 18 kgCO2e       │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### Screen 3 — Twin Lab (Digital Twin)
Large 3D building, HVAC **throttle slider** and **outdoor temperature override**. Under it: indoor temperature curve with comfort band; when the user cuts HVAC during a high-CI window, the curve drifts and a badge shows `+1.4 °C in 30 min · saves 22 kgCO₂e · comfort OK ✅`.

#### Screen 4 — Scenario Simulator ("What-If Studio")
Left: lever cards (toggle + sliders). Right: live-updating charts, baseline vs scenario, KPI strip (tCO₂e avoided, $ saved, payback, abatement cost). **Stack levers** and watch the waterfall chart add up. "Compare" drawer for side-by-side.

#### Screen 5 — Carbon Auto-Pilot
One-click **Optimize**. Animated timeline shows original vs optimized HVAC schedule, CI curve behind it, and indoor temperature staying inside the comfort band. Story callout: *"Pre-cool at 04:00 when the grid is 38% cleaner → −19% emissions, zero comfort loss."* Export schedule button.

#### Screen 6 — MACC & Net Zero Roadmap
Interactive marginal abatement cost curve (bar width = tCO₂e avoided, height = $/tCO₂e). Hover for lever details. Below: roadmap line chart toward target year with milestone flags.

#### Screen 7 — Explainability Studio
Global SHAP, per-timestamp waterfall (click any chart point), model card, forecast accuracy chart (actual vs predicted).

#### Screen 8 — Portfolio Map
Map with facility bubbles (size = emissions, color = trend). Click to drill down. Shows *scale*: "This works for 1 building or 1,000."

#### Screen 9 — Reports
Preview of ESG report, "Generate PDF" with progress animation, history list.

#### Screen 10 — Ask the Twin (P2)
Chat dock: *"What if we shut AHU-2 from 2–3 PM tomorrow?"* → runs twin + shows chart inline.

### 7.3 Guided Demo Mode (3-minute judge tour)
1. Command Center (live stream starts) →
2. Click anomaly → SHAP explanation →
3. Twin Lab: cut HVAC, see drift →
4. Simulator: stack 3 levers →
5. Auto-Pilot: optimize →
6. MACC → 7. Generate PDF → 8. Portfolio zoom-out.
Each step has a spotlight overlay and a 1-line narration caption.

### 7.4 End-State Prototype: What Judges Will Experience
> They open the app and a building made of light sits in the middle of the screen, glowing from cool blue to hot orange, while the Carbon Clock ticks up. The manager drags one slider: HVAC drops for 30 minutes during a dirty-grid window. The building cools slightly less, the temperature curve drifts 1.4 °C but stays in the comfort band, and the tCO₂e saved number animates upward. One click on **Auto-Pilot**, and the system finds a pre-cooling schedule that cuts 19% of emissions. One more click and a branded, audit-ready ESG PDF downloads. **No hardware. No retrofits. Zero capex to start.**

---

## 8. Non-Functional Requirements
| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | Dashboard first paint < 2 s; scenario run < 2 s; forecast < 1.5 s (cached model) |
| NFR-2 | Reliability | All external APIs have cache + synthetic fallback; demo works offline |
| NFR-3 | Scalability | Stateless Node, ML service horizontally scalable; 100 facilities supported |
| NFR-4 | Security | JWT auth, input validation (zod), file-type/size limits (50 MB), CORS allowlist, secrets via `.env`, no PII |
| NFR-5 | Usability | WCAG AA contrast, keyboard nav, responsive from 1280 px to mobile |
| NFR-6 | Explainability | Every prediction accompanied by drivers and uncertainty |
| NFR-7 | Maintainability | TypeScript strict, ESLint/Prettier, Ruff/Black, ≥ 70% test coverage on core logic |
| NFR-8 | Observability | Structured logs (pino), `/health`, request timing |
| NFR-9 | Portability | `docker compose up` brings up the full stack |
| NFR-10 | Sustainability | Lightweight models; show the platform's own compute footprint (nice touch) |

---

## 9. Tech Stack (Final)

| Layer | Choice | Reason |
|---|---|---|
| Frontend | **React 18 + Vite + TypeScript** | Fast, modern, judges recognize it |
| UI | **Tailwind CSS + shadcn/ui + Framer Motion** | Premium look quickly |
| Charts | **Apache ECharts** (main), Recharts (simple) | Handles streaming, heatmaps, MACC, large series |
| 3D | **Three.js via @react-three/fiber + drei** | Interactive 3D twin |
| Maps | **MapLibre GL** (free) | Portfolio view |
| State/Data | **Zustand + TanStack Query** | Simple, robust |
| Gateway | **Node.js 20 + Fastify (or Express) + TypeScript** | Fast I/O, WebSocket-friendly |
| Realtime | **ws / Socket.IO** | Live ticks |
| Validation | **zod** | Shared schemas |
| DB | **PostgreSQL + TimescaleDB** (fallback SQLite for dev) | Time-series |
| Cache/Queue | **Redis** (optional: in-memory LRU for hackathon) | API caching |
| ML Service | **Python 3.11 + FastAPI + Uvicorn** | Scientific stack |
| ML/Science | **Pandas, NumPy, SciPy, LightGBM, SHAP, scikit-learn** | As submitted in round 1 |
| PDF | **Puppeteer** (HTML → PDF) | Beautiful branded reports |
| Copilot (P2) | **Claude API** with tool calling | Natural-language twin |
| DevOps | **Docker, docker-compose, GitHub Actions** | One-command run + CI |
| Testing | **Vitest, Playwright, Pytest** | Unit + E2E |
| Hosting | Vercel (web) + Render/Railway/Fly.io (api, ml) | Free-tier friendly |

> The Python scientific logic (digital twin, forecasting, SHAP) lives in `services/ml`, so the AI/ML work is reused as-is.

---

## 10. Repository Structure (Folders & Files)

**Ownership legend** (every file/folder is tagged with exactly one owner):

| Tag | Member | Role |
|---|---|---|
| **[M1]** | Member 1 | 🧠 AI/ML & Digital Twin Engineer |
| **[M2]** | Member 2 | 🔌 Data Ingestion & Data Engineering Engineer |
| **[M3]** | Member 3 | ⚙️ Backend & Platform Engineer |
| **[M4]** | Member 4 | 🎨 UI/UX & Frontend Engineer |
| **[ALL]** | Everyone | Shared / reviewed by all |

```
carbontwin/
├── README.md                                   [M4 owns polish · ALL contribute]
├── SRS.md                                      [ALL]
├── LICENSE                                     [M3]
├── .env.example                                [M3]
├── .gitignore                                  [M3]
├── docker-compose.yml                          [M3]
├── Makefile                                    [M3]   # make dev | test | seed | demo
├── package.json                                [M3]   # npm workspaces
│
├── .github/
│   └── workflows/
│       ├── ci.yml                              [M3]   # lint + test on PR
│       └── deploy.yml                          [M3]
│
├── apps/
│   │
│   ├── web/                                    ──────── REACT FRONTEND ────────  [M4]
│   │   ├── index.html                          [M4]
│   │   ├── package.json                        [M4]
│   │   ├── vite.config.ts                      [M4]
│   │   ├── tailwind.config.ts                  [M4]
│   │   ├── tsconfig.json                       [M4]
│   │   ├── Dockerfile                          [M3]
│   │   ├── public/
│   │   │   ├── favicon.svg                     [M4]
│   │   │   ├── fonts/                          [M4]   # Inter, JetBrains Mono
│   │   │   └── models/building.glb             [M4]   # low-poly 3D asset
│   │   └── src/
│   │       ├── main.tsx                        [M4]
│   │       ├── App.tsx                         [M4]
│   │       ├── routes.tsx                      [M4]
│   │       ├── styles/ (globals.css, tokens.css)             [M4]
│   │       ├── mocks/ (handlers.ts, fixtures/)  [M4]   # MSW mocks so UI never waits on backend
│   │       ├── lib/
│   │       │   ├── api.ts                      [M4]   # typed client (uses packages/shared)
│   │       │   ├── ws.ts                       [M4]   # WebSocket hook
│   │       │   ├── format.ts                   [M4]   # units, numbers, dates
│   │       │   └── theme.ts                    [M4]
│   │       ├── store/
│   │       │   ├── useFacilityStore.ts         [M4]
│   │       │   ├── useLiveStore.ts             [M4]
│   │       │   ├── useScenarioStore.ts         [M4]
│   │       │   └── useTourStore.ts             [M4]
│   │       ├── hooks/
│   │       │   ├── useLiveTicks.ts             [M4]
│   │       │   ├── useScenario.ts              [M4]
│   │       │   ├── useForecast.ts              [M4]
│   │       │   └── useCountUp.ts               [M4]
│   │       ├── components/
│   │       │   ├── layout/ (AppShell, Sidebar, Topbar, DataSourceBadge).tsx   [M4]
│   │       │   ├── ui/ (GlassCard, KpiCard, Slider, Toggle, Skeleton).tsx     [M4]
│   │       │   ├── upload/ (DropZone.tsx, QualityReportPanel.tsx)             [M4]
│   │       │   ├── charts/
│   │       │   │   ├── LivePowerChart.tsx      [M4]
│   │       │   │   ├── ForecastCone.tsx        [M4]
│   │       │   │   ├── CarbonHeatmap.tsx       [M4]
│   │       │   │   ├── ShapWaterfall.tsx       [M4]
│   │       │   │   ├── ShapBar.tsx             [M4]
│   │       │   │   ├── MaccChart.tsx           [M4]
│   │       │   │   ├── RoadmapChart.tsx        [M4]
│   │       │   │   └── ModelAccuracyChart.tsx  [M4]
│   │       │   ├── twin/
│   │       │   │   ├── BuildingScene.tsx       [M4]   # react-three-fiber
│   │       │   │   ├── ThermalLegend.tsx       [M4]
│   │       │   │   ├── ThrottleControl.tsx     [M4]
│   │       │   │   └── ComfortBadge.tsx        [M4]
│   │       │   ├── scenarios/ (LeverCard, ScenarioCompare, KpiStrip, StackWaterfall).tsx  [M4]
│   │       │   ├── autopilot/ (ScheduleTimeline.tsx, PreCoolStory.tsx)       [M4]
│   │       │   ├── portfolio/ (FacilityMap.tsx)                              [M4]
│   │       │   ├── tour/ (TourOverlay.tsx, tourSteps.ts)                     [M4]
│   │       │   └── copilot/ (ChatDock.tsx, MessageBubble.tsx)                [M4]
│   │       └── pages/
│   │           ├── Landing.tsx                 [M4]
│   │           ├── CommandCenter.tsx           [M4]
│   │           ├── TwinLab.tsx                 [M4]
│   │           ├── Simulator.tsx               [M4]
│   │           ├── AutoPilot.tsx               [M4]
│   │           ├── MaccRoadmap.tsx             [M4]
│   │           ├── Explainability.tsx          [M4]
│   │           ├── Portfolio.tsx               [M4]
│   │           └── Reports.tsx                 [M4]
│   │
│   └── api/                                    ──────── NODE.JS GATEWAY ────────
│       ├── package.json                        [M3]
│       ├── tsconfig.json                       [M3]
│       ├── Dockerfile                          [M3]
│       └── src/
│           ├── server.ts                       [M3]
│           ├── app.ts                          [M3]
│           ├── config/env.ts                   [M3]
│           ├── plugins/ (cors, rateLimit, auth, errorHandler, logger).ts   [M3]
│           ├── routes/                                    # BACKEND ROUTES
│           │   ├── index.ts                    [M3]   # registers all routes
│           │   ├── forecast.routes.ts          [M3]
│           │   ├── twin.routes.ts              [M3]
│           │   ├── scenarios.routes.ts         [M3]
│           │   ├── optimize.routes.ts          [M3]
│           │   ├── reports.routes.ts           [M3]
│           │   ├── impact.routes.ts            [M3]
│           │   ├── copilot.routes.ts           [M3]
│           │   └── health.routes.ts            [M3]
│           ├── services/                                  # BACKEND SERVICES
│           │   ├── mlClient.service.ts         [M3]   # typed HTTP client to FastAPI
│           │   ├── orchestrator.service.ts     [M3]   # chains data + ML calls per request
│           │   ├── impact.service.ts           [M3]   # trees / km / homes equivalents
│           │   ├── report.service.ts           [M3]   # Puppeteer HTML → PDF
│           │   └── copilot.service.ts          [M3]   # Claude API tool-calling
│           ├── ws/
│           │   ├── hub.ts                      [M3]   # WebSocket hub & channels
│           │   └── events.ts                   [M3]
│           ├── cache/ (cache.ts, redis.ts)     [M3]
│           ├── templates/ (esg-report.html, esg-report.css)  [M4 designs · M3 wires]
│           ├── tests/ (api/*.test.ts)          [M3]
│           │
│           ├── ingestion/                      ──── DATA INGESTION LAYER ────  [M2]
│           │   ├── routes/
│           │   │   ├── facilities.routes.ts    [M2]   # upload, list, timeseries
│           │   │   ├── carbon.routes.ts        [M2]   # live CI + forecast
│           │   │   └── weather.routes.ts       [M2]
│           │   ├── parsers/
│           │   │   ├── csv.parser.ts           [M2]
│           │   │   ├── parquet.parser.ts       [M2]
│           │   │   ├── schemaDetector.ts       [M2]   # auto-detect timestamp/kW columns
│           │   │   └── columnMapper.ts         [M2]
│           │   ├── validators/
│           │   │   ├── intervalValidator.ts    [M2]   # 15-min regularity
│           │   │   ├── unitNormalizer.ts       [M2]   # Wh/kWh/kW/MW → kW
│           │   │   └── timezone.ts             [M2]
│           │   ├── cleaning/
│           │   │   ├── resampler.ts            [M2]   # → 15-min grid
│           │   │   ├── imputer.ts              [M2]   # gap filling
│           │   │   └── outlierDetector.ts      [M2]
│           │   ├── connectors/
│           │   │   ├── electricityMaps.client.ts [M2]
│           │   │   ├── co2signal.client.ts     [M2]
│           │   │   ├── openMeteo.client.ts     [M2]
│           │   │   ├── openWeather.client.ts   [M2]
│           │   │   └── fallbackProvider.ts     [M2]   # cached/synthetic fallback
│           │   ├── pipeline/
│           │   │   ├── ingestPipeline.ts       [M2]   # parse → validate → clean → store
│           │   │   ├── qualityReport.ts        [M2]   # missing %, outliers, imputed rows
│           │   │   ├── emissions.service.ts    [M2]   # dynamic Scope 2 calc
│           │   │   └── replayEngine.ts         [M2]   # historic → live ticks
│           │   ├── scheduler/refreshJobs.ts    [M2]   # cron: refresh CI + weather
│           │   ├── store/ (timeseries.repo.ts, facility.repo.ts)  [M2]
│           │   ├── db/
│           │   │   ├── client.ts               [M2]
│           │   │   ├── schema.sql              [M2]
│           │   │   ├── migrations/             [M2]
│           │   │   └── seed.ts                 [M2]
│           │   └── tests/ (ingestion/*.test.ts) [M2]
│
├── packages/
│   └── shared/                                 # zod schemas + TS types used by web & api
│       ├── package.json                        [M3]
│       └── src/
│           ├── api.schemas.ts                  [M3]   # requests/responses
│           ├── ingestion.schemas.ts            [M2]   # timeseries, quality report
│           ├── ml.schemas.ts                   [M1]   # forecast/twin/optimize payloads
│           ├── ws.events.ts                    [M3]
│           ├── types.ts                        [ALL]
│           └── constants.ts                    [ALL]
│
├── services/
│   └── ml/                                     ──────── PYTHON AI/ML SERVICE ────────  [M1]
│       ├── pyproject.toml / requirements.txt   [M1]
│       ├── Dockerfile                          [M1]
│       ├── app/
│       │   ├── main.py                         [M1]   # FastAPI app
│       │   ├── config.py                       [M1]
│       │   ├── schemas.py                      [M1]   # pydantic models (mirror ml.schemas.ts)
│       │   ├── mock/mock_responses.py          [M1]   # Day-3 mock so others aren't blocked
│       │   ├── routers/ (forecast, explain, twin, optimize, scenario, anomaly).py  [M1]
│       │   ├── twin/
│       │   │   ├── rc_model.py                 [M1]   # RC ODE + solve_ivp
│       │   │   ├── calibrate.py                [M1]   # least_squares fit of R, C
│       │   │   ├── hvac.py                     [M1]   # COP curves
│       │   │   └── multizone.py                [M1]   # stretch
│       │   ├── forecasting/
│       │   │   ├── features.py                 [M1]
│       │   │   ├── train.py                    [M1]
│       │   │   ├── predict.py                  [M1]   # quantile LightGBM
│       │   │   └── evaluate.py                 [M1]
│       │   ├── xai/ (shap_explainer.py, nlg.py) [M1]
│       │   ├── optimization/ (mpc.py, battery.py, solar.py)   [M1]
│       │   ├── scenarios/ (engine.py, levers.py, economics.py, macc.py)  [M1]
│       │   ├── anomaly/detector.py             [M1]
│       │   └── registry/model_store.py         [M1]   # joblib save/load
│       ├── artifacts/                          [M1]   # trained models (git-ignored)
│       ├── notebooks/ (01_eda, 02_forecast, 03_twin_calibration).ipynb  [M1]
│       └── tests/ (test_rc_model.py, test_economics.py, test_mpc.py)    [M1]
│
├── data/                                       ──────── DATA ASSETS ────────  [M2]
│   ├── raw/                                    [M2]   # open datasets (git-ignored)
│   ├── demo/                                   [M2]   # curated, committed
│   │   ├── office_tower.csv                    [M2]
│   │   ├── hospital.csv                        [M2]
│   │   ├── campus.csv                          [M2]
│   │   └── data_center.csv                     [M2]
│   ├── cache/ (grid_ci_fallback.json, weather_fallback.json, tariffs.json)  [M2]
│   └── scripts/
│       ├── download_data.py                    [M2]
│       ├── build_demo_datasets.py              [M2]   # slice/clean BDG2 etc.
│       ├── generate_synthetic.py               [M2]   # realistic fallback profiles
│       └── validate_dataset.py                 [M2]
│
└── docs/
    ├── architecture.png                        [M3]
    ├── api.md                                  [M3]
    ├── methodology.md                          [M1]   # RC model, Scope 2 method, validation
    ├── model-card.md                           [M1]
    ├── data-sources.md                         [M2]   # licenses, citations, quality rules
    ├── design-system.md                        [M4]
    ├── demo-script.md                          [M4 + M2]
    ├── pitch-deck-outline.md                   [M2 leads · M4 designs]
    └── screenshots/                            [M4]
```

### 10.1 Ownership Matrix (Quick View)

| Top-level path | Owner | Reviewer (buddy) |
|---|---|---|
| `services/ml/**` | **M1** | M2 |
| `packages/shared/src/ml.schemas.ts` | **M1** | M3 |
| `apps/api/src/ingestion/**` | **M2** | M1 |
| `data/**` | **M2** | M1 |
| `packages/shared/src/ingestion.schemas.ts` | **M2** | M3 |
| `apps/api/src/{routes,services,ws,plugins,cache,config}/**` | **M3** | M2 |
| `docker-compose.yml`, `.github/**`, `Makefile`, Dockerfiles | **M3** | M2 |
| `apps/web/**` | **M4** | M3 |
| `docs/` | split per table above | any |

---

## 11. Work Distribution (4 Members)

> **Principle:** one clear owner per layer, each with a defined handoff. Contract-first: `packages/shared` + `docs/api.md` + the ML mock (Day 3) let all four work in parallel from Day 1.

### Team Overview

| | Member 1 | Member 2 | Member 3 | Member 4 |
|---|---|---|---|---|
| **Role** | 🧠 AI/ML & Digital Twin | 🔌 Data Ingestion & Data Eng. | ⚙️ Backend & Platform | 🎨 UI/UX & Frontend |
| **Language** | Python | TypeScript + Python scripts | TypeScript | TypeScript / React |
| **Primary folders** | `services/ml/` | `apps/api/src/ingestion/`, `data/` | `apps/api/src/{routes,services,ws}`, infra | `apps/web/` |
| **Delivers** | Forecast, SHAP, twin, optimizer, scenarios | Clean 15-min data, live CI/weather, emissions, replay | Orchestration, API, WebSocket, PDF, Docker, deploy | Every screen, 3D twin, tour, polish |
| **Buddy** | M2 | M1 | M2 | M3 |

---

### 🧠 Member 1: AI/ML & Digital Twin Engineer (the only AI/ML person)

**Owns:** `services/ml/**`, `packages/shared/src/ml.schemas.ts`, `docs/methodology.md`, `docs/model-card.md`

**Files & folders handled**

| Path | What it contains |
|---|---|
| `services/ml/app/main.py`, `config.py`, `schemas.py` | FastAPI app, config, pydantic request/response models |
| `services/ml/app/mock/mock_responses.py` | Mock ML responses published by **Day 3** |
| `services/ml/app/routers/*.py` | `forecast`, `explain`, `twin`, `optimize`, `scenario`, `anomaly` endpoints |
| `services/ml/app/twin/rc_model.py` | RC thermal ODE solved with `solve_ivp` |
| `services/ml/app/twin/calibrate.py` | Fits R, C, window factor with `least_squares` |
| `services/ml/app/twin/hvac.py` | Temperature-dependent COP, power curves |
| `services/ml/app/forecasting/{features,train,predict,evaluate}.py` | Feature engineering, LightGBM quantile models, metrics |
| `services/ml/app/xai/{shap_explainer,nlg}.py` | SHAP global/local + plain-English explanations |
| `services/ml/app/optimization/{mpc,battery,solar}.py` | Carbon-aware MPC, battery dispatch, PV yield |
| `services/ml/app/scenarios/{engine,levers,economics,macc}.py` | Levers, ROI/NPV/payback, $/tCO₂e, MACC data |
| `services/ml/app/anomaly/detector.py` | Isolation Forest / residual-z anomalies |
| `services/ml/app/registry/model_store.py` | Model save/load + versioning |
| `services/ml/notebooks/*.ipynb` | EDA, forecast experiments, twin calibration |
| `services/ml/tests/*` | Physics sanity, economics, optimizer feasibility tests |
| `services/ml/Dockerfile`, `requirements.txt` | ML container |
| `docs/methodology.md`, `docs/model-card.md` | Method + validation write-up |

**Inputs it needs from others:** clean 15-min data + weather + CI (from **M2**); API contract (agreed with **M3**).
**Outputs others depend on:** OpenAPI spec + mock (→ M3, M4), model metrics for UI model card (→ M4).

**Deliverable checklist**
- [ ] Forecast MAPE < 12% on held-out week
- [ ] SHAP local + global + NLG sentence
- [ ] RC twin passes analytic sanity test; calibrated on demo data
- [ ] MPC lowers emissions while holding comfort band
- [ ] 6 levers + MACC dataset
- [ ] Anomaly flags with estimated wasted kgCO₂e

**Stretch:** multi-zone twin, online recalibration, RL baseline comparison.

---

### 🔌 Member 2: Data Ingestion & Data Engineering Engineer

**Owns:** `apps/api/src/ingestion/**`, `data/**`, `packages/shared/src/ingestion.schemas.ts`, `docs/data-sources.md`

**Files & folders handled**

| Path | What it contains |
|---|---|
| `ingestion/parsers/{csv,parquet}.parser.ts` | Stream-parse large CSV/Parquet files |
| `ingestion/parsers/schemaDetector.ts`, `columnMapper.ts` | Auto-detect timestamp, power, units; UI-assisted mapping |
| `ingestion/validators/{intervalValidator,unitNormalizer,timezone}.ts` | 15-min regularity, Wh/kWh/kW/MW normalization, TZ/DST handling |
| `ingestion/cleaning/{resampler,imputer,outlierDetector}.ts` | Resample to 15-min grid, gap-fill, outlier flags |
| `ingestion/connectors/*.client.ts` | Electricity Maps, CO2 Signal, Open-Meteo, OpenWeather clients |
| `ingestion/connectors/fallbackProvider.ts` | Cached/synthetic fallback so demo never fails |
| `ingestion/pipeline/ingestPipeline.ts` | parse → validate → clean → store |
| `ingestion/pipeline/qualityReport.ts` | Data-quality JSON for the UI panel |
| `ingestion/pipeline/emissions.service.ts` | Dynamic Scope 2: `kW × 0.25 × CI / 1000` |
| `ingestion/pipeline/replayEngine.ts` | Streams history as live ticks (1 day ≈ 60 s) |
| `ingestion/scheduler/refreshJobs.ts` | Cron refresh of CI + weather |
| `ingestion/store/*.repo.ts` | Timescale/SQL repositories |
| `ingestion/db/{schema.sql,migrations,seed.ts,client.ts}` | Database schema and seeding |
| `ingestion/routes/{facilities,carbon,weather}.routes.ts` | Upload, list, timeseries, CI, weather endpoints |
| `data/raw/`, `data/demo/*.csv` | Source datasets + 4 curated demo facilities |
| `data/cache/*.json` | CI, weather, tariff fallbacks |
| `data/scripts/*.py` | Download, build-demo, synthetic generator, validator |
| `docs/data-sources.md` | Licenses, citations, cleaning rules |

**Inputs it needs from others:** feature/column requirements (from **M1**); route registration + DB hosting (from **M3**).
**Outputs others depend on:** clean time series + CI + weather (→ M1), WebSocket tick source (→ M3), data quality JSON + demo CSVs (→ M4).

**Deliverable checklist**
- [ ] Upload CSV/Parquet → facility ready in < 10 s with quality report
- [ ] 4 demo facilities cleaned and committed
- [ ] Live CI + weather with cache and fallback; `Live/Cached/Synthetic` flag in every response
- [ ] Replay engine emitting `tick` events
- [ ] Dynamic vs. annual-average emissions comparison data (for FR-9)

**Extra duties (balance):** leads the pitch-deck outline and co-writes the demo script; helps M4 on Portfolio and Heatmap pages in Phase 4.

---

### ⚙️ Member 3: Backend & Platform Engineer

**Owns:** `apps/api/src/{routes,services,ws,plugins,cache,config,tests}`, `packages/shared/src/{api.schemas,ws.events}.ts`, infra files, `docs/api.md`, `docs/architecture.png`

**Files & folders handled**

| Path | What it contains |
|---|---|
| `apps/api/src/server.ts`, `app.ts`, `config/env.ts` | Gateway bootstrap, env validation |
| `apps/api/src/plugins/*` | CORS, rate limiting, JWT auth, error handler, pino logger |
| `apps/api/src/routes/{forecast,twin,scenarios,optimize,reports,impact,copilot,health}.routes.ts` | Public API surface |
| `apps/api/src/services/mlClient.service.ts` | Typed HTTP client to the FastAPI service, with timeouts/retries |
| `apps/api/src/services/orchestrator.service.ts` | Combines data (M2) + ML (M1) results per request |
| `apps/api/src/services/impact.service.ts` | Trees / car-km / homes equivalents |
| `apps/api/src/services/report.service.ts` | Puppeteer ESG PDF |
| `apps/api/src/services/copilot.service.ts` | "Ask the Twin" Claude tool-calling over our own API |
| `apps/api/src/ws/{hub,events}.ts` | WebSocket hub; forwards M2's ticks and M1's anomalies/schedules |
| `apps/api/src/cache/*` | Redis / in-memory cache layer |
| `apps/api/src/templates/esg-report.{html,css}` | Report template (designed by M4, wired by M3) |
| `packages/shared/src/{api.schemas,ws.events}.ts` | Shared zod contracts |
| `docker-compose.yml`, all `Dockerfile`s, `Makefile` | One-command stack |
| `.github/workflows/{ci,deploy}.yml` | CI and deployment |
| `.env.example`, `.gitignore`, root `package.json` | Config, workspaces |
| `docs/api.md`, `docs/architecture.png` | API reference and diagram |

**Inputs it needs from others:** ML OpenAPI (**M1**), ingestion services + replay (**M2**), report design (**M4**).
**Outputs others depend on:** stable REST/WS API + shared types (→ M4), working compose stack (→ all).

**Deliverable checklist**
- [ ] Contract published Day 2; all endpoints return mocks by Day 4
- [ ] End-to-end path: upload → forecast → scenario → optimize → PDF
- [ ] WebSocket streaming with reconnect support
- [ ] `docker compose up` works from a clean clone; deployed URL live
- [ ] JWT + rate limit + input validation; `/health` shows dependency status
- [ ] E2E (Playwright) test of the guided-demo path

**Extra duties:** deployment (Vercel/Render), backup offline Docker pack, E2E tests.

---

### 🎨 Member 4: UI/UX & Frontend Engineer

**Owns:** `apps/web/**`, `docs/design-system.md`, `docs/screenshots/`, report visual design

**Files & folders handled**

| Path | What it contains |
|---|---|
| `apps/web/{index.html,vite.config.ts,tailwind.config.ts,tsconfig.json,package.json}` | Frontend setup |
| `apps/web/public/{fonts,models,favicon.svg}` | Fonts, 3D building asset, branding |
| `apps/web/src/styles/*` | Design tokens, global styles, dark/light themes |
| `apps/web/src/mocks/*` | MSW mocks and fixtures so the UI progresses independently |
| `apps/web/src/lib/*` | API client, WebSocket hook, formatters |
| `apps/web/src/store/*`, `hooks/*` | Zustand stores, TanStack Query hooks, count-up animations |
| `components/layout/*`, `components/ui/*` | App shell, GlassCard, KpiCard, sliders, skeletons, data-source badge |
| `components/upload/*` | Drop zone + data-quality panel |
| `components/charts/*` | Live power, forecast cone, heatmap, SHAP, MACC, roadmap, accuracy |
| `components/twin/*` | 3D building scene, thermal legend, throttle control, comfort badge |
| `components/scenarios/*` | Lever cards, compare view, KPI strip, stack waterfall |
| `components/autopilot/*` | Schedule timeline, pre-cool story callout |
| `components/portfolio/*` | MapLibre facility map |
| `components/tour/*` | Guided demo overlay + step definitions |
| `components/copilot/*` | Chat dock |
| `pages/*` (9 pages) | Landing, CommandCenter, TwinLab, Simulator, AutoPilot, MaccRoadmap, Explainability, Portfolio, Reports |
| `docs/design-system.md`, `docs/screenshots/*` | Design tokens, screenshots for README/deck |
| `apps/api/src/templates/esg-report.{html,css}` | Branded report design (handoff to M3) |

**Inputs it needs from others:** typed API + WebSocket (**M3**), demo data and quality JSON (**M2**), model metrics + SHAP payloads (**M1**).
**Outputs others depend on:** the demo itself, since this is what judges see.

**Deliverable checklist**
- [ ] All 9 pages responsive and styled; dark/light theme
- [ ] 3D twin recolors live from WebSocket ticks
- [ ] Guided Demo Mode runs the full story offline
- [ ] Loading/empty/error states everywhere; `Live/Cached/Synthetic` badges
- [ ] Lighthouse performance ≥ 90 on Command Center
- [ ] Demo video + screenshots

**Load-balancing:** because UI is the largest surface, **M2** (after ingestion is stable) builds `CarbonHeatmap`, `FacilityMap` and `DropZone`/`QualityReportPanel`, and **M1** supplies chart-ready JSON shapes for SHAP/MACC/forecast so M4 never reshapes data. Ownership stays with M4; helpers open PRs into M4's folders.

---

### Collaboration Contract

| Interface | Provider → Consumer | Format / Where | Due |
|---|---|---|---|
| Shared zod types + API contract | M3 → M4, M2, M1 | `packages/shared`, `docs/api.md` | Day 2 |
| ML OpenAPI + mock responder | M1 → M3, M4 | FastAPI `/docs` | Day 3 |
| Clean data schema (columns, units) | M2 → M1 | `ingestion.schemas.ts`, `data-sources.md` | Day 3 |
| Demo datasets (4 facilities) | M2 → all | `data/demo/*.csv` | Day 5 |
| Live tick stream | M2 → M3 → M4 | `replayEngine` → WS `tick` | Day 7 |
| Chart-ready ML JSON (SHAP, MACC, forecast) | M1 → M4 (via M3) | `ml.schemas.ts` | Day 8 |
| UI kit (GlassCard, KpiCard…) | M4 → M3 (report) | `components/ui`, `esg-report.css` | Day 10 |

### Review Buddies
M1 ↔ M2 (features, data schema) · M2 ↔ M3 (pipeline, DB, routes) · M3 ↔ M4 (API contract, types) · M4 ↔ M1 (how ML outputs are visualized).

### Git Workflow
- Branches: `main` (protected, always demo-ready) ← `dev` ← `feature/<m#>-<topic>` (e.g. `feature/m2-parquet-parser`)
- Folder ownership = who can merge to that folder without review; changes to someone else's folder need that owner's review.
- PRs reviewed by the buddy; CI must pass; merge at least daily; tag `v0.x` at each milestone.
- Commit scopes: `feat(ml):`, `feat(ingest):`, `feat(api):`, `feat(web):`.

---

## 12. Timeline & Milestones
(Adjust to the real round deadline; below assumes ~3 weeks.)

| Phase | Days | Milestone | Exit Criteria |
|---|---|---|---|
| **0. Setup** | 1–2 | Monorepo, Docker, contracts | `docker compose up` shows hello-world on all 3 services; schemas agreed |
| **1. Foundations** | 3–6 | Data + API + shell | Demo CSV ingested; CI + emissions calc live; ML mock responds; React shell + routing; baseline forecast v0 |
| **2. Core Features** | 7–12 | Real twin + forecast + scenarios | RC twin + LightGBM + SHAP real endpoints; Command Center streaming; Simulator working; 3D building v1 |
| **3. Wow Layer** | 13–17 | Auto-Pilot, MACC, Tour, PDF | MPC optimizer; MACC; guided demo; PDF report; portfolio map |
| **4. Polish & Harden** | 18–20 | Performance, fallback, QA | Offline fallback tested; Lighthouse > 90; E2E green; bugs triaged |
| **5. Pitch Prep** | 21 | Rehearsal | 3 full run-throughs; backup video; deck final |

**Feature freeze:** 3 days before the round. After that only bug fixes and rehearsal.

---

## 13. Data Strategy

| Need | Source | Fallback |
|---|---|---|
| Smart meter 15-min data | Open datasets: **Building Data Genome 2 (BDG2)**, **ASHRAE Great Energy Predictor III**, Pecan Street (check license/access terms) | `generate_synthetic.py` creating realistic office/hospital/campus/data-center profiles |
| Grid carbon intensity | Electricity Maps / CO2 Signal API (free tier) | `data/cache/grid_ci_fallback.json` (diurnal profile) |
| Weather | Open-Meteo (no key required) / OpenWeather | `weather_fallback.json` |
| Tariffs | Configurable defaults per region | UI input |
| Emission factors | Documented in `methodology.md` (location-based, dynamic) | Regional average |

> **Important:** Always state clearly in the UI/report when data is **live**, **cached**, or **synthetic**. Honesty builds judge trust.

---

## 14. Testing & Quality

| Level | Tool | What |
|---|---|---|
| Unit (ML) | Pytest | RC model energy balance, steady-state sanity, economics formulas, optimizer feasibility |
| Unit (API) | Vitest | Ingestion validation, emissions math, cache fallback |
| Contract | Schema validation (zod ↔ pydantic) | No drift between services |
| Model validation | Time-series CV | MAPE, R², calibration of quantiles |
| E2E | Playwright | The full demo path in `tourSteps.ts` |
| Performance | Lighthouse, k6 (light) | Latency NFRs |
| Physics sanity | Notebook | Twin matches a known analytic exponential decay |

---

## 15. Deployment

- **Local / demo laptop:** `docker compose up --build` → web `:5173`, api `:4000`, ml `:8000`.
- **Cloud:** Web → Vercel/Netlify; API + ML → Render/Railway/Fly.io (Docker). Env vars through dashboard.
- **Offline demo pack:** pre-built Docker images + cached data so the demo works with **no internet**.
- **Backup:** 2-minute screen-recorded demo video.

`.env.example`
```
ELECTRICITY_MAPS_TOKEN=
OPENWEATHER_KEY=
ANTHROPIC_API_KEY=            # only for Ask-the-Twin copilot
DATABASE_URL=postgres://carbon:carbon@db:5432/carbontwin
ML_SERVICE_URL=http://ml:8000
JWT_SECRET=change-me
USE_FALLBACK_DATA=false
```

---

## 16. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| External API outage/rate limit during demo | Med | High | Cache + fallback + replay mode; "Live/Cached" badge |
| 3D scene too heavy on judge laptop | Med | Med | Low-poly model, quality toggle, 2D fallback |
| Forecast accuracy poor on new upload | Med | Med | Show model card + uncertainty; keep demo facilities tuned |
| Scope creep / unfinished wow features | High | High | P0/P1/P2 discipline, feature freeze, daily integration |
| Integration pain between Node and Python | Med | Med | Contract-first, ML mock by Day 3, shared schemas |
| Member unavailable | Low | High | Review buddies cross-trained: M1↔M2 (data/features), M2↔M3 (pipeline/API), M3↔M4 (contract/UI), M4↔M1 (viz of ML) |
| Dataset license issues | Low | Med | Prefer clearly open datasets, cite sources, synthetic fallback |
| Claims challenged by judges | Med | High | `methodology.md`; label assumptions; show validation metrics |

---

## 17. Demo Script & Judging Strategy

### 17.1 Pitch Flow (≈ 5 min)
1. **Hook (20 s):** *"Buildings are 30% of global emissions, and most can't afford to retrofit sensors. What if the sensor is software?"*
2. **Problem (30 s):** static annual factors, no scenario tools, hardware capex.
3. **Live demo (3 min):** Guided tour (§7.3).
4. **Tech credibility (45 s):** physics + ML + XAI + optimization. Show model card.
5. **Business impact (30 s):** MACC, payback, scalability from 1 to 1,000 buildings, zero hardware.
6. **Schneider fit (30 s):** complements EcoStruxure-style energy management; can plug into real meter/BMS data when available; software-first on-ramp for customers.
7. **Close:** *"CarbonTwin turns every smart meter into a decarbonization plan."*

### 17.2 What Impresses Judges
- **Physics + ML together**, not a black box.
- **Explainability** for every number.
- **Actionable output** (schedule, ROI, PDF), not just charts.
- **Reliability** (fallbacks, honest data labels).
- **Visual polish** and a story-driven demo.
- **Clear path to scale** and to real hardware/BMS integration.

### 17.3 Likely Q&A Prep
| Question | Answer direction |
|---|---|
| How accurate is the twin without sensors? | Calibrated from historical load + weather; uncertainty shown; improves when real sensors added |
| How is this different from existing energy dashboards? | Forward-looking simulation + optimization + abatement economics, not just monitoring |
| Is dynamic Scope 2 accepted? | Location-based hourly method is increasingly used; methodology documented; fully reproducible |
| What about data privacy? | Runs on-prem or in tenant cloud; no PII; only energy time-series |
| How do you scale? | Stateless services, per-facility models, async training |

---

## 18. Acceptance Criteria (Definition of Done)

- [ ] `docker compose up` runs the entire stack from a clean clone
- [ ] Upload a CSV → facility appears with data-quality report in < 10 s
- [ ] Command Center streams live/replay ticks with Carbon Clock
- [ ] 24h forecast with prediction band; MAPE reported
- [ ] SHAP explanation for any clicked timestamp with plain-English text
- [ ] Twin Lab: throttle change updates temperature curve < 500 ms
- [ ] Simulator: stack ≥ 3 levers with correct ROI/abatement cost
- [ ] Auto-Pilot produces a schedule that lowers emissions while staying in comfort band
- [ ] MACC chart renders with ≥ 5 levers
- [ ] ESG PDF downloads with charts, methodology, assumptions
- [ ] Guided demo runs end-to-end without error, offline
- [ ] Lighthouse performance ≥ 90 on Command Center
- [ ] README + SRS + methodology complete; 2-minute backup video recorded

---

*End of SRS v2.0*
