"""RC twin auto-calibration from historical load + weather via SciPy least_squares.

Two regimes are supported, matching the "no sensors" value proposition:

1. **Indoor temperature observed** (best case, real BMS export or a pilot
   sensor): fit ``R``, ``C`` and the solar ``window_factor`` so the simulated
   indoor temperature trajectory matches the measured one.

2. **Only power + weather** (the default, hardware-free case): the space is
   assumed to track its setpoint, so the *required* cooling load can be
   inferred from the steady-state energy balance. We then fit ``R``,
   ``window_factor`` and ``internal_gain_kw`` so predicted HVAC electric load
   matches the metered load. This is the "implied cooling load proxy" of the
   SRS (§5.1).

The fit is bounded and regularised toward the initial guess to stay physical.
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Any, Optional, Sequence

import numpy as np
from scipy.optimize import least_squares

from app.data_utils import series_to_arrays
from app.twin.hvac import cop as cop_fn
from app.twin.rc_model import simulate_power_to_temperature

# Parameter → (lower, upper) bounds for the least-squares fit.
BOUNDS = {
    "r_envelope": (0.01, 2.0),
    "c_thermal": (10.0, 500.0),
    "window_factor": (0.0, 1.0),
    "internal_gain_kw": (0.0, 200.0),
}

REGULARISATION_WEIGHT = 0.15
MIN_OBSERVATIONS = 48  # at least half a day of 15-min data


def _default_params() -> dict:
    return {
        "r_envelope": 0.05,
        "c_thermal": 120.0,
        "cop_a": 4.4,
        "cop_b": 0.06,
        "window_factor": 0.35,
        "internal_gain_kw": 30.0,
        "hvac_rated_kw": 100.0,
        "solar_aperture_m2": 400.0,
        "occupancy_gain_kw": 40.0,
        "floors": 1,
    }


def _merge_guess(initial_guess: Optional[Any]) -> dict:
    params = _default_params()
    if initial_guess is None:
        return params
    guess = initial_guess if isinstance(initial_guess, dict) else asdict(initial_guess)
    params.update({k: float(v) for k, v in guess.items() if v is not None})
    return params


def _clip(value: float, lo: float, hi: float) -> float:
    return float(min(hi, max(lo, value)))


def calibrate(
    history: Sequence[Any],
    *,
    initial_guess: Optional[Any] = None,
    step_minutes: int = 15,
) -> dict:
    """Return a dict with fitted params + fit quality. See module docstring."""
    params = _merge_guess(initial_guess)
    arrays = series_to_arrays(history, step_minutes=step_minutes)
    power = arrays["power_kw"]
    n = len(power)

    notes: list[str] = []
    if n < MIN_OBSERVATIONS:
        return {
            "status": "insufficient_data",
            "params": params,
            "rmse_c": None,
            "mape_power": None,
            "n_observations": n,
            "notes": [f"Need >= {MIN_OBSERVATIONS} intervals; got {n}. Returning defaults."],
        }

    temp_out = arrays["temp_out"]
    solar = arrays["irradiance"]
    occupancy = arrays["occupancy"]
    temp_in_obs = arrays["temp_in"]
    has_temp_in = temp_in_obs.size == n

    # Fixed (non-fitted) params.
    fixed = {k: params[k] for k in ("cop_a", "cop_b", "hvac_rated_kw", "solar_aperture_m2", "occupancy_gain_kw")}

    # Nominal HVAC load scale for normalising residuals.
    scale = float(np.median(power[power > 0])) if np.any(power > 0) else 1.0
    scale = max(scale, 1e-3)

    if has_temp_in:
        tune = ["r_envelope", "c_thermal", "window_factor"]
        x0 = np.array([params[k] for k in tune], dtype=float)

        def residual(x: np.ndarray) -> np.ndarray:
            p = {**fixed, **{tune[i]: x[i] for i in range(len(tune))}}
            predicted = simulate_power_to_temperature(
                power,
                p,
                outdoor_temp_c=temp_out,
                solar_w_m2=solar,
                occupancy=occupancy,
                initial_temp_in=float(temp_in_obs[0]),
                step_minutes=step_minutes,
            )
            model_res = predicted - temp_in_obs
            reg = REGULARISATION_WEIGHT * (x - x0) / np.maximum(np.abs(x0), 1e-3)
            return np.concatenate([model_res, reg])

    else:
        notes.append(
            "No indoor temperature series supplied — calibrated on the implied "
            "cooling-load proxy (space assumed to track setpoint)."
        )
        # Assume space tracks a mild setpoint; infer cooling load from power.
        setpoint = 23.5
        tune = ["r_envelope", "window_factor", "internal_gain_kw"]
        x0 = np.array([params[k] for k in tune], dtype=float)

        def residual(x: np.ndarray) -> np.ndarray:
            p = {**fixed, **{tune[i]: x[i] for i in range(len(tune))}}
            cp = np.array([cop_fn(to, p["cop_a"], p["cop_b"]) for to in temp_out])
            # Required cooling to hold the setpoint (steady state):
            cooling_req = np.maximum(
                0.0, (temp_out - setpoint) / p["r_envelope"]
                + p["internal_gain_kw"]
                + p["occupancy_gain_kw"] * occupancy
                + solar * p["solar_aperture_m2"] * p["window_factor"] / 1000.0
            )
            predicted_power = cooling_req / cp
            model_res = (predicted_power - power) / scale
            reg = REGULARISATION_WEIGHT * (x - x0) / np.maximum(np.abs(x0), 1e-3)
            return np.concatenate([model_res, reg])

    lower = np.array([BOUNDS[k][0] for k in tune], dtype=float)
    upper = np.array([BOUNDS[k][1] for k in tune], dtype=float)
    x0 = np.clip(x0, lower, upper)

    result = least_squares(residual, x0, bounds=(lower, upper), method="trf", max_nfev=400)
    fitted = {tune[i]: float(result.x[i]) for i in range(len(tune))}
    params.update(fitted)

    # Report fit quality.
    if has_temp_in:
        predicted = simulate_power_to_temperature(
            power,
            params,
            outdoor_temp_c=temp_out,
            solar_w_m2=solar,
            occupancy=occupancy,
            initial_temp_in=float(temp_in_obs[0]),
            step_minutes=step_minutes,
        )
        rmse = float(np.sqrt(np.mean((predicted - temp_in_obs) ** 2)))
        mape_power = None
    else:
        setpoint = 23.5
        cp = np.array([cop_fn(to, params["cop_a"], params["cop_b"]) for to in temp_out])
        cooling_req = np.maximum(
            0.0,
            (temp_out - setpoint) / params["r_envelope"]
            + params["internal_gain_kw"]
            + params["occupancy_gain_kw"] * occupancy
            + solar * params["solar_aperture_m2"] * params["window_factor"] / 1000.0,
        )
        predicted_power = cooling_req / cp
        denom = np.where(power > 1e-6, power, np.nan)
        mape = float(np.nanmean(np.abs((predicted_power - power) / denom)) * 100.0)
        rmse = float(np.sqrt(np.mean((predicted_power - power) ** 2)))
        mape_power = round(mape, 2) if np.isfinite(mape) else None

    return {
        "status": "calibrated",
        "params": params,
        "rmse_c": round(rmse, 3) if has_temp_in else None,
        "mape_power": mape_power,
        "n_observations": n,
        "notes": notes,
    }
