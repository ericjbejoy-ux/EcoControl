"""Pydantic request/response models for the CarbonTwin ML service.

This module is the *single source of truth* for the Python side of the ML
contract. It deliberately mirrors ``packages/shared/src/ml.schemas.ts``
(TypeScript/zod) so M3 (gateway) and M4 (frontend) can consume identical
payload shapes. Keep the two files in lock-step; the ``CONTRACT_VERSION``
bump in either file must be reflected in ``docs/api.md``.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

CONTRACT_VERSION = "2.0.0"

# ---------------------------------------------------------------------------
# Shared primitives
# ---------------------------------------------------------------------------

LeverType = Literal[
    "hvac_peak_shaving",
    "load_shifting",
    "rooftop_solar",
    "setpoint_relaxation",
    "retrofit",
    "battery",
]

DataSource = Literal["live", "cached", "synthetic"]


class SeriesPoint(BaseModel):
    """One interval of a facility's time series (15 min by default)."""

    ts: datetime
    power_kw: float = Field(..., description="Average electrical power over the interval.")
    temp_out: Optional[float] = Field(None, description="Outdoor dry-bulb temperature (°C).")
    temp_in: Optional[float] = Field(None, description="Indoor temperature (°C), if metered.")
    humidity: Optional[float] = Field(None, description="Relative humidity (%).")
    irradiance: Optional[float] = Field(None, description="Global horizontal irradiance (W/m²).")
    ci: Optional[float] = Field(None, description="Grid carbon intensity (gCO₂/kWh).")
    occupancy: Optional[float] = Field(None, description="Occupancy proxy (people or fraction).")

    @field_validator("power_kw")
    @classmethod
    def _non_negative_power(cls, v: float) -> float:
        return max(0.0, float(v))


class TwinParams(BaseModel):
    """Lumped RC thermal parameters. Calibrated by /twin/calibrate."""

    r_envelope: float = Field(
        0.05, gt=0, description="Envelope thermal resistance (°C/kW), i.e. 1/UA."
    )
    c_thermal: float = Field(120.0, gt=0, description="Thermal capacitance (kWh/°C).")
    cop_a: float = Field(4.4, description="COP intercept: COP = cop_a − cop_b·(T_out − 24).")
    cop_b: float = Field(0.06, ge=0, description="COP temperature slope (per °C).")
    window_factor: float = Field(0.35, ge=0, description="Fraction of irradiance admitted as heat.")
    internal_gain_kw: float = Field(30.0, ge=0, description="Baseline internal gains (kW thermal).")
    hvac_rated_kw: float = Field(
        100.0, gt=0, description="Rated electric HVAC input at throttle=1.0 (kW)."
    )
    solar_aperture_m2: float = Field(
        400.0, ge=0, description="Effective glazing aperture for solar gains (m²)."
    )
    occupancy_gain_kw: float = Field(
        40.0, ge=0, description="Additional internal gain at full occupancy (kW thermal)."
    )
    floors: int = Field(1, ge=1, description="Number of (optionally grouped) building zones.")


class ComfortBand(BaseModel):
    min_c: float = 22.0
    max_c: float = 26.0

    @field_validator("max_c")
    @classmethod
    def _ordered(cls, v: float, info) -> float:
        lo = info.data.get("min_c")
        if lo is not None and v < lo:
            raise ValueError("comfort band max_c must be >= min_c")
        return v


# ---------------------------------------------------------------------------
# /ml/train   and   /ml/model-card/:facilityId
# ---------------------------------------------------------------------------

class TrainRequest(BaseModel):
    facility_id: str
    history: list[SeriesPoint]
    model_type: Literal["office", "hospital", "campus", "data_center", "generic"] = "generic"
    horizon: int = Field(96, ge=4, le=672)
    test_fraction: float = Field(0.2, gt=0.05, lt=0.5)


