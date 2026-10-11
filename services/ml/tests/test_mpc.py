"""Tests for the carbon-aware MPC optimizer."""
from __future__ import annotations

import numpy as np

from app.optimization import mpc

PARAMS = {
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


def test_optimizer_respects_bounds_and_comfort(day_profiles):
    result = mpc.optimize(
        horizon=96,
        step_minutes=15,
        params=PARAMS,
        comfort_min_c=22.0,
        comfort_max_c=26.0,
        initial_temp_in=24.0,
        throttle_min=0.2,
        **day_profiles,
    )
    throttles = np.array([p["throttle"] for p in result["schedule"]])
    assert throttles.min() >= 0.2 - 1e-6
    assert throttles.max() <= 1.0 + 1e-6
    temps = np.array([p["temp_in"] for p in result["schedule"]])
    # Soft constraint: allow a small excursion but not a runaway.
    assert temps.max() <= 26.5
    assert temps.min() >= 21.5


def test_optimizer_not_worse_than_baseline(day_profiles):
    result = mpc.optimize(
        horizon=96,
        step_minutes=15,
        params=PARAMS,
        comfort_min_c=22.0,
        comfort_max_c=26.0,
        initial_temp_in=24.0,
        throttle_min=0.2,
        **day_profiles,
    )
    assert result["optimized_emissions_kg"] <= result["baseline_emissions_kg"] + 1e-6
    assert result["emissions_reduction_pct"] >= 0.0
    assert result["cleanest_hour"] is not None


def test_optimizer_outputs_full_horizon(day_profiles):
    result = mpc.optimize(
        horizon=48,
        step_minutes=15,
        params=PARAMS,
        comfort_min_c=22.0,
        comfort_max_c=26.0,
        initial_temp_in=24.0,
        **day_profiles,
    )
    assert len(result["schedule"]) == 48
    assert len(result["baseline_throttle"]) == 48
