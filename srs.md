# Software Requirements Specification (SRS)

## AI-Powered Software Digital Twin & Carbon Optimization Platform

## System Architecture Overview

```
[ Smart Meter Datasets (CSV/Parquet) ] 
[ Live Weather API                   ] ──► [ Service 2: FastAPI Ingestion ] ──► [ Service 3: Node.js Core Backend ] ──► [ Module 4: React/Next.js UI ]
[ Live Grid Carbon Intensity API     ]                 │                                        │
                                                       ▼                                        │
                                         [ Service 1: SciPy/ML Python Engine ] ◄────────────────┘
```

## 1. System Overview & Scope

The **AI-Powered Software Digital Twin & Carbon Optimization Platform** is a hardware-free enterprise simulator designed to compute dynamic Scope 2 emissions, predict energy loads, and model thermal behavior across commercial facilities. By eliminating physical IoT retrofits, the platform ingests 15-minute smart meter logs alongside real-time grid and weather telemetry, executing physics-based RC thermal differential models and machine learning forecasters to deliver actionable Net Zero roadmaps.

The system is designed with a **strictly decoupled microservices architecture** using standardized REST, OpenAPI, and JSON schemas. This enables all 4 team members to develop, test, and mock their modules 100% independently before seamless final integration.

---

## 2. Team Work Distribution & Isolation Strategy

To ensure zero friction during parallel development, each teammate owns an isolated service bounded by explicit API contracts and mock data interfaces.

| Teammate / Role | Service / Module Boundary | Primary Tech Stack | Standalone Development & Mock Strategy | 
| ----- | ----- | ----- | ----- | 
| **Teammate 1: AI/ML & Physics Engine Specialist** | **Service 1:** AI & Thermal Twin Engine | Python 3.10+, SciPy, LightGBM, SHAP, FastAPI | Exposes standalone FastAPI endpoints (`/twin/simulate`, `/ml/predict`). Tests using synthetic local CSV arrays and returns structured JSON output. | 
| **Teammate 2: Data Ingestion Specialist** | **Service 2:** Ingestion & Telemetry Pipeline | FastAPI, Celery, Redis, Pandas, PyArrow, PostgreSQL | Queries live external APIs and parses logs. Saves normalized telemetry into shared PostgreSQL database schema or Redis queue. | 
| **Teammate 3: Core Backend & System Architect** | **Service 3:** Core Business Logic & ESG Generator | Node.js, Express.js / NestJS, Prisma ORM, PDFKit / Puppeteer | Owns the primary REST gateway (`/api/v1`), JWT auth, business logic, and PDF generator. Calls Service 1 and Service 2 via HTTP client or consumes DB schema. | 
| **Teammate 4: Frontend & UI/UX Engineer** | **Module 4:** Interactive Web Dashboard | React 19 / Next.js, Tailwind CSS, TypeScript, Recharts, Zustand | Builds all UI components and visualizations using a mocked JSON fixture file (`mockData.json`) matching Teammate 3's API schema. | 

---

## 3. Deep Developer File & Folder Distribution Matrix

### Teammate 1: AI/ML & Physics Engine Specialist
**Primary Directory:** `/services/ai-engine/`  
**Primary Responsibility:** Building the physical RC thermal circuit differential solver, LightGBM 24-hour forecaster, and SHAP explainability engine inside a standalone FastAPI microservice.

#### Exact Files to Create:
* `/services/ai-engine/main.py` — FastAPI service entry point, CORS config, route initialization.
* `/services/ai-engine/config.py` — Environment settings, model file paths, default thermal parameters.
* `/services/ai-engine/requirements.txt` — Python dependencies (`fastapi`, `uvicorn`, `scipy`, `lightgbm`, `shap`, `numpy`, `pandas`, `pydantic`).
* `/services/ai-engine/models/rc_thermal_model.py` — SciPy ODE solver (`solve_ivp`) implementing the lumped capacitance heat balance equation ($\frac{dT}{dt} = \frac{1}{RC}(T_{out} - T_{in}) + \frac{Q_{hvac}}{C}$).
* `/services/ai-engine/models/load_forecaster.py` — LightGBM model loader and 24-hour baseline energy consumption inference engine.
* `/services/ai-engine/models/shap_explainer.py` — SHAP TreeExplainer calculation logic returning feature importance scores per prediction step.
* `/services/ai-engine/routers/twin_routes.py` — Router for `/api/v1/twin/simulate` handling thermal drift under HVAC throttling.
* `/services/ai-engine/routers/ml_routes.py` — Router for `/api/v1/ml/predict-and-explain` returning energy load and SHAP values.
* `/services/ai-engine/schemas/twin_schema.py` — Pydantic request/response validation objects (`SimulationRequest`, `SimulationResponse`).
* `/services/ai-engine/tests/test_rc_model.py` — PyTest suite validating thermal decay curves and solver execution speed.