class ModelMetrics(BaseModel):
    mae: Optional[float] = None
    rmse: Optional[float] = None
    mape: Optional[float] = None
    r2: Optional[float] = None
    coverage_p10_p90: Optional[float] = Field(
        None, description="Empirical share of actuals inside the 80% interval."
    )


class TrainResponse(BaseModel):
    facility_id: str
    status: Literal["trained", "trained_fallback", "insufficient_data"]
    backend: str
    n_samples: int
    horizon: int
    metrics: ModelMetrics
    model_version: str
    trained_at: datetime
    top_features: list[str] = Field(default_factory=list)


class ModelCardResponse(BaseModel):
    facility_id: str
    exists: bool
    model_version: Optional[str] = None
    backend: Optional[str] = None
    model_type: Optional[str] = None
    trained_at: Optional[datetime] = None
    n_samples: Optional[int] = None
    horizon: Optional[int] = None
    metrics: Optional[ModelMetrics] = None
    features: list[str] = Field(default_factory=list)
    feature_groups: dict[str, list[str]] = Field(default_factory=dict)
    training_window: Optional[dict[str, Optional[datetime]]] = None
    target: Optional[str] = None
    notes: list[str] = Field(default_factory=list)
    model_card: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# /ml/forecast
# ---------------------------------------------------------------------------

class ForecastRequest(BaseModel):
    facility_id: str
    history: list[SeriesPoint]
    future_weather: list[SeriesPoint] = Field(
        default_factory=list,
        description="Weather/exogenous context for the horizon (ts + temp_out + irradiance + ci).",
    )
    horizon: int = Field(96, ge=1, le=672)
    step_minutes: int = Field(15, ge=1, le=60)
    train_if_missing: bool = True
    model_type: Literal["office", "hospital", "campus", "data_center", "generic"] = "generic"


class ForecastPoint(BaseModel):
    ts: datetime
    power_kw_p10: float
    power_kw_p50: float
    power_kw_p90: float
    emissions_kg_p50: Optional[float] = None
    emissions_kg_p10: Optional[float] = None
    emissions_kg_p90: Optional[float] = None
    ci: Optional[float] = None
    temp_out: Optional[float] = None


class ForecastResponse(BaseModel):
    facility_id: str
    generated_at: datetime
    horizon: int
    step_minutes: int
    model_version: str
    backend: str
    points: list[ForecastPoint]
    metrics: Optional[ModelMetrics] = None
    data_source: DataSource = "synthetic"
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# /ml/explain
# ---------------------------------------------------------------------------

class ExplainRequest(BaseModel):
    facility_id: str
    history: list[SeriesPoint]
    ts: Optional[datetime] = Field(None, description="Timestamp to explain locally.")
    global_explain: bool = Field(True, alias="global")
    top_k: int = Field(6, ge=1, le=50)
    model_type: Literal["office", "hospital", "campus", "data_center", "generic"] = "generic"

    model_config = {"populate_by_name": True}


class FeatureContribution(BaseModel):
    feature: str
    group: str
    value: Optional[float] = None
    shap_value: float
    abs_value: float
    pct: float = Field(..., description="Signed share of total |contribution|, in percent.")
    direction: Literal["increase", "decrease", "neutral"]


class ExplainResponse(BaseModel):
    facility_id: str
    method: str
    backend: str
    base_value: Optional[float] = None
    predicted_power_kw: Optional[float] = None
    explained_ts: Optional[datetime] = None
    global_importance: list[FeatureContribution] = Field(default_factory=list)
    local: list[FeatureContribution] = Field(default_factory=list)
    narrative: Optional[str] = None
    group_rollup: dict[str, float] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# /twin/simulate  and  /twin/calibrate
# ---------------------------------------------------------------------------

