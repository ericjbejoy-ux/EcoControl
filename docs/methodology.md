# CarbonTwin Methodology

Owner: **M1 (AI/ML & Digital Twin)**, reviewer: M2. This document is the audit
trail behind every number CarbonTwin shows. It is written to be defensible to a
technical judge and to an ESG auditor.

---

## 1. Dynamic Scope 2 emissions (location-based, hourly)

Traditional carbon accounting multiplies annual kWh by a single annual-average
grid emission factor. CarbonTwin instead uses the **hourly marginal grid carbon
intensity** (CI), which is the method endorsed by the GHG Protocol Scope 2
*market- vs location-based* guidance and by emerging 24/7 carbon-free-energy
accounting.

For each interval of duration Δt hours:

```
Emissions_kg(t) = Power_kW(t) · Δt · CI_g_per_kWh(t) / 1000
```

At 15-minute resolution Δt = 0.25 h. Summing over a day gives the daily
footprint; the error of static accounting is quantified by comparing against the
annual-average factor (`FR-9`).

**Data sources & fallbacks.** Live CI comes from Electricity Maps / CO₂ Signal.
When the API is unavailable the pipeline serves a cached diurnal profile, and if
no cache exists a **synthetic** profile is generated. Every response is labelled
`live | cached | synthetic` so no one mistakes a fallback for measured data.

---

## 2. Physics-informed Digital Twin (RC model)

We model a building zone as a single lumped **resistor–capacitor** thermal
circuit. This is the standard grey-box representation used in building
simulation (Bacher & Madsen, 2011), chosen because it (a) needs no indoor
sensors, (b) has few identifiable parameters, and (c) runs in milliseconds.

### Governing ODE

```
C · dT_in/dt = (T_out − T_in)/R  +  Q_int  +  Q_solar  −  COP(T_out) · P_hvac · u(t)
```

| Symbol | Meaning | Units |
| --- | --- | --- |
| `T_in`, `T_out` | indoor / outdoor dry-bulb temperature | °C |
| `R` | lumped envelope thermal resistance | °C/kW |
| `C` | lumped thermal capacitance | kWh/°C |
| `Q_int = internal_gain_kw + occupancy_gain_kw·occ` | internal gains | kW |
| `Q_solar = irradiance · aperture_m2 · window_factor / 1000` | solar gains | kW |
| `COP(T_out) = cop_a − cop_b·(T_out − 24)` | heat-pump efficiency | – |
| `u(t) ∈ [0,1]` | HVAC throttle; `P_hvac` is rated electrical input | – |

### Integration

* `POST /twin/simulate` integrates with `scipy.integrate.solve_ivp` (RK45) at a
  **1-minute internal step** with zero-order-held inputs, reported at 15 minutes.
* The MPC optimizer uses an **exact closed-form** update for the
  piecewise-constant linear ODE:
  `T(t+Δt) = T_eq + (T(t) − T_eq)·exp(−Δt/τ)`, with `τ = R·C` and
  `T_eq = T_out + R·(Q_int + Q_solar − COP·P_hvac·u)`.

The two integrators agree to **< 1×10⁻⁴ °C** (asserted in `tests/test_rc_model.py`),
so the fast path used by the optimizer is not an approximation.

### Auto-calibration (no sensors)

`POST /twin/calibrate` fits parameters with bounded `scipy.optimize.least_squares`:

1. **Indoor temperature observed** (pilot sensor / BMS export): fit `R`, `C`,
   `window_factor` so the simulated `T_in` trajectory matches the measured one.
2. **Only power + weather** (the default hardware-free case): assume the space
   tracks its setpoint and invert the steady-state energy balance to obtain the
   implied cooling load, then fit `R`, `window_factor`, `internal_gain_kw` to the
   metered load. Reported as `mape_power`.

Parameters are regularised toward physically sensible priors, and bounds keep the
fit interpretable. When real sensors are added later, they simply improve case 1.

---

## 3. Forecasting

**Target:** 15-minute mean power (kW), horizon 96 steps (24 h). Emissions follow
from the same dynamic Scope 2 identity, so one model drives both.

**Model:** **quantile LightGBM** (q10/q50/q90) → median forecast + 80% prediction
band. If LightGBM is unavailable, scikit-learn's `GradientBoostingRegressor` with
`loss="quantile"` is used; if there is too little data, a **seasonal-naive**
baseline is stored so endpoints never fail.

**Features** (grouped exactly as the explainability rollup):