---

### Teammate 2: Data Ingestion & API Telemetry Specialist
**Primary Directory:** `/services/ingestion-service/`  
**Primary Responsibility:** Smart meter dataset (CSV/Parquet) validation, external live API queries (Electricity Maps & Weather), dynamic Scope 2 calculation, and DB persistence.

#### Exact Files to Create:
* `/services/ingestion-service/main.py` — FastAPI application setup and background task runners.
* `/services/ingestion-service/requirements.txt` — Dependencies (`fastapi`, `celery`, `redis`, `pandas`, `pyarrow`, `httpx`, `psycopg2-binary`, `sqlalchemy`).
* `/services/ingestion-service/parsers/csv_parser.py` — 15-minute interval CSV reader and schema normalizer for Pecan Street datasets.
* `/services/ingestion-service/parsers/parquet_parser.py` — High-performance Apache Parquet reader using PyArrow.
* `/services/ingestion-service/clients/grid_carbon_client.py` — Async HTTP client (`httpx`) connecting to Electricity Maps / CO2 Signal API.
* `/services/ingestion-service/clients/weather_client.py` — Async HTTP client fetching live ambient temperature and solar irradiance from Open-Meteo.
* `/services/ingestion-service/services/scope2_calculator.py` — Core logic multiplying interval kWh by dynamic grid $\text{gCO}_2\text{e}/\text{kWh}$.
* `/services/ingestion-service/tasks/celery_app.py` — Celery task queue setup for processing heavy multi-megabyte CSV uploads.
* `/services/ingestion-service/routers/upload_routes.py` — Endpoints (`POST /api/v1/ingest/upload`) for file uploads and trigger telemetry ingestion.
* `/services/ingestion-service/db/connection.py` — Direct SQLAlchemy session creation for PostgreSQL persistence.

---

### Teammate 3: Core Backend & System Architect
**Primary Directory:** `/services/core-backend/`  
**Primary Responsibility:** Primary REST API gateway, JWT authentication, PostgreSQL ORM management, Scenario ROI/Abatement calculations, and PDF ESG Audit Report generation.

#### Exact Files to Create:
* `/services/core-backend/src/server.ts` — Express/Nest server entry point, middleware setup, global error handler.
* `/services/core-backend/src/config/env.ts` — Environment variable validation (Database URL, JWT Secrets, Service URLs).
* `/services/core-backend/prisma/schema.prisma` — Database models (`User`, `Facility`, `TelemetryLog`, `ScenarioResult`, `AuditReport`).
* `/services/core-backend/src/controllers/auth.controller.ts` — User registration, login, JWT token issuance.
* `/services/core-backend/src/controllers/scenario.controller.ts` — "What-If" scenario execution handler (solves abatement cost $\$ /\text{tCO}_2\text{e}$ and financial ROI).
* `/services/core-backend/src/controllers/report.controller.ts` — Triggers PDF rendering and streams binary buffers to frontend.
* `/services/core-backend/src/services/ai_service_client.ts` — Axios/Fetch HTTP client invoking Teammate 1's FastAPI microservice.
* `/services/core-backend/src/services/pdf_generator.ts` — PDFKit/Puppeteer document compiler generating audit-ready ESG report templates with tables and charts.
* `/services/core-backend/src/routes/api.router.ts` — Main API routing table aggregating auth, dashboard, scenario, and report endpoints.
* `/services/core-backend/src/middlewares/auth.middleware.ts` — JWT verification and Role-Based Access Control (RBAC).

---

### Teammate 4: Frontend & UI/UX Engineer
**Primary Directory:** `/apps/web-dashboard/`  
**Primary Responsibility:** Next.js / React interactive dashboard, real-time Recharts/Plotly visualizations, Zustand state management, "What-If" scenario sliders, and PDF preview builder.

