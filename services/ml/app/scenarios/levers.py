"""Scenario levers — the six decarbonisation measures in the SRS §5.6.

Each lever is a pure function ``(ctx, params) -> LeverOutcome`` and is evaluated
independently (for the MACC) or stacked (for the What-If Studio). Levers never
mutate the shared context.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import numpy as np

from app.optimization import battery as battery_mod
from app.optimization import solar as solar_mod
from app.scenarios.economics import emissions_kg, emissions_tco2e

SOLAR_CAPEX_PER_KWP = 900.0
BATTERY_CAPEX_PER_KWH = 450.0
DEFAULT_HVAC_SHARE = 0.45
DEFAULT_LIGHTING_MOTOR_SHARE = 0.35
DEFAULT_SAVINGS_PER_DEGREE = 0.06  # ~6% HVAC energy per °C of setpoint relaxation


@dataclass
class LeverContext:
    power_kw: np.ndarray
    ci: np.ndarray
    temp_out: np.ndarray
    solar: np.ndarray
    occupancy: np.ndarray
    step_minutes: int
    annual_factor: float
    tariff_usd_per_kwh: float
    ci_avg: float
    hvac_share: float = DEFAULT_HVAC_SHARE


@dataclass
class LeverOutcome:
    kwh_saved_year: float
    tco2e_avoided_year: float
    cost_saved_year: float
    capex: float
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Individual levers
# ---------------------------------------------------------------------------

def hvac_peak_shaving(ctx: LeverContext, params: dict) -> LeverOutcome:
    cap_pct = float(params.get("capPct", 85.0)) / 100.0
    peak = float(np.max(ctx.power_kw)) or 1.0
    cap = cap_pct * peak
    excess = np.clip(ctx.power_kw - cap, 0.0, None)
    kwh_horizon = float(np.sum(excess) * ctx.step_minutes / 60.0)
    kwh_year = kwh_horizon * ctx.annual_factor
    tco2e = emissions_tco2e(kwh_year, ctx.ci_avg)
    cost = kwh_year * ctx.tariff_usd_per_kwh
    return LeverOutcome(
        kwh_saved_year=kwh_year,
        tco2e_avoided_year=tco2e,
        cost_saved_year=cost,
        capex=0.0,
        notes=[f"HVAC/total load capped at {cap_pct*100:.0f}% of {peak:.0f} kW peak."],
    )


def load_shifting(ctx: LeverContext, params: dict) -> LeverOutcome:
    flexible_pct = float(params.get("flexiblePct", 20.0)) / 100.0
    total_kwh = float(np.sum(ctx.power_kw) * ctx.step_minutes / 60.0)
    flex_kwh = flexible_pct * total_kwh
    ci = ctx.ci
    if len(ci) >= 4:
        hi = float(np.mean(np.sort(ci)[-max(1, len(ci) // 4) :]))
        lo = float(np.mean(np.sort(ci)[: max(1, len(ci) // 4)]))
    else:
        hi, lo = float(np.max(ci)), float(np.min(ci))
    delta_ci = max(0.0, hi - lo)
    saved_kg_horizon = flex_kwh * delta_ci / 1000.0
    kwh_year = flex_kwh * ctx.annual_factor
    tco2e = saved_kg_horizon * ctx.annual_factor / 1000.0
    return LeverOutcome(
        kwh_saved_year=0.0,
        tco2e_avoided_year=tco2e,
        cost_saved_year=0.0,
        capex=0.0,
        notes=[
            f"Shift {flexible_pct*100:.0f}% of load from high-CI "
            f"({hi:.0f}) to low-CI ({lo:.0f}) g/kWh windows; {kwh_year:,.0f} kWh/yr moved."
        ],
    )


def rooftop_solar(ctx: LeverContext, params: dict) -> LeverOutcome:
    kwp = float(params.get("kWp", 250.0))
    pv = solar_mod.pv_yield_kw(ctx.solar, system_kwp=kwp, ambient_c=ctx.temp_out)
    pv_kwh_horizon = float(np.sum(pv) * ctx.step_minutes / 60.0)
    pv_kwh_year = pv_kwh_horizon * ctx.annual_factor
    # emissions avoided valued at the CI of the displaced grid energy
    tco2e = emissions_tco2e(pv_kwh_year, ctx.ci_avg)
    cost = pv_kwh_year * ctx.tariff_usd_per_kwh
    return LeverOutcome(
        kwh_saved_year=pv_kwh_year,
        tco2e_avoided_year=tco2e,
        cost_saved_year=cost,
        capex=kwp * SOLAR_CAPEX_PER_KWP,
        notes=[f"{kwp:.0f} kWp PV, ~{pv_kwh_year:,.0f} kWh/yr clean generation."],
    )


def setpoint_relaxation(ctx: LeverContext, params: dict) -> LeverOutcome:
    delta_c = float(params.get("deltaC", 1.0))
    per_c = float(params.get("savingsPerDegree", DEFAULT_SAVINGS_PER_DEGREE))
    total_kwh = float(np.sum(ctx.power_kw) * ctx.step_minutes / 60.0) * ctx.annual_factor
    hvac_kwh = total_kwh * ctx.hvac_share
    saved = hvac_kwh * per_c * delta_c
    tco2e = emissions_tco2e(saved, ctx.ci_avg)
    cost = saved * ctx.tariff_usd_per_kwh
    return LeverOutcome(
        kwh_saved_year=saved,
        tco2e_avoided_year=tco2e,
        cost_saved_year=cost,
        capex=0.0,
        notes=[f"+{delta_c:.1f} °C setpoint relaxation at ~{per_c*100:.0f}% HVAC energy/°C."],
    )


def retrofit(ctx: LeverContext, params: dict) -> LeverOutcome:
    reduction_pct = float(params.get("reductionPct", 25.0)) / 100.0
    share = float(params.get("componentShare", DEFAULT_LIGHTING_MOTOR_SHARE))
    capex_per_kwh = float(params.get("capexPerKwhSaved", 0.35))
    total_kwh = float(np.sum(ctx.power_kw) * ctx.step_minutes / 60.0) * ctx.annual_factor
    saved = total_kwh * share * reduction_pct
    tco2e = emissions_tco2e(saved, ctx.ci_avg)
    cost = saved * ctx.tariff_usd_per_kwh
    return LeverOutcome(
        kwh_saved_year=saved,
        tco2e_avoided_year=tco2e,
        cost_saved_year=cost,
        capex=saved * capex_per_kwh,
        notes=[f"LED/VFD retrofit: {reduction_pct*100:.0f}% of the {share*100:.0f}% lighting+motor share."],
    )


def battery(ctx: LeverContext, params: dict) -> LeverOutcome:
    capacity = float(params.get("capacityKwh", 200.0))
    power = float(params.get("powerKw", 100.0))
    spec = battery_mod.BatterySpec(capacity_kwh=capacity, power_kw=power)
    result = battery_mod.dispatch(
        ctx.power_kw, ctx.ci, step_minutes=ctx.step_minutes, spec=spec
    )
    tco2e = float(result["emissions_saved_kg"]) * ctx.annual_factor / 1000.0
    # demand-charge / arbitrage value proxy
    cost = power * float(params.get("annualDemandChargeUsdPerKw", 120.0))
    return LeverOutcome(
        kwh_saved_year=0.0,
        tco2e_avoided_year=tco2e,
        cost_saved_year=cost,
        capex=capacity * BATTERY_CAPEX_PER_KWH,
        notes=[
            f"{capacity:.0f} kWh / {power:.0f} kW battery, charge≤{result['charge_threshold_ci']:.0f} "
            f"g/kWh, discharge≥{result['discharge_threshold_ci']:.0f} g/kWh."
        ],
    )


LEVERS: dict[str, Callable[[LeverContext, dict], LeverOutcome]] = {
    "hvac_peak_shaving": hvac_peak_shaving,
    "load_shifting": load_shifting,
    "rooftop_solar": rooftop_solar,
    "setpoint_relaxation": setpoint_relaxation,
    "retrofit": retrofit,
    "battery": battery,
}

LEVER_LABELS = {
    "hvac_peak_shaving": "HVAC peak shaving",
    "load_shifting": "Load shifting",
    "rooftop_solar": "Rooftop solar",
    "setpoint_relaxation": "Setpoint relaxation",
    "retrofit": "LED/VFD retrofit",
    "battery": "Battery storage",
}

DEFAULT_PARAMS: dict[str, dict] = {
    "hvac_peak_shaving": {"capPct": 85.0},
    "load_shifting": {"flexiblePct": 20.0},
    "rooftop_solar": {"kWp": 250.0},
    "setpoint_relaxation": {"deltaC": 1.0},
    "retrofit": {"reductionPct": 25.0, "componentShare": 0.35},
    "battery": {"capacityKwh": 200.0, "powerKw": 100.0},
}


def evaluate_lever(lever_type: str, ctx: LeverContext, params: Optional[dict] = None) -> LeverOutcome:
    fn = LEVERS.get(lever_type)
    if fn is None:
        raise ValueError(f"Unknown lever type: {lever_type}")
    merged = {**DEFAULT_PARAMS.get(lever_type, {}), **(params or {})}
    return fn(ctx, merged)
