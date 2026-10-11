"""Carbon-aware HVAC optimizer (Model Predictive Control, single zone).

Decision variable: the throttle vector ``u ∈ [u_min, 1]^N``.

Objective (minimise)::

    Σ (CI_t / mean_CI) · (P_t / P_rated)          # normalised carbon
  + λ · Σ max(0, T_min − T_t, T_t − T_max)²       # soft comfort violation
  + μ · Σ |u_t − u_{t−1}|                          # throttle smoothness

subject to the RC twin dynamics (enforced exactly by the closed-form update)
and ``u_min ≤ u_t ≤ 1``. Solved with SLSQP; the thermostat "business as usual"
schedule is the warm start and the fallback if the solver fails.

Why normalise carbon? It keeps the comfort penalty scale-independent of building
size, so the same default λ works for a 60 kW zone and a 1 MW campus.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta
from typing import Any, Optional, Sequence

import numpy as np
from scipy.optimize import minimize

from app.twin.hvac import cop as cop_fn
from app.twin.rc_model import (
    TwinInputs,
    expand_profile,
    simulate_fast,
    synth_occupancy_profile,
    synth_outdoor_profile,
    synth_solar_profile,
)


def _params_dict(params: Any) -> dict:
    if isinstance(params, dict):
        return params
    if hasattr(params, "model_dump"):
        return params.model_dump()
    return asdict(params)


def _solar_kw(solar_w_m2: float, aperture: float, window_factor: float) -> float:
    return solar_w_m2 * aperture * window_factor / 1000.0


def build_inputs(
    *,
    horizon: int,
    step_minutes: int,
    outdoor_temp_profile: Sequence[float],
    solar_profile: Sequence[float],
    occupancy_profile: Sequence[float],
    ci_profile: Sequence[float],
    throttle: Optional[np.ndarray] = None,
) -> TwinInputs:
    return TwinInputs(
        outdoor_temp_c=expand_profile(outdoor_temp_profile, horizon, 30.0)
        if outdoor_temp_profile
        else synth_outdoor_profile(horizon),
        solar_w_m2=expand_profile(solar_profile, horizon, 0.0)
        if solar_profile
        else synth_solar_profile(horizon),
        occupancy=expand_profile(occupancy_profile, horizon, 0.5)
        if occupancy_profile
        else synth_occupancy_profile(horizon),
        ci_g_per_kwh=expand_profile(ci_profile, horizon, 500.0),
        throttle=throttle if throttle is not None else np.full(horizon, 0.7),
    )


def thermostat_throttle(
    inputs: TwinInputs,
    params: dict,
    *,
    initial_temp_in: float,
    setpoint_c: float,
    throttle_min: float,
    step_minutes: int,
) -> np.ndarray:
    """Perfect-tracking baseline controller: hold the setpoint every step."""
    r = params["r_envelope"]
    c = params["c_thermal"]
    a, b = params["cop_a"], params["cop_b"]
    rated = params["hvac_rated_kw"]
    int_gain = params["internal_gain_kw"]
    occ_gain = params["occupancy_gain_kw"]
    aperture = params["solar_aperture_m2"]
    wf = params["window_factor"]

    n = inputs.n_steps
    step_h = step_minutes / 60.0
    decay = float(np.exp(-step_h / (r * c)))
    denom = 1.0 - decay

    u = np.empty(n)
    t_in = float(initial_temp_in)
    for k in range(n):
        t_out = float(inputs.outdoor_temp_c[k])
        cp = cop_fn(t_out, a, b)
        q_other = int_gain + occ_gain * float(inputs.occupancy[k]) + _solar_kw(
            float(inputs.solar_w_m2[k]), aperture, wf
        )
        t_eq_star = setpoint_c if denom < 1e-9 else (setpoint_c - t_in * decay) / denom
        q_cool = q_other + (t_out - t_eq_star) / r
        uk = q_cool / (cp * rated)
        uk = float(min(1.0, max(throttle_min, uk)))
        u[k] = uk

        q_cool_actual = cp * rated * uk
        t_eq = t_out + r * (q_other - q_cool_actual)
        t_in = t_eq + (t_in - t_eq) * decay
    return u


def optimize(
    *,
    horizon: int,
    step_minutes: int,
    params: Any,
    comfort_min_c: float,
    comfort_max_c: float,
    initial_temp_in: float,
    throttle_min: float = 0.2,
    lambda_comfort: float = 50.0,
    mu_ramp: float = 0.05,
    outdoor_temp_profile: Sequence[float] = (),
    solar_profile: Sequence[float] = (),
    occupancy_profile: Sequence[float] = (),
    ci_profile: Sequence[float] = (),
    history_power_kw: Sequence[float] = (),
    start_ts: Optional[datetime] = None,
    max_iter: int = 200,
) -> dict:
    p = _params_dict(params)
    baseline_inputs = build_inputs(
        horizon=horizon,
        step_minutes=step_minutes,
        outdoor_temp_profile=outdoor_temp_profile,
        solar_profile=solar_profile,
        occupancy_profile=occupancy_profile,
        ci_profile=ci_profile,
    )
    ci = baseline_inputs.ci_g_per_kwh

    # Warm start / fallback = thermostat baseline.
    base_u = thermostat_throttle(
        baseline_inputs,
        p,
        initial_temp_in=initial_temp_in,
        setpoint_c=0.5 * (comfort_min_c + comfort_max_c),
        throttle_min=throttle_min,
        step_minutes=step_minutes,
    )
    base_res = simulate_fast(
        TwinInputs(
            outdoor_temp_c=baseline_inputs.outdoor_temp_c,
            solar_w_m2=baseline_inputs.solar_w_m2,
            occupancy=baseline_inputs.occupancy,
            ci_g_per_kwh=ci,
            throttle=base_u,
        ),
        p,
        initial_temp_in=initial_temp_in,
        step_minutes=step_minutes,
    )

    if history_power_kw and len(history_power_kw) == horizon:
        baseline_power = np.asarray(history_power_kw, dtype=float)
    else:
        baseline_power = base_res.power_kw
    step_h = step_minutes / 60.0
    baseline_emissions = baseline_power * step_h * ci / 1000.0
    baseline_energy = float(np.sum(baseline_power) * step_h)

    mean_ci = float(np.mean(ci)) if np.any(ci > 0) else 1.0
    rated = float(p["hvac_rated_kw"])

    def simulate_u(u_vec: np.ndarray):
        return simulate_fast(
            TwinInputs(
                outdoor_temp_c=baseline_inputs.outdoor_temp_c,
                solar_w_m2=baseline_inputs.solar_w_m2,
                occupancy=baseline_inputs.occupancy,
                ci_g_per_kwh=ci,
                throttle=np.clip(u_vec, 0.0, 1.0),
            ),
            p,
            initial_temp_in=initial_temp_in,
            step_minutes=step_minutes,
        )

    def objective(x: np.ndarray) -> float:
        res = simulate_u(x)
        carbon = float(np.sum((ci / mean_ci) * (res.power_kw / max(rated, 1e-6))))
        viol = np.maximum(0.0, comfort_min_c - res.temp_in) + np.maximum(
            0.0, res.temp_in - comfort_max_c
        )
        ramp = float(np.sum(np.abs(np.diff(x)))) if len(x) > 1 else 0.0
        return carbon + lambda_comfort * float(np.sum(viol**2)) + mu_ramp * ramp

    bounds = [(throttle_min, 1.0)] * horizon
    status = "optimal"
    solver = "SLSQP"
    try:
        result = minimize(
            objective,
            base_u,
            method="SLSQP",
            bounds=bounds,
            options={"maxiter": max_iter, "ftol": 1e-6, "disp": False},
        )
        opt_u = np.clip(result.x, throttle_min, 1.0)
        if not result.success and objective(opt_u) > objective(base_u):
            opt_u = base_u
            status = "feasible"
    except Exception:  # noqa: BLE001
        opt_u = base_u
        status = "fallback"
        solver = "thermostat_fallback"

    opt_res = simulate_u(opt_u)
    opt_emissions = opt_res.emissions_kg
    opt_energy = float(np.sum(opt_res.power_kw) * step_h)

    total_base = float(np.sum(baseline_emissions))
    total_opt = float(np.sum(opt_emissions))
    saved = total_base - total_opt
    reduction = 100.0 * saved / total_base if total_base > 0 else 0.0

    viol = np.maximum(0.0, comfort_min_c - opt_res.temp_in) + np.maximum(
        0.0, opt_res.temp_in - comfort_max_c
    )
    comfort_violation_hours = float(np.sum(viol > 0.01) * step_minutes / 60.0)

    # Story hour: where did we add the most cooling (pre-cool) vs baseline?
    delta = opt_u - base_u
    pre_cool_step = int(np.argmax(delta)) if np.any(delta > 0.02) else None
    cleanest_step = int(np.argmin(ci))
    base = start_ts or datetime(2025, 1, 1)

    schedule = []
    for k in range(horizon):
        schedule.append(
            {
                "ts": base + timedelta(minutes=step_minutes * k),
                "throttle": round(float(opt_u[k]), 4),
                "power_kw": round(float(opt_res.power_kw[k]), 3),
                "temp_in": round(float(opt_res.temp_in[k]), 3),
                "temp_out": round(float(baseline_inputs.outdoor_temp_c[k]), 3),
                "ci": round(float(ci[k]), 2),
                "emissions_kg": round(float(opt_emissions[k]), 5),
                "comfort_ok": bool(comfort_min_c - 0.05 <= opt_res.temp_in[k] <= comfort_max_c + 0.05),
            }
        )

    return {
        "solver": solver,
        "status": status,
        "schedule": schedule,
        "baseline_emissions_kg": round(total_base, 4),
        "optimized_emissions_kg": round(total_opt, 4),
        "emissions_saved_kg": round(saved, 4),
        "emissions_reduction_pct": round(reduction, 2),
        "baseline_energy_kwh": round(baseline_energy, 3),
        "optimized_energy_kwh": round(opt_energy, 3),
        "comfort_violation_hours": round(comfort_violation_hours, 3),
        "pre_cool_hour": (
            (pre_cool_step * step_minutes // 60) if pre_cool_step is not None else None
        ),
        "cleanest_hour": cleanest_step * step_minutes // 60,
        "baseline_throttle": [round(float(v), 4) for v in base_u],
    }