#### Exact Files to Create:
* `/apps/web-dashboard/package.json` — Frontend dependencies (`next`, `react`, `tailwindcss`, `recharts`, `plotly.js`, `zustand`, `lucide-react`, `axios`).
* `/apps/web-dashboard/src/mocks/mockData.json` — Complete offline JSON fixture mirroring Teammate 3's backend payload for 100% independent frontend development.
* `/apps/web-dashboard/src/store/useDashboardStore.ts` — Zustand store managing active facility, scenario slider states, and simulation outputs.
* `/apps/web-dashboard/src/services/apiClient.ts` — Axios instance with toggle switch between `mockData.json` and production API base URL.
* `/apps/web-dashboard/src/components/charts/EmissionsTimeChart.tsx` — Dual-axis chart comparing static vs. dynamic Scope 2 emissions.
* `/apps/web-dashboard/src/components/charts/ThermalDriftChart.tsx` — Plotly/Recharts line chart rendering indoor vs ambient temperature drift.
* `/apps/web-dashboard/src/components/charts/ShapWaterFallChart.tsx` — Explainable AI feature attribution waterfall visualization.
* `/apps/web-dashboard/src/components/simulator/ScenarioControls.tsx` — Interactive UI sliders for HVAC setback, solar offset %, and load shifting hours.
* `/apps/web-dashboard/src/components/reports/PdfViewerModal.tsx` — Modal previewing generated ESG report PDF prior to downloading.
* `/apps/web-dashboard/src/app/page.tsx` — Main dashboard layout arranging analytics tiles, scenario controls, and navigation header.

---

## 4. Independent Component Contracts & Integration Protocol

To achieve seamless collaboration, the project relies on **3 standardized API Contracts**:

### Protocol 1: ML Engine Interface (Teammate 1 ◄► Teammate 3)
* **Endpoint:** `POST /api/ml/simulate-twin`
* **Request Contract:**
  ```json
  {
    "facility_id": "fac_102",
    "hvac_throttle_percent": 50,
    "simulation_duration_hours": 24,
    "ambient_temperatures": [28.5, 29.0, 31.2, 30.5]
  }
  ```
* **Response Contract:**
  ```json
  {
    "indoor_temp_drift": [21.5, 22.1, 23.0, 22.8],
    "forecasted_kwh": [120.5, 115.0, 140.2, 130.1],
    "shap_attribution": {"ambient_temp": 0.45, "grid_carbon_intensity": 0.35, "occupancy": 0.20}
  }
  ```

### Protocol 2: Telemetry Data Schema (Teammate 2 ◄► Database/Teammate 3)
* **Table Schema / Output Payload (`telemetry_logs`):**
  * `timestamp` (ISO 8601 string)
  * `facility_id` (UUID)
  * `power_consumption_kwh` (Float)
  * `grid_carbon_factor_gco2_kwh` (Float)
  * `ambient_temp_celsius` (Float)
  * `dynamic_scope2_co2e` (Float)

### Protocol 3: Frontend Client Interface (Teammate 3 ◄► Teammate 4)
* **Endpoint:** `GET /api/v1/dashboard/overview`
* Teammate 4 uses `src/mocks/mockData.json` matching this exact JSON schema during UI development so that swapping the URL to Teammate 3's live backend takes under 5 minutes.

---

## 5. Detailed Functional Requirements

### Module 1: Data Ingestion & API Telemetry (Teammate 2)
* **FR-1.1 Standalone Data Parsing:** The ingestion pipeline shall independently parse and validate 15-minute interval smart meter datasets in CSV and Apache Parquet formats without requiring active backend connections.
* **FR-1.2 Dynamic Carbon Telemetry:** The pipeline shall query external grid APIs (Electricity Maps or CO2 Signal) and format response factors ($\text{gCO}_2\text{e}/\text{kWh}$) into standardized JSON.
* **FR-1.3 Weather Telemetry Integration:** The pipeline shall asynchronously fetch weather parameters (temperature, humidity) mapped to facility geocodes.
* **FR-1.4 Scope 2 Calculation:** The ingestion pipeline shall calculate dynamic Scope 2 emissions and persist structured rows directly to PostgreSQL or Redis.

### Module 2: Physics-Informed Digital Twin (Teammate 1)
* **FR-2.1 Thermal Differential Modeling:** The system shall implement a standalone lumped parameter Resistance-Capacitance (RC) thermal model using SciPy (`scipy.integrate.solve_ivp`).
* **FR-2.2 HVAC Power Throttling Simulation:** The twin shall compute room temperature drift ($T_{in}$) under varying HVAC operational states (0%, 50%, 100% throttle) independently via a dedicated FastAPI endpoint.
* **FR-2.3 Pre-Cooling & Load Shifting Simulation:** The model shall return optimal pre-cooling windows based on input temperature arrays.

