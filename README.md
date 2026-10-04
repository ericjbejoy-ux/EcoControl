<div align="center">

# ⚡ CarbonTwin
### The AI Digital Twin That Decarbonizes Buildings, Without a Single Sensor

*Schneider Electric Co-Creation Challenge · Top-30 Finalist*

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-20-3C873A?logo=node.js&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-ML%20Service-009688?logo=fastapi&logoColor=white)
![LightGBM](https://img.shields.io/badge/LightGBM-Forecasting-2E8B57)
![SHAP](https://img.shields.io/badge/SHAP-Explainable%20AI-orange)
![Hardware](https://img.shields.io/badge/Hardware%20Required-ZERO-3DCD58)

**Hardware: none. Retrofits: none. Capex to start: $0.**

</div>

---

## 🌍 The Problem

Commercial buildings are a major source of global emissions, yet most facility managers are flying blind:

- ❌ Installing IoT sensors across facilities is slow and capital-intensive
- ❌ Utility data is **static**; emissions are computed with **annual-average factors** that hide when the grid is actually dirty
- ❌ There is **no safe way to test** operational changes (cut HVAC, shift load, add solar) *before* doing them

## 💡 Our Solution

**CarbonTwin** is a 100% software platform that turns ordinary **smart meter data** into a living **physics-informed Digital Twin** of a building, then uses AI to predict, explain, simulate, and **optimize** its carbon footprint.

```
 Smart Meter Data (CSV/Parquet) ─┐
 Live Weather API ───────────────┼─► Node.js Gateway ─► FastAPI AI/Twin Engine ─► React Command Center
 Live Grid Carbon Intensity API ─┘        │                  (SciPy · LightGBM · SHAP · MPC)
                                          └─► WebSocket live stream · PDF ESG reports
```

---

## ✨ Feature Highlights

| | Feature | What it does |
|---|---|---|
| 🌱 | **Dynamic Scope 2 Carbon Clock** | kWh × *live* grid gCO₂/kWh every 15 minutes, not annual averages |
| 🏢 | **Physics-Informed Digital Twin** | RC thermal model simulates indoor temperature under any HVAC throttle, with no physical sensors |
| 🧊 | **3D Live Building** | Rotatable 3D twin colored by temperature and emissions in real time |
| 🔮 | **24h AI Forecast + Uncertainty** | LightGBM quantile forecast with prediction bands |
| 🔍 | **Explainable AI (SHAP)** | Click any spike and see exactly why: *"41% outdoor temp, 27% grid carbon…"* |
| 🧪 | **What-If Studio** | Stack levers (peak shaving, load shifting, solar, battery, setpoints) with instant ROI and $/tCO₂e |
| 🤖 | **Carbon-Aware Auto-Pilot** | MPC optimizer generates a comfort-safe HVAC schedule (e.g. *pre-cool at 4 AM when the grid is cleanest*) |
| 📉 | **MACC & Net Zero Roadmap** | Marginal Abatement Cost Curve ranks every lever by cost-effectiveness |
| 🗺️ | **Portfolio Map** | Scale view: one building or one thousand |
| 📄 | **One-Click ESG PDF** | Audit-ready report with methodology, charts and assumptions |
| ⏪ | **Carbon Time Machine** | Scrub any past day and replay emissions and twin state |
| 💬 | **Ask the Twin** | Natural-language copilot: *"What if we shut AHU-2 from 2–3 PM?"* |
| 🎬 | **Guided Demo Mode** | A 3-minute auto-tour built for judges |

---

## 🎬 Demo Walkthrough: What You'll See

> **Scene 1: Command Center.** The app opens on a glowing 3D building. A live **Carbon Clock** ticks up in kgCO₂e. The grid intensity gauge turns amber: *612 g/kWh, the grid is dirty right now.* A forecast cone extends the power curve 24 hours into the future.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● LIVE  Office Tower A ▾   IN-SO ▾                         [▶ Demo Tour] │
├────────────┬────────────┬────────────┬────────────┬──────────────────────┤
│ CARBON     │ GRID CI    │ POWER      │ TODAY      │ NET ZERO PROGRESS    │
│ 1,284 kg   │ 612 g/kWh▲ │ 842 kW     │ −14.2%     │ ◔ 38% → 2040         │
├────────────┴────────────┴────────────┴────────────┴──────────────────────┤
│   Live power ▓▓▓▓▓▓▒▒░░░  |  Forecast cone (p10–p90) ░░░░░░░░░░░         │
├──────────────────────────────────┬───────────────────────────────────────┤
│   🏢 3D DIGITAL TWIN (rotate)    │   WHY IS EMISSIONS HIGH?  (SHAP)      │
│   floors glow blue → orange      │   Outdoor temp ▇▇▇▇▇ 41%              │
│                                  │   Grid carbon  ▇▇▇▇  27%              │
├──────────────────────────────────┴───────────────────────────────────────┤
│ ⚠ 02:15 AHU-3 running unoccupied · est. waste 18 kgCO₂e                  │
└──────────────────────────────────────────────────────────────────────────┘
```

> **Scene 2: Explain it.** Click the red spike at 14:15. A SHAP waterfall appears with a one-line English explanation. *No black boxes.*

> **Scene 3: Twin Lab.** Drag the **HVAC throttle slider** down for 30 minutes during a high-carbon window. The building's temperature curve drifts **+1.4 °C** but stays inside the comfort band; a badge pops up: **"Saves 22 kgCO₂e · Comfort OK ✅"**. No sensor needed.

> **Scene 4: What-If Studio.** Toggle **Peak Shaving + Rooftop Solar + Load Shifting**. KPIs animate: **186 tCO₂e/yr avoided · $51k saved · 4.7-yr payback · −$38/tCO₂e** (it *pays for itself*).

> **Scene 5: Auto-Pilot.** One click on **Optimize**. The system pre-cools at 04:00 when the grid is 38% cleaner and coasts through the dirty evening peak, with indoor temperature staying in the comfort band. **−19% emissions, zero comfort loss.**

> **Scene 6: MACC.** An interactive cost curve ranks every lever; the green bars are decarbonization that earns money.

> **Scene 7: One click, one PDF.** An audit-ready **ESG report** downloads, with methodology and assumptions included.

> **Scene 8: Zoom out.** The Portfolio Map shows 12 facilities with live emission rings: *"This scales from 1 building to 1,000."*

---

## 🧠 How It Works

### 1) Dynamic Emissions
```
Emissions (kg) = Power (kW) × 0.25 h × CarbonIntensity (g/kWh) / 1000
```

### 2) Physics-Informed Digital Twin (RC Model)
```
C · dT_in/dt = (T_out − T_in)/R + Q_internal + Q_solar − COP · P_hvac · u(t)
```
Solved with SciPy; `R` and `C` auto-calibrated from historical load + weather.

### 3) Predictive AI + XAI
LightGBM (quantile) forecasts 24h demand → SHAP attributes every spike to weather, time-of-day, grid carbon, occupancy, or historical pattern.

### 4) Carbon-Aware Optimization (MPC)
```
minimize Σ CI(t)·P_hvac(t)  s.t. twin dynamics, comfort band 22–26 °C
```

### 5) Abatement Economics
```
$/tCO₂e = (Annualized CAPEX − Annual Savings) / tCO₂e avoided
```

---

## 🏗️ Architecture

```
React (Vite + TS + Tailwind + ECharts + Three.js)
        │ REST + WebSocket
Node.js Gateway (Fastify + TS)  ── PostgreSQL/TimescaleDB · Redis · Puppeteer (PDF)
        │ HTTP (typed contract)
Python FastAPI ML Service  (SciPy RC Twin · LightGBM · SHAP · MPC · Anomaly)
        │
External: Electricity Maps / CO2 Signal · Open-Meteo · Smart-meter CSV/Parquet
```

See [`SRS.md`](./SRS.md) for the full specification, API contracts and work distribution.

---

## 🧰 Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind, shadcn/ui, Framer Motion, ECharts, react-three-fiber, MapLibre |
| Gateway | Node.js 20, Fastify, zod, ws, Puppeteer |
| AI/ML | Python 3.11, FastAPI, Pandas, NumPy, SciPy, LightGBM, SHAP, scikit-learn |
| Data | PostgreSQL + TimescaleDB, Redis |
| DevOps | Docker, docker-compose, GitHub Actions, Vercel/Render |

---

## 📁 Repository Layout

```
carbontwin/
├── apps/
│   ├── web/            # React frontend
│   └── api/            # Node.js gateway
├── services/
│   └── ml/             # FastAPI AI/Twin engine
├── packages/shared/    # shared zod schemas & types
├── data/               # demo datasets, fallbacks, scripts
├── docs/               # methodology, API, pitch, screenshots
├── docker-compose.yml
├── SRS.md
└── README.md
```

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/<your-org>/carbontwin.git && cd carbontwin

# 2. Configure
cp .env.example .env        # add API keys (optional: app runs on fallback data without them)

# 3. Run everything
docker compose up --build

# Web  → http://localhost:5173
# API  → http://localhost:4000
# ML   → http://localhost:8000/docs   (Swagger)
```

**Run without Docker**
```bash
npm install
npm run dev --workspace apps/api
npm run dev --workspace apps/web
cd services/ml && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000
```

**Offline demo mode** (no internet needed):
```bash
USE_FALLBACK_DATA=true docker compose up
```

---

## 🧪 Try It in 60 Seconds

1. Open the app and click **▶ Start Guided Demo**
2. Or drag `data/demo/office_tower.csv` onto the upload zone
3. Visit **Twin Lab**, then slide the HVAC throttle
4. Visit **Auto-Pilot**, then press **Optimize**
5. Visit **Reports**, then **Generate ESG PDF**

---

## 📊 Data & Honesty

| Data | Source | Fallback |
|---|---|---|
| Smart meter (15-min) | Open datasets (e.g., Building Data Genome 2, ASHRAE GEPIII) | Synthetic generator |
| Grid carbon intensity | Electricity Maps / CO2 Signal | Cached diurnal profile |
| Weather | Open-Meteo | Cached profile |

Every screen shows a **Live / Cached / Synthetic** badge, and every report lists its assumptions. We show our model accuracy (MAE, MAPE, R²) in the UI model card.

---

## 👥 Team & Ownership

| Member | Role | Owns (folders) |
|---|---|---|
| **Member 1** | 🧠 AI/ML & Digital Twin | `services/ml/` (RC twin, LightGBM forecast, SHAP, MPC optimizer, scenarios, anomaly) |
| **Member 2** | 🔌 Data Ingestion & Data Eng. | `apps/api/src/ingestion/`, `data/` (parsers, cleaning, live CI/weather connectors, emissions calc, replay, DB) |
| **Member 3** | ⚙️ Backend & Platform | `apps/api/src/{routes,services,ws,plugins}`, `packages/shared`, Docker, CI/CD, PDF, copilot |
| **Member 4** | 🎨 UI/UX & Frontend | `apps/web/` (9 pages, 3D twin, charts, guided tour, design system) |

Full file-by-file ownership lives in [`SRS.md` §10 and §11](./SRS.md). *(Replace "Member 1-4" with real names.)*

---

## 🗺️ Roadmap

- [x] Round 1: Streamlit prototype (Digital Twin, LightGBM, SHAP, simulator)
- [ ] Round 2: React + Node + FastAPI platform, 3D twin, Auto-Pilot, MACC, PDF
- [ ] Multi-zone twins and online recalibration
- [ ] Real BMS write-back (BACnet/Modbus) via Schneider EcoStruxure-compatible connectors
- [ ] Sensor-assisted hybrid twin (software-first, hardware-optional)
- [ ] Portfolio-level carbon budgeting and automated compliance exports (CSRD / GHG Protocol)

---

## 🌟 Why CarbonTwin Wins

1. **Zero-hardware on-ramp**: every customer can start today.
2. **Physics + ML + XAI**: accurate, explainable, trustworthy.
3. **From insight to action**: schedules, ROI, and audit-ready PDFs, not just dashboards.
4. **Honest & resilient**: fallbacks, labeled data, documented methodology.
5. **Scales**: one building to a global portfolio.

---

## 📚 Docs
- [`SRS.md`](./SRS.md): requirements, architecture, work distribution
- `docs/methodology.md`: RC model, Scope 2 method, ML validation
- `docs/api.md`: endpoint reference
- `docs/demo-script.md`: 5-minute pitch script

## 📜 License
MIT (update as needed). Built for the Schneider Electric Co-Creation Challenge. Not affiliated with or endorsed by Schneider Electric.

<div align="center">

**CarbonTwin: turn every smart meter into a decarbonization plan.** 🌱⚡

</div>