class TwinSimulateRequest(BaseModel):
    facility_id: str = "sim"
    initial_temp_in: float = 24.0
    setpoint_c: float = 23.0
    horizon: int = Field(96, ge=1, le=672)
    step_minutes: int = Field(15, ge=1, le=60)
    throttle: float = Field(
        0.7, ge=0, le=1, description="Constant HVAC throttle when throttle_profile is empty."
    )
    throttle_profile: list[float] = Field(
        default_factory=list, description="Optional per-step throttle overrides (0..1)."
    )
    outdoor_temp_c: Optional[float] = Field(
        None, description="Constant outdoor temp when profile is empty."
    )
    outdoor_temp_profile: list[float] = Field(default_factory=list)
    solar_profile: list[float] = Field(default_factory=list, description="Irradiance W/m².")
    occupancy_profile: list[float] = Field(default_factory=list)
    ci_profile: list[float] = Field(default_factory=list, description="gCO₂/kWh per step.")
    comfort: ComfortBand = Field(default_factory=ComfortBand)
    params: TwinParams = Field(default_factory=TwinParams)
    start_ts: Optional[datetime] = None


class TwinPoint(BaseModel):
    ts: Optional[datetime] = None
    temp_in: float
    temp_out: float
    power_kw: float
    cop: float
    cooling_kw: float
    emissions_kg: float
    ci: float
    throttle: float
    comfort_ok: bool


class TwinSimulateResponse(BaseModel):
    facility_id: str
    step_minutes: int
    comfort: ComfortBand
    points: list[TwinPoint]
    params: TwinParams
    energy_kwh: float
    emissions_kg: float
    min_temp_in: float
    max_temp_in: float
    comfort_violation_hours: float
    interpretation: str


class CalibrateRequest(BaseModel):
    facility_id: str
    history: list[SeriesPoint]
    initial_guess: Optional[TwinParams] = None


class CalibrateResponse(BaseModel):
    facility_id: str
    status: Literal["calibrated", "insufficient_data"]
    params: TwinParams
    rmse_c: Optional[float] = None
    mape_power: Optional[float] = None
    n_observations: int
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# /optimize
# ---------------------------------------------------------------------------

class OptimizeRequest(BaseModel):
    facility_id: str = "opt"
    horizon: int = Field(96, ge=4, le=672)
    step_minutes: int = Field(15, ge=1, le=60)
    history_power_kw: list[float] = Field(default_factory=list)
    outdoor_temp_profile: list[float] = Field(default_factory=list)
    solar_profile: list[float] = Field(default_factory=list)
    occupancy_profile: list[float] = Field(default_factory=list)
    ci_profile: list[float] = Field(default_factory=list, description="gCO₂/kWh per step.")
    comfort: ComfortBand = Field(default_factory=ComfortBand)
    initial_temp_in: float = 24.0
    throttle_min: float = Field(0.2, ge=0, le=1)
    lambda_comfort: float = Field(50.0, ge=0, description="Comfort-violation penalty weight.")
    mu_ramp: float = Field(0.05, ge=0, description="Throttle smoothness penalty weight.")
    params: TwinParams = Field(default_factory=TwinParams)
    start_ts: Optional[datetime] = None


class SchedulePoint(BaseModel):
    ts: Optional[datetime] = None
    throttle: float
    power_kw: float
    temp_in: float
    temp_out: float
    ci: float
    emissions_kg: float
    comfort_ok: bool


class OptimizeResponse(BaseModel):
    facility_id: str
    solver: str
    status: Literal["optimal", "feasible", "fallback"]
    schedule: list[SchedulePoint]
    baseline_emissions_kg: float
    optimized_emissions_kg: float
    emissions_saved_kg: float
    emissions_reduction_pct: float
    baseline_energy_kwh: float
    optimized_energy_kwh: float
    comfort_violation_hours: float
    pre_cool_hour: Optional[int] = None
    cleanest_hour: Optional[int] = None
    narrative: str
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# /scenario/evaluate
# ---------------------------------------------------------------------------

class Lever(BaseModel):
    type: LeverType
    params: dict[str, Any] = Field(default_factory=dict)


