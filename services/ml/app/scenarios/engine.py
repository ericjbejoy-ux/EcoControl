"""Scenario engine: assemble context, run levers, produce KPIs + series + MACC.

The engine is intentionally additive across levers so the What-If Studio can
render an honest *stacking waterfall*. Two levers that both cut HVAC energy are
optimistically combined (no interaction term) — this is disclosed in ``notes``
and in ``docs/methodology.md``.
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Any, Optional, Sequence

import numpy as np

from app.config import settings
from app.data_utils import resample_to_step
from app.scenarios import economics
from app.scenarios.levers import (
    DEFAULT_PARAMS,
    LEVER_LABELS,
    LeverContext,
    LeverOutcome,
    evaluate_lever,
)
from app.twin.rc_model import (
    expand_profile,
    simulate_power_to_temperature,
    synth_occupancy_profile,
    synth_outdoor_profile,
    synth_solar_profile,
)


def _default_day_profile(n: int, peak_kw: float = 800.0) -> np.ndarray:
    """Office-style weekday load shape (kW) used when no history is supplied."""
    hours = np.linspace(0, 24, n, endpoint=False)
    occupied = np.clip(np.sin(np.pi * (hours - 7.0) / 12.0), 0.0, None)
    base = 0.35 + 0.65 * occupied
    return base * peak_kw


def _diurnal_ci(n: int) -> np.ndarray:
    """Typical grid CI pattern: dirtier in the evening peak, cleanest ~04:00."""
    hours = np.linspace(0, 24, n, endpoint=False)
    return 480.0 - 160.0 * np.cos(2 * np.pi * (hours - 4.0) / 24.0) + 60.0 * np.sin(
        2 * np.pi * (hours - 19.0) / 24.0
    )


def _context_dict(ctx: Any) -> dict:
    if ctx is None:
        return {}
    if isinstance(ctx, dict):
        return ctx
    if hasattr(ctx, "model_dump"):
        return ctx.model_dump()
    return asdict(ctx)


def build_context(ctx_model: Any = None) -> tuple[LeverContext, dict]:
    """Normalise an optional ScenarioContext into arrays + scalar settings."""
    raw = _context_dict(ctx_model)
    step_minutes = int(raw.get("step_minutes", settings.step_minutes) or settings.step_minutes)
    horizon = int(raw.get("horizon", settings.default_horizon) or settings.default_horizon)

    history = raw.get("history_power_kw") or []
    if history:
        power = resample_to_step(np.asarray(history, dtype=float), horizon)
    else:
        power = _default_day_profile(horizon)

    ci_profile = raw.get("ci_profile") or []
    ci = (
        expand_profile(ci_profile, horizon, 500.0)
        if ci_profile
        else _diurnal_ci(horizon)
    )
    if raw.get("ci_g_per_kwh"):
        ci = np.full(horizon, float(raw["ci_g_per_kwh"]))

    temp_out = (
        expand_profile(raw.get("outdoor_temp_profile") or [], horizon, 30.0)
        if raw.get("outdoor_temp_profile")
        else synth_outdoor_profile(horizon)
    )
    solar = (
        expand_profile(raw.get("solar_profile") or [], horizon, 0.0)
        if raw.get("solar_profile")
        else synth_solar_profile(horizon)
    )
    occ = (
        expand_profile(raw.get("occupancy_profile") or [], horizon, 0.5)
        if raw.get("occupancy_profile")
        else synth_occupancy_profile(horizon)
    )

    hours = horizon * step_minutes / 60.0
    annual_factor = 8760.0 / hours if hours > 0 else 365.0
    tariff = float(raw.get("tariff_usd_per_kwh") or settings.default_tariff_usd_per_kwh)
    ci_avg = float(raw.get("ci_g_per_kwh") or np.mean(ci))

    lever_ctx = LeverContext(
        power_kw=power,
        ci=ci,
        temp_out=temp_out,
        solar=solar,
        occupancy=occ,
        step_minutes=step_minutes,
        annual_factor=annual_factor,
        tariff_usd_per_kwh=tariff,
        ci_avg=ci_avg,
    )
    meta = {
        "horizon": horizon,
        "step_minutes": step_minutes,
        "annual_factor": annual_factor,
        "tariff": tariff,
        "ci_avg": ci_avg,
        "raw": raw,
    }
    return lever_ctx, meta


def _lever_dicts(levers: Sequence[Any]) -> list[dict]:
    out = []
    for lv in levers:
        if isinstance(lv, dict):
            out.append({"type": lv.get("type"), "params": lv.get("params", {})})
        elif hasattr(lv, "model_dump"):
            d = lv.model_dump()
            out.append({"type": d.get("type"), "params": d.get("params", {})})
        else:
            out.append({"type": getattr(lv, "type", None), "params": getattr(lv, "params", {})})
    return out


def _comfort_hours(ctx: LeverContext, meta: dict, levers: Sequence[dict]) -> float:
    """Estimate comfort-band violation from a setpoint-relaxation lever via the twin."""
    relaxation = 0.0
    for lv in levers:
        if lv["type"] == "setpoint_relaxation":
            relaxation += float(lv.get("params", {}).get("deltaC", 1.0))
    if relaxation <= 0:
        return 0.0
    raw = meta["raw"]
    params = raw.get("params") or {}
    p = dict(params) if isinstance(params, dict) else _context_dict(params)
    for key, val in {
        "r_envelope": 0.05,
        "c_thermal": 120.0,
        "cop_a": 4.4,
        "cop_b": 0.06,
        "window_factor": 0.35,
        "internal_gain_kw": 30.0,
        "hvac_rated_kw": 100.0,
        "solar_aperture_m2": 400.0,
        "occupancy_gain_kw": 40.0,
    }.items():
        p.setdefault(key, val)
    setpoint = 23.5 + relaxation
    # Invert energy balance: throttle that holds a relaxed setpoint.
    cooling = np.clip(
        (ctx.temp_out - setpoint) / p["r_envelope"]
        + p["internal_gain_kw"]
        + p["occupancy_gain_kw"] * ctx.occupancy
        + ctx.solar * p["solar_aperture_m2"] * p["window_factor"] / 1000.0,
        0.0,
        None,
    )
    from app.twin.hvac import cop as cop_fn

    cop = np.array([cop_fn(t, p["cop_a"], p["cop_b"]) for t in ctx.temp_out])
    power = cooling / cop
    temp_in = simulate_power_to_temperature(
        power,
        p,
        outdoor_temp_c=ctx.temp_out,
        solar_w_m2=ctx.solar,
        occupancy=ctx.occupancy,
        initial_temp_in=setpoint,
        step_minutes=ctx.step_minutes,
    )
    violations = (temp_in > settings.comfort_max_c + 0.05) | (temp_in < settings.comfort_min_c - 0.05)
    return float(np.sum(violations) * ctx.step_minutes / 60.0)


def _scenario_profiles(
    ctx: LeverContext, levers: Sequence[dict]
) -> tuple[np.ndarray, np.ndarray]:
    """Build (baseline_power, scenario_power) arrays by applying levers in order."""
    baseline = ctx.power_kw.astype(float).copy()
    scenario = baseline.copy()
    energy_scale = 1.0

    for lv in levers:
        t = lv["type"]
        params = {**DEFAULT_PARAMS.get(t, {}), **(lv.get("params") or {})}
        if t == "hvac_peak_shaving":
            cap = float(params.get("capPct", 85.0)) / 100.0 * (np.max(baseline) or 1.0)
            scenario = np.minimum(scenario, cap)
        elif t == "rooftop_solar":
            from app.optimization import solar as solar_mod

            pv = solar_mod.pv_yield_kw(
                ctx.solar, system_kwp=float(params.get("kWp", 250.0)), ambient_c=ctx.temp_out
            )
            scenario = np.clip(scenario - pv, 0.0, None)
        elif t == "battery":
            from app.optimization import battery as battery_mod

            spec = battery_mod.BatterySpec(
                capacity_kwh=float(params.get("capacityKwh", 200.0)),
                power_kw=float(params.get("powerKw", 100.0)),
            )
            res = battery_mod.dispatch(scenario, ctx.ci, step_minutes=ctx.step_minutes, spec=spec)
            scenario = res["grid_kw"]
        elif t == "load_shifting":
            # move energy from dirty to clean windows (shape-only)
            order = np.argsort(ctx.ci)
            hi_steps = order[-max(1, len(order) // 8) :]
            lo_steps = order[: max(1, len(order) // 8)]
            movable = float(np.sum(scenario[hi_steps])) * float(params.get("flexiblePct", 20.0)) / 100.0
            total_lo = float(np.sum(scenario[lo_steps])) or 1.0
            scenario[hi_steps] *= 1.0 - float(params.get("flexiblePct", 20.0)) / 100.0
            scenario[lo_steps] += movable * scenario[lo_steps] / total_lo
        elif t == "setpoint_relaxation":
            delta = float(params.get("deltaC", 1.0))
            frac = 0.45 * float(params.get("savingsPerDegree", 0.06)) * delta
            energy_scale *= 1.0 - frac
        elif t == "retrofit":
            frac = float(params.get("componentShare", 0.35)) * float(
                params.get("reductionPct", 25.0)
            ) / 100.0
            energy_scale *= 1.0 - frac

    scenario = np.clip(scenario * energy_scale, 0.0, None)
    return baseline, scenario


def evaluate_scenario(
    levers: Sequence[Any],
    context: Any = None,
) -> dict:
    ctx, meta = build_context(context)
    lever_dicts = _lever_dicts(levers)

    outcomes: list[tuple[dict, LeverOutcome]] = []
    for lv in lever_dicts:
        outcome = evaluate_lever(lv["type"], ctx, lv.get("params"))
        outcomes.append((lv, outcome))

    kwh_saved = float(sum(o.kwh_saved_year for _, o in outcomes))
    tco2e = float(sum(o.tco2e_avoided_year for _, o in outcomes))
    cost_saved = float(sum(o.cost_saved_year for _, o in outcomes))
    capex = float(sum(o.capex for _, o in outcomes))

    years = settings.default_project_years
    discount = settings.default_discount_rate
    annualized = economics.annualized_capex(capex, years, discount)
    payback = economics.payback_years(capex, cost_saved)
    npv = economics.npv(capex, cost_saved, years, discount)
    abatement = economics.abatement_cost_per_tco2e(annualized, cost_saved, tco2e)

    baseline_kwh_year = float(np.sum(ctx.power_kw) * ctx.step_minutes / 60.0) * meta["annual_factor"]
    baseline_tco2e = economics.emissions_tco2e(baseline_kwh_year, ctx.ci_avg)
    reduction_pct = 100.0 * tco2e / baseline_tco2e if baseline_tco2e > 0 else 0.0
    comfort_hours = _comfort_hours(ctx, meta, lever_dicts)

    lever_results = []
    for lv, o in outcomes:
        ann = economics.annualized_capex(o.capex, years, discount)
        lever_results.append(
            {
                "type": lv["type"],
                "kwh_saved_year": round(o.kwh_saved_year, 2),
                "tco2e_avoided_year": round(o.tco2e_avoided_year, 4),
                "cost_saved_year": round(o.cost_saved_year, 2),
                "capex": round(o.capex, 2),
                "payback_years": (
                    round(economics.payback_years(o.capex, o.cost_saved_year), 2)
                    if economics.payback_years(o.capex, o.cost_saved_year) is not None
                    else None
                ),
                "abatement_cost_per_tco2e": (
                    round(economics.abatement_cost_per_tco2e(ann, o.cost_saved_year, o.tco2e_avoided_year), 2)
                    if economics.abatement_cost_per_tco2e(ann, o.cost_saved_year, o.tco2e_avoided_year)
                    is not None
                    else None
                ),
                "notes": o.notes,
            }
        )

    baseline_power, scenario_power = _scenario_profiles(ctx, lever_dicts)
    step_h = ctx.step_minutes / 60.0
    baseline_emissions = baseline_power * step_h * ctx.ci / 1000.0
    scenario_emissions = scenario_power * step_h * ctx.ci / 1000.0

    params = meta["raw"].get("params") or {}
    p = dict(params) if isinstance(params, dict) else _context_dict(params)
    for key, val in {
        "r_envelope": 0.05,
        "c_thermal": 120.0,
        "cop_a": 4.4,
        "cop_b": 0.06,
        "window_factor": 0.35,
        "internal_gain_kw": 30.0,
        "hvac_rated_kw": 100.0,
        "solar_aperture_m2": 400.0,
        "occupancy_gain_kw": 40.0,
    }.items():
        p.setdefault(key, val)
    temp_in = simulate_power_to_temperature(
        scenario_power,
        p,
        outdoor_temp_c=ctx.temp_out,
        solar_w_m2=ctx.solar,
        occupancy=ctx.occupancy,
        initial_temp_in=24.0,
        step_minutes=ctx.step_minutes,
    )

    from app.xai import nlg

    kpis = {
        "kwh_saved_year": round(kwh_saved, 2),
        "tco2e_avoided_year": round(tco2e, 4),
        "cost_saved_year": round(cost_saved, 2),
        "capex": round(capex, 2),
        "payback_years": round(payback, 2) if payback is not None else None,
        "npv": round(npv, 2),
        "abatement_cost_per_tco2e": round(abatement, 2) if abatement is not None else None,
        "comfort_violation_hours": round(comfort_hours, 2),
        "emissions_reduction_pct": round(reduction_pct, 2),
        # camelCase aliases for the SRS sample payload
        "kwhSavedYear": round(kwh_saved, 2),
        "tco2eAvoidedYear": round(tco2e, 4),
        "costSavedYear": round(cost_saved, 2),
        "paybackYears": round(payback, 2) if payback is not None else None,
        "abatementCostPerTco2e": round(abatement, 2) if abatement is not None else None,
    }

    return {
        "facility_id": meta["raw"].get("facility_id", "scenario"),
        "levers": lever_results,
        "kpis": kpis,
        "series": {
            "baseline_power_kw": [round(v, 3) for v in baseline_power],
            "scenario_power_kw": [round(v, 3) for v in scenario_power],
            "baseline_emissions_kg": [round(v, 4) for v in baseline_emissions],
            "scenario_emissions_kg": [round(v, 4) for v in scenario_emissions],
            "temp_in": [round(v, 3) for v in temp_in],
            "ci": [round(v, 2) for v in ctx.ci],
        },
        "narrative": nlg.scenario_narrative(kpis, len(lever_results)),
        "notes": [
            "Levers are combined additively for the stacking waterfall; "
            "interaction effects are not modelled.",
            f"Annualisation factor {meta['annual_factor']:.1f}× from a "
            f"{meta['horizon']}-step horizon.",
        ],
    }


def build_macc(context: Any = None, lever_requests: Optional[Sequence[Any]] = None) -> dict:
    ctx, meta = build_context(context)
    if lever_requests:
        requests = _lever_dicts(lever_requests)
    else:
        requests = [{"type": t, "params": {}} for t in DEFAULT_PARAMS]

    years = settings.default_project_years
    discount = settings.default_discount_rate
    entries = []
    for lv in requests:
        outcome = evaluate_lever(lv["type"], ctx, lv.get("params"))
        ann = economics.annualized_capex(outcome.capex, years, discount)
        abatement = economics.abatement_cost_per_tco2e(
            ann, outcome.cost_saved_year, outcome.tco2e_avoided_year
        )
        if abatement is None:
            continue
        entries.append(
            {
                "type": lv["type"],
                "label": LEVER_LABELS.get(lv["type"], lv["type"]),
                "tco2e_avoided_year": round(outcome.tco2e_avoided_year, 4),
                "abatement_cost_per_tco2e": round(abatement, 2),
                "capex": round(outcome.capex, 2),
                "cost_saved_year": round(outcome.cost_saved_year, 2),
                "payback_years": (
                    round(economics.payback_years(outcome.capex, outcome.cost_saved_year), 2)
                    if economics.payback_years(outcome.capex, outcome.cost_saved_year) is not None
                    else None
                ),
                "profitable": abatement < 0,
            }
        )

    entries.sort(key=lambda e: e["abatement_cost_per_tco2e"])
    return {
        "facility_id": meta["raw"].get("facility_id", "scenario"),
        "currency": "USD",
        "total_tco2e_avoided": round(sum(e["tco2e_avoided_year"] for e in entries), 4),
        "total_capex": round(sum(e["capex"] for e in entries), 2),
        "entries": entries,
    }
