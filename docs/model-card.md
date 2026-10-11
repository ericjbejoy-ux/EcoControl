# CarbonTwin Model Card

Owner: **M1 (AI/ML & Digital Twin)**, reviewer: M2. This card follows the spirit
of Mitchell et al. (2019), *Model Cards for Model Reporting*. The live,
per-facility version is served at `GET /ml/model-card/{facility_id}`.

---

## 1. Load forecaster

| Field | Value |
| --- | --- |
| **Task** | Short-term load forecasting |
| **Target** | 15-minute mean electrical power (kW) |
| **Output** | Quantiles q10 / q50 / q90 → median + 80% prediction band |
| **Horizon** | 96 steps (24 h), configurable up to 672 (7 days) |
| **Primary model** | LightGBM, `objective="quantile"`, 400 trees, lr 0.05 |
| **Fallback model** | scikit-learn `GradientBoostingRegressor(loss="quantile")` |
| **Last-resort** | Seasonal-naive (previous-day profile) with residual-std band |
| **Features** | Calendar, weather, grid CI, occupancy, lag/rolling history |
| **Speed** | Train < 5 s for ~1 week of 15-min data; forecast < 1.5 s (NFR-1) |

### Intended use
Estimate near-term facility load and embedded (Scope 2) emissions, and expose
drivers via SHAP. Consumed by the Command Center forecast cone and the Auto-Pilot
optimizer.

### Out-of-scope / not to be used for
* Long-term (seasonal/annual) load projection.
* Safety-critical control without human review.
* Facilities with radically different load behaviour than the training data
  (always check the model card metrics for the specific facility first).

### Metrics (per facility, time-series hold-out)
MAE, RMSE, MAPE, R² and empirical coverage of the q10–q90 band.
Design target: **MAPE < 12%** on a held-out week for office/campus facilities.
Metrics are stored with every persisted model and surfaced in the UI
(Explainability Studio → "model card").

### Training data
Clean 15-minute smart-meter power + weather + grid-CI series supplied by the data
pipeline (M2). Training window and sample count are recorded in each bundle.
No personal data is used; only aggregate energy time-series.

### Limitations
* Recursive multi-step inference compounds error over the horizon; the q10–q90
  band widens accordingly.
* Holiday calendar is a small region-agnostic default set.
* On a freshly uploaded facility with < ~2 days of data, a seasonal-naive
  fallback is used (`status="trained_fallback"`).

### Ethical considerations
No individual-level or PII data. Forecasts are decision support, not automated
control. Uncertainty is always shown so users can judge risk.

---

## 2. RC thermal Digital Twin

| Field | Value |
| --- | --- |
| **Task** | Indoor temperature simulation & counterfactual HVAC control |
| **Model** | Grey-box lumped RC circuit (physics-based) |
| **Parameters** | `R`, `C`, `window_factor`, `internal_gain_kw`, COP curve |
| **Fit** | Bounded `least_squares`, regularised to physical priors |
| **Sensors required** | None (power + weather only); better with indoor temp |

### Intended use
Answer "what happens to comfort and emissions if we throttle HVAC?" without
hardware. Backs the Twin Lab, the pre-cooling story, and the MPC constraint.

### Metrics
* Indoor-temp mode: RMSE in °C between simulated and observed `T_in`.
* Load mode: MAPE between predicted and metered power.
* Numerical validation: RK45 vs closed-form agreement < 1×10⁻⁴ °C.
* Physics sanity: free-floating decay matches the analytic exponential.

### Limitations
* Single lumped zone (multi-zone is a stretch feature with simplified coupling).
* Parameters are effective/lumped, not physical constructions values.
* Assumes well-mixed air; ignores stratification, latent loads and duct losses.

---

## 3. Scenario economics

| Field | Value |
| --- | --- |
| **Task** | Techno-economic evaluation of decarbonisation levers |
| **Outputs** | kWh saved, tCO₂e avoided, $ saved, CAPEX, payback, NPV, $/tCO₂e |
| **Method** | Deterministic energy-balance levers + capital-recovery economics |
| **Assumptions** | Additive lever stacking; 15-yr life; 8% discount (configurable) |

Not a substitute for an engineering-grade investment analysis; use as a
screening tool and document assumptions (see `docs/methodology.md` §6).

---

## 4. Anomaly detector

| Field | Value |
| --- | --- |
| **Task** | Flag wasteful / out-of-pattern consumption |
| **Method** | Robust residual z-score (median/MAD) + Isolation Forest |
| **Output** | Timestamp, severity, score, excess kWh, est. wasted kgCO₂e, reason |

Thresholds (`z_threshold`, `contamination`) are configurable; defaults are tuned
for a 15-minute commercial-building profile.

---

## 5. Reproducibility

* Random seeds fixed (42) for tree models and Isolation Forest.
* Every persisted model bundle carries `trained_at`, feature list, metrics and
  training window.
* Tests: `cd services/ml && pytest -q`.
