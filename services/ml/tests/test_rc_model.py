"""Physics sanity tests for the RC thermal Digital Twin."""
from __future__ import annotations

import numpy as np
import pytest

from app.twin import rc_model
from app.twin.hvac import cop as cop_fn

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


def make_inputs(n=96, throttle=0.0, temp_out=32.0, solar=0.0, occ=0.0, ci=500.0):
    return rc_model.TwinInputs(
        outdoor_temp_c=np.full(n, temp_out),
        solar_w_m2=np.full(n, solar),
        occupancy=np.full(n, occ),
        ci_g_per_kwh=np.full(n, ci),
        throttle=np.full(n, throttle),
    )


def test_free_floating_exponential_decay():
    """With no gains/HVAC, T_in relaxes to T_out with time constant R·C."""
    n = 20
    zero_gain = {**PARAMS, "internal_gain_kw": 0.0, "occupancy_gain_kw": 0.0}
    inputs = make_inputs(n=n, throttle=0.0, temp_out=32.0)
    result = rc_model.simulate_fast(inputs, zero_gain, initial_temp_in=24.0, step_minutes=15)
    tau = PARAMS["r_envelope"] * PARAMS["c_thermal"]
    expected_last = 32.0 + (24.0 - 32.0) * np.exp(-(n * 0.25) / tau)
    assert result.temp_in[-1] == pytest.approx(expected_last, abs=1e-6)
    # Monotone approach toward T_out.
    assert np.all(np.diff(result.temp_in) > 0)


def test_hvac_cools_and_consumes_energy():
    n = 8
    off = rc_model.simulate_fast(make_inputs(n, throttle=0.0), PARAMS, initial_temp_in=24.0)
    on = rc_model.simulate_fast(make_inputs(n, throttle=1.0), PARAMS, initial_temp_in=24.0)
    assert on.temp_in[-1] < off.temp_in[-1]
    assert np.allclose(on.power_kw, PARAMS["hvac_rated_kw"])
    assert on.emissions_total_kg > 0


def test_rk45_matches_closed_form():
    inputs = make_inputs(n=32, throttle=0.6, temp_out=31.0, solar=400.0, occ=0.7, ci=450.0)
    ode = rc_model.simulate(inputs, PARAMS, initial_temp_in=24.0, step_minutes=15)
    fast = rc_model.simulate_fast(inputs, PARAMS, initial_temp_in=24.0, step_minutes=15)
    assert np.max(np.abs(ode.temp_in - fast.temp_in)) < 1e-4


def test_steady_state_matches_simulation():
    # No solar / occupancy so the analytic steady state is exact.
    inputs = make_inputs(n=800, throttle=0.5, temp_out=33.0, solar=0.0, occ=0.0)
    result = rc_model.simulate_fast(inputs, PARAMS, initial_temp_in=24.0)
    cp = cop_fn(33.0, PARAMS["cop_a"], PARAMS["cop_b"])
    cooling = cp * PARAMS["hvac_rated_kw"] * 0.5
    ss = rc_model.steady_state_temp(33.0, cooling, PARAMS)
    assert result.temp_in[-1] == pytest.approx(ss, abs=1e-3)
    assert result.temp_in[-1] < 33.0


def test_cop_decreases_with_temperature():
    assert cop_fn(20.0) > cop_fn(35.0)
    assert cop_fn(60.0) >= 1.6  # clamped floor


def test_expand_profile_broadcast_and_resample():
    assert np.allclose(rc_model.expand_profile([], 4, 5.0), [5, 5, 5, 5])
    assert np.allclose(rc_model.expand_profile([2.0], 3, 0.0), [2, 2, 2])
    assert len(rc_model.expand_profile([1, 2, 3], 5, 0.0)) == 5