### Module 3: Predictive AI & Explainable AI (XAI) (Teammate 1)
* **FR-3.1 24-Hour Load Forecasting:** The platform shall execute a LightGBM regressor to output 24-hour load forecasts based on input historical arrays.
* **FR-3.2 Feature Attribution via SHAP:** The ML engine shall generate SHAP feature attributions for every prediction frame.
* **FR-3.3 Operational Optimization Schedule:** The ML module shall output recommended HVAC throttle schedules via structured JSON.

### Module 4: Scenario Engine & ESG Report Automation (Teammate 3)
* **FR-4.1 "What-If" Scenario Engine:** The core backend shall compute abatement costs ($\$ /\text{tCO}_2\text{e}$) and ROI using values retrieved from Service 1 and Service 2.
* **FR-4.2 PDF ESG Audit Report Generation:** The backend shall render downloadable PDF reports from database telemetry and scenario outputs using PDFKit or Puppeteer.
* **FR-4.3 System RBAC & Data Persistence:** The backend shall manage user authentication (JWT) and expose master REST endpoints for the frontend.

### Module 5: Interactive Web Dashboard & Visualization (Teammate 4)
* **FR-5.1 Real-Time Analytics Views:** The UI shall render time-series line charts and dynamic heatmaps powered by Zustand state management.
* **FR-5.2 Scenario Control Interface:** The UI shall provide interactive input controls (sliders, toggles) that dispatch requests to backend scenario endpoints.
* **FR-5.3 Report Customization & Export:** The interface shall render live PDF previews and trigger direct report downloads.

---

## 6. Technical Architecture & Tech Stack

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                   MODULE 4: FRONTEND LAYER (Teammate 4)                      │
│       React 19 / Next.js  |  Tailwind CSS  |  Plotly.js / Recharts           │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ HTTPS / WebSockets / JSON
┌──────────────────────────────────────▼───────────────────────────────────────┐
│                 SERVICE 3: CORE BACKEND LAYER (Teammate 3)                   │
│        Node.js (Express/Nest)  |  Prisma ORM  |  PostgreSQL / Redis          │
└──────────────────┬──────────────────────────────────────────┬────────────────┘
                   │ Internal HTTP REST                       │ Database Writes
┌──────────────────▼─────────────────────────┐  ┌─────────────▼────────────────┐
│ SERVICE 1: AI & PHYSICS ENGINE (Teammate 1)│  │ SERVICE 2: INGESTION PIPELINE  │
│ FastAPI | SciPy | LightGBM & SHAP | Pandas │  │ (Teammate 2) FastAPI | Celery  │
└────────────────────────────────────────────┘  └────────────────────────────────┘
```

* **Frontend:** React 19 / Next.js, Tailwind CSS, TypeScript, Recharts / Plotly.js, Zustand.
* **Core Backend & Gateway:** Node.js (Express.js or NestJS), Prisma ORM, JWT, PDFKit / Puppeteer.
* **Ingestion Pipeline:** FastAPI, Celery, Redis, Pandas, PyArrow.
* **AI, ML & Physics Simulation:** Python 3.10+, SciPy, LightGBM, SHAP, NumPy, FastAPI.
* **Databases:** PostgreSQL (Shared DB instance or Docker image), Redis (Task Queue & Caching).

---

## 7. Integration Roadmap & Collaboration Milestones

To ensure a smooth combined delivery, the team will follow a 4-Phase Integration Strategy:

1. **Phase 1 (Contract & Schema Definition):** Team aligns on JSON field names, OpenAPI specifications, and database schema. Teammate 4 populates `/apps/web-dashboard/src/mocks/mockData.json` based on these contracts.
2. **Phase 2 (Isolated Development):** Each member builds inside their assigned directory (`/services/ai-engine`, `/services/ingestion-service`, `/services/core-backend`, `/apps/web-dashboard`).
3. **Phase 3 (Service Integration):**
   * Teammate 2 connects ingestion outputs to PostgreSQL.
   * Teammate 3 connects Node.js backend to Teammate 1's FastAPI endpoints.
   * Teammate 4 switches `apiClient.ts` base URL from `mockData.json` to Teammate 3's live Node.js gateway.
4. **Phase 4 (End-to-End Validation & PDF Verification):** Full system dry run testing complete scenario flow from raw CSV upload to final PDF report export.

---

## 8. Non-Functional Requirements

* **Performance:** Scenario simulations and physics-informed calculations must complete within $< 1.5 \text{ seconds}$.
* **Scalability:** Asynchronous background queues (Celery + Redis) must process up to $10,000$ telemetry rows/sec.
* **Modularity:** Failure in Service 1 or Service 2 must be gracefully handled by Service 3 using fallback mock/cached responses.
* **Security:** All cross-service HTTP communications must execute over secured private subnet networks or authenticated header keys.