| Group | Features |
| --- | --- |
| Weather | `temp_out`, `humidity`, `irradiance` |
| Grid carbon | `ci` (current, and forecast horizon values) |
| Time-of-day | `hour_sin/cos`, `minute_of_day`, `dayofweek`, `is_weekend`, `is_holiday` |
| Occupancy | `occupancy` |
| Historical pattern | `lag_1`, `lag_4`, `lag_96`, `lag_672`, rolling mean/std |

**Validation:** strict **time-series hold-out** (no shuffling, no leakage). We
report MAE, RMSE, MAPE and R², plus the empirical coverage of the q10–q90 band.
Target: **MAPE < 12%** on a held-out week for office/campus-type facilities.

---

## 4. Explainable AI

TreeSHAP (`shap.TreeExplainer`) over the q50 model yields exact Shapley values.

* **Global:** mean absolute SHAP per feature, rolled up to the five groups above.
* **Local:** waterfall for any clicked timestamp.
* **NLG:** the top-3 contributions are turned into a sentence, e.g.
  *"Demand 14:15 (forecast 842 kW) is driven 41% by outdoor temperature, 27% by
  grid carbon intensity and 18% by time of day."*

If `shap` is not installed the service returns an *approximation* built from the
model's split importances scaled by standardised feature deviation. The response's
`method` field makes this explicit, and `/health` flags `shap_available=false`.

---

## 5. Carbon-aware optimization (MPC)

Decision variable: the throttle vector `u ∈ [u_min, 1]^N`. Objective:

```
Σ (CI_t / mean_CI) · (P_t / P_rated)          # normalised carbon
+ λ · Σ max(0, T_min − T_t, T_t − T_max)²      # soft comfort violation
+ μ · Σ |u_t − u_{t−1}|                         # throttle smoothness
```

subject to the RC twin dynamics (enforced exactly) and the throttle bounds.
Carbon is normalised so a single default `λ` works across building sizes. Solved
with **SLSQP**; the thermostat "business-as-usual" schedule is both the warm start
and the fallback. Because grid CI is diurnal, the optimizer learns to **pre-cool
when the grid is cleanest** (typically ~04:00) and coast during dirty peaks, all
inside the comfort band (`FR-30`).

---

## 6. Scenario engine & economics

Levers (`§5.6`): HVAC peak shaving, load shifting, rooftop solar, setpoint
relaxation, LED/VFD retrofit, battery storage. Each lever maps a physical change
to energy and emissions deltas using the same CI series.

```
Annual saving ($)        = ΔkWh · tariff
Abatement cost ($/tCO₂e)  = (Annualised CAPEX − Annual saving) / tCO₂e avoided
Payback (yr)             = CAPEX / Annual saving
NPV                      = Σ saving_y / (1+r)^y − CAPEX
```

A negative abatement cost means the measure **pays for itself** (highlighted green
in the MACC). The MACC sorts all levers by abatement cost, width = tCO₂e avoided.

**Assumptions (disclosed):**
* Levers are combined **additively** for the stacking waterfall; interaction
  effects are not modelled. This is optimistic for overlapping HVAC measures and
  is stated in every scenario response's `notes`.
* Annualisation multiplies the modelled horizon to 8760 h; a single-day horizon
  therefore implies ×365. Using a full week of history reduces this assumption.
* Fixed 15-year project life and 8% discount rate by default (configurable).

---

## 7. Anomaly detection

Two complementary signals: a **robust residual z-score** against a seasonal
rolling baseline (median/MAD), and an **Isolation Forest** over `(power, hour)`.
Flagged intervals carry an estimated wasted kgCO₂e = excess kWh × CI / 1000, so
the UI can quantify the opportunity (e.g. "AHU running unoccupied, 18 kgCO₂e").

---

## 8. Reliability & honesty

* Every external dependency has a cache + synthetic fallback; the demo runs
  offline.
* Every ML response reports the **backend actually used** and any approximation.
* Prediction uncertainty is always shown; no point forecast is presented as fact.

## References

* Bacher, P., & Madsen, H. (2011). Identifying suitable models for the heat
  dynamics of buildings. *Energy and Buildings*.
* GHG Protocol Scope 2 Guidance (2015) and 24/7 hourly matching accounting.
* Ke, G. et al. (2017). LightGBM: A highly efficient gradient boosting decision
  tree. *NeurIPS*.
* Lundberg, S., & Lee, S.-I. (2017). A unified approach to interpreting model
  predictions. *NeurIPS*.