class ScenarioContext(BaseModel):
    """Optional exogenous context; sensible defaults are synthesized if absent."""

    annual_kwh: Optional[float] = None
    annual_emissions_kg: Optional[float] = None
    peak_kw: Optional[float] = None
    tariff_usd_per_kwh: Optional[float] = None
    ci_g_per_kwh: Optional[float] = None
    horizon: int = Field(96, ge=4, le=672)
    step_minutes: int = Field(15, ge=1, le=60)
    history_power_kw: list[float] = Field(default_factory=list)
    outdoor_temp_profile: list[float] = Field(default_factory=list)
    solar_profile: list[float] = Field(default_factory=list)
    occupancy_profile: list[float] = Field(default_factory=list)
    ci_profile: list[float] = Field(default_factory=list)
    params: TwinParams = Field(default_factory=TwinParams)


class ScenarioKPIs(BaseModel):
    kwh_saved_year: float
    tco2e_avoided_year: float
    cost_saved_year: float
    capex: float
    payback_years: Optional[float] = None
    npv: float
    abatement_cost_per_tco2e: Optional[float] = None
    comfort_violation_hours: float
    emissions_reduction_pct: float
    # P2: keep the raw field names from the SRS sample payload too
    model_config = {"populate_by_name": True}


class LeverResult(BaseModel):
    type: LeverType
    kwh_saved_year: float
    tco2e_avoided_year: float
    cost_saved_year: float
    capex: float
    payback_years: Optional[float] = None
    abatement_cost_per_tco2e: Optional[float] = None
    notes: list[str] = Field(default_factory=list)


class ScenarioSeries(BaseModel):
    baseline_power_kw: list[float] = Field(default_factory=list)
    scenario_power_kw: list[float] = Field(default_factory=list)
    baseline_emissions_kg: list[float] = Field(default_factory=list)
    scenario_emissions_kg: list[float] = Field(default_factory=list)
    temp_in: list[float] = Field(default_factory=list)
    ci: list[float] = Field(default_factory=list)


class ScenarioEvaluateRequest(BaseModel):
    facility_id: str = "scenario"
    levers: list[Lever]
    context: ScenarioContext = Field(default_factory=ScenarioContext)
    comfort: ComfortBand = Field(default_factory=ComfortBand)


class ScenarioEvaluateResponse(BaseModel):
    facility_id: str
    levers: list[LeverResult]
    kpis: ScenarioKPIs
    series: ScenarioSeries
    narrative: str
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# /scenario/macc
# ---------------------------------------------------------------------------

class MaccEntry(BaseModel):
    type: LeverType
    label: str
    tco2e_avoided_year: float
    abatement_cost_per_tco2e: float
    capex: float
    cost_saved_year: float
    payback_years: Optional[float] = None
    profitable: bool


class MaccResponse(BaseModel):
    facility_id: str
    currency: str = "USD"
    total_tco2e_avoided: float
    total_capex: float
    entries: list[MaccEntry]


# ---------------------------------------------------------------------------
# /anomaly/detect
# ---------------------------------------------------------------------------

class AnomalyDetectRequest(BaseModel):
    facility_id: str
    history: list[SeriesPoint]
    expected_power_kw: list[float] = Field(
        default_factory=list, description="Aligned model/forecast expectation (optional)."
    )
    z_threshold: float = Field(3.0, gt=0)
    contamination: float = Field(0.05, gt=0, lt=0.5)
    step_minutes: int = Field(15, ge=1, le=60)
    ci_g_per_kwh: Optional[float] = None


class AnomalyFlag(BaseModel):
    ts: datetime
    severity: Literal["info", "warning", "critical"]
    method: str
    score: float
    observed_kw: float
    expected_kw: Optional[float] = None
    excess_kwh: float
    est_waste_kg_co2e: float
    reason: str


class AnomalyDetectResponse(BaseModel):
    facility_id: str
    method: str
    n_flagged: int
    total_est_waste_kg_co2e: float
    flags: list[AnomalyFlag]
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------

class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    version: str
    contract_version: str
    environment: str
    backend: str
    shap_available: bool
    lightgbm_available: bool
    dependencies: dict[str, bool]
    time: datetime
