"""Physics-informed RC thermal Digital Twin of a building zone.

Governing equation (lumped single-node RC circuit)::

    C · dT_in/dt = (T_out − T_in)/R  +  Q_int  +  Q_solar  −  COP(T_out) · P_hvac · u(t)

where

* ``R`` envelope thermal resistance (°C/kW)
* ``C`` thermal capacitance (kWh/°C)
* ``Q_int = internal_gain_kw + occupancy_gain_kw · occupancy`` (kW thermal)
* ``Q_solar = irradiance_W_m2 · aperture_m2 · window_factor / 1000`` (kW thermal)
* ``u(t) ∈ [0, 1]`` HVAC throttle, ``P_hvac`` rated electrical input (kW)

Two integrators are provided:

* :func:`simulate` — ``scipy.integrate.solve_ivp`` (RK45) at a 1-minute internal
  step, as specified for ``POST /twin/simulate``. High fidelity, moderate cost.
* :func:`simulate_fast` — an *exact* closed-form update for the piecewise-constant
  linear ODE (zero-order-hold inputs). O(N) with no timestep error; used by the
  MPC optimizer which evaluates the twin hundreds of times per solve.

The two agree to well below thermal-sensor precision (see test_rc_model.py).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np

from app.twin.hvac import cop as cop_fn


# ---------------------------------------------------------------------------
# Input containers
# ---------------------------------------------------------------------------

@dataclass
class TwinInputs:
    """Piecewise-constant exogenous inputs, one value per simulation step."""

    outdoor_temp_c: np.ndarray
    solar_w_m2: np.ndarray
    occupancy: np.ndarray
    ci_g_per_kwh: np.ndarray
    throttle: np.ndarray  # per-step HVAC throttle in [0, 1]

    def __post_init__(self) -> None:
        self.outdoor_temp_c = np.asarray(self.outdoor_temp_c, dtype=float)
        self.solar_w_m2 = np.asarray(self.solar_w_m2, dtype=float)
        self.occupancy = np.asarray(self.occupancy, dtype=float)
        self.ci_g_per_kwh = np.asarray(self.ci_g_per_kwh, dtype=float)
        self.throttle = np.asarray(self.throttle, dtype=float)
        n = len(self.outdoor_temp_c)
        for name in ("solar_w_m2", "occupancy", "ci_g_per_kwh", "throttle"):
            arr = getattr(self, name)
            if len(arr) != n:
                raise ValueError(f"TwinInputs.{name} length {len(arr)} != {n}")

    @property
    def n_steps(self) -> int:
        return len(self.outdoor_temp_c)


@dataclass
class TwinResult:
    """Simulation outputs, one value per step (state at the end of each step)."""

    temp_in: np.ndarray
    temp_out: np.ndarray
    power_kw: np.ndarray
    cooling_kw: np.ndarray
    cop: np.ndarray
    emissions_kg: np.ndarray
    throttle: np.ndarray
    ts_hours: np.ndarray = field(default_factory=lambda: np.array([]))

    @property
    def energy_kwh(self) -> float:
        return float(np.sum(self.power_kw) * _STEP_H)

    @property
    def emissions_total_kg(self) -> float:
        return float(np.sum(self.emissions_kg))


_STEP_H = 0.25  # replaced per-simulation; kept for property fallback

# ---------------------------------------------------------------------------
# Profile helpers
# ---------------------------------------------------------------------------

def expand_profile(
    values: Optional[Sequence[float]], n: int, default: float = 0.0
) -> np.ndarray:
    """Coerce an optional profile into a length-``n`` float array.

    * empty/None  → constant ``default``
    * length 1    → broadcast
    * length n    → as-is
    * other length→ linear resample onto ``n`` points
    """
    if values is None or len(values) == 0:
        return np.full(n, float(default))
    arr = np.asarray(values, dtype=float)
    if arr.size == 1:
        return np.full(n, float(arr[0]))
    if arr.size == n:
        return arr.astype(float)
    # resample
    src = np.linspace(0.0, 1.0, arr.size)
    dst = np.linspace(0.0, 1.0, n)
    return np.interp(dst, src, arr)


def synth_outdoor_profile(n: int, mean_c: float = 30.0, amplitude_c: float = 6.0) -> np.ndarray:
    """Sinusoidal diurnal outdoor temperature (peak ~15:00)."""
    phase = np.linspace(0.0, 2 * np.pi, n, endpoint=False)
    return mean_c + amplitude_c * np.sin(phase - np.pi / 2)


def synth_solar_profile(n: int, peak_w_m2: float = 800.0) -> np.ndarray:
    """Bell-shaped clear-sky irradiance over the day (zero at night)."""
    hours = np.linspace(0.0, 24.0, n, endpoint=False)
    solar = np.clip(np.sin(np.pi * (hours - 6.0) / 12.0), 0.0, None) * peak_w_m2
    return solar


def synth_occupancy_profile(n: int, peak: float = 1.0) -> np.ndarray:
    """Weekday-style occupancy ramp (08:00–18:00 plateau)."""
    hours = np.linspace(0.0, 24.0, n, endpoint=False)
    occ = np.clip(np.sin(np.pi * (hours - 7.0) / 12.0), 0.0, None)
    return np.minimum(occ * 1.4, 1.0) * peak


# ---------------------------------------------------------------------------
# Derivative and integrators
# ---------------------------------------------------------------------------

def _solar_gain_kw(solar_w_m2: float, aperture_m2: float, window_factor: float) -> float:
    return float(solar_w_m2) * float(aperture_m2) * float(window_factor) / 1000.0


def net_heat_kw(
    temp_in: float,
    temp_out: float,
    solar_w_m2: float,
    occupancy: float,
    cooling_thermal_kw: float,
    r_envelope: float,
    internal_gain_kw: float,
    occupancy_gain_kw: float,
    aperture_m2: float,
    window_factor: float,
) -> float:
    envelope = (temp_out - temp_in) / r_envelope
    gains = internal_gain_kw + occupancy_gain_kw * occupancy
    solar = _solar_gain_kw(solar_w_m2, aperture_m2, window_factor)
    return envelope + gains + solar - cooling_thermal_kw


def simulate(
    inputs: TwinInputs,
    params: dict,
    *,
    initial_temp_in: float = 24.0,
    step_minutes: int = 15,
    internal_step_s: int = 60,
    start_time_h: float = 0.0,
) -> TwinResult:
    """High-fidelity RK45 integration via ``scipy.integrate.solve_ivp``.

    Inputs are held constant over each reporting step (zero-order hold), and the
    ODE is integrated at ``internal_step_s`` resolution within each step.
    """
    from scipy.integrate import solve_ivp

    r = float(params["r_envelope"])
    c = float(params["c_thermal"])
    a = float(params["cop_a"])
    b = float(params["cop_b"])
    rated = float(params["hvac_rated_kw"])
    int_gain = float(params["internal_gain_kw"])
    occ_gain = float(params["occupancy_gain_kw"])
    aperture = float(params["solar_aperture_m2"])
    wf = float(params["window_factor"])

    n = inputs.n_steps
    step_h = step_minutes / 60.0
    internal_h = internal_step_s / 3600.0
    sub_steps = max(1, int(round(step_h / internal_h)))

    temp_in = np.empty(n)
    power = np.empty(n)
    cooling = np.empty(n)
    cops = np.empty(n)
    emissions = np.empty(n)

    t_in = float(initial_temp_in)
    for k in range(n):
        t_out = float(inputs.outdoor_temp_c[k])
        u = float(inputs.throttle[k])
        solar = _solar_gain_kw(inputs.solar_w_m2[k], aperture, wf)
        occ_heat = occ_gain * float(inputs.occupancy[k])
        cp = cop_fn(t_out, a, b)
        q_cool = cp * rated * u

        def f(_t: float, state: np.ndarray, _q=q_cool, _to=t_out, _sol=solar, _occ=occ_heat) -> list:
            envelope = (_to - state[0]) / r
            q_net = envelope + int_gain + _occ + _sol - _q
            return [q_net / c]

        sol = solve_ivp(
            f,
            (0.0, step_h),
            [t_in],
            method="RK45",
            t_eval=np.linspace(0.0, step_h, sub_steps + 1),
            rtol=1e-8,
            atol=1e-10,
        )
        t_in = float(sol.y[0, -1])

        temp_in[k] = t_in
        power[k] = rated * u
        cooling[k] = q_cool
        cops[k] = cp
        emissions[k] = power[k] * step_h * float(inputs.ci_g_per_kwh[k]) / 1000.0

    return TwinResult(
        temp_in=temp_in,
        temp_out=inputs.outdoor_temp_c.copy(),
        power_kw=power,
        cooling_kw=cooling,
        cop=cops,
        emissions_kg=emissions,
        throttle=inputs.throttle.copy(),
        ts_hours=start_time_h + np.arange(n) * step_h,
    )


def simulate_fast(
    inputs: TwinInputs,
    params: dict,
    *,
    initial_temp_in: float = 24.0,
    step_minutes: int = 15,
) -> TwinResult:
    """Exact closed-form integration for piecewise-constant linear inputs.

    For ``dT/dt = (T_eq − T)/τ`` with ``τ = R·C`` and
    ``T_eq = T_out + R·(Q_int + Q_solar − Q_cool)``::

        T(t+dt) = T_eq + (T(t) − T_eq)·exp(−dt/τ)
    """
    r = float(params["r_envelope"])
    c = float(params["c_thermal"])
    a = float(params["cop_a"])
    b = float(params["cop_b"])
    rated = float(params["hvac_rated_kw"])
    int_gain = float(params["internal_gain_kw"])
    occ_gain = float(params["occupancy_gain_kw"])
    aperture = float(params["solar_aperture_m2"])
    wf = float(params["window_factor"])

    n = inputs.n_steps
    step_h = step_minutes / 60.0
    tau = r * c
    decay = float(np.exp(-step_h / tau))

    temp_in = np.empty(n)
    power = np.empty(n)
    cooling = np.empty(n)
    cops = np.empty(n)
    emissions = np.empty(n)

    t_in = float(initial_temp_in)
    for k in range(n):
        t_out = float(inputs.outdoor_temp_c[k])
        u = float(inputs.throttle[k])
        solar = _solar_gain_kw(inputs.solar_w_m2[k], aperture, wf)
        occ_heat = occ_gain * float(inputs.occupancy[k])
        cp = cop_fn(t_out, a, b)
        q_cool = cp * rated * u

        q_net = int_gain + occ_heat + solar - q_cool
        t_eq = t_out + r * q_net
        t_in = t_eq + (t_in - t_eq) * decay

        temp_in[k] = t_in
        power[k] = rated * u
        cooling[k] = q_cool
        cops[k] = cp
        emissions[k] = power[k] * step_h * float(inputs.ci_g_per_kwh[k]) / 1000.0

    return TwinResult(
        temp_in=temp_in,
        temp_out=inputs.outdoor_temp_c.copy(),
        power_kw=power,
        cooling_kw=cooling,
        cop=cops,
        emissions_kg=emissions,
        throttle=inputs.throttle.copy(),
    )


def simulate_power_to_temperature(
    input_power_kw: np.ndarray,
    params: dict,
    *,
    outdoor_temp_c: np.ndarray,
    solar_w_m2: np.ndarray,
    occupancy: np.ndarray,
    initial_temp_in: float = 24.0,
    step_minutes: int = 15,
) -> np.ndarray:
    """Invert the energy balance: given measured *electrical* power, return T_in.

    Cooling thermal power ``Q_cool = COP(T_out) · P_elec``. Used by calibration
    when no indoor sensor exists.
    """
    r = float(params["r_envelope"])
    c = float(params["c_thermal"])
    a = float(params["cop_a"])
    b = float(params["cop_b"])
    int_gain = float(params["internal_gain_kw"])
    occ_gain = float(params["occupancy_gain_kw"])
    aperture = float(params["solar_aperture_m2"])
    wf = float(params["window_factor"])

    n = len(input_power_kw)
    step_h = step_minutes / 60.0
    tau = r * c
    decay = float(np.exp(-step_h / tau))
    out = np.empty(n)
    t_in = float(initial_temp_in)
    for k in range(n):
        t_out = float(outdoor_temp_c[k])
        q_cool = cop_fn(t_out, a, b) * float(input_power_kw[k])
        solar = _solar_gain_kw(solar_w_m2[k], aperture, wf)
        q_net = int_gain + occ_gain * float(occupancy[k]) + solar - q_cool
        t_eq = t_out + r * q_net
        t_in = t_eq + (t_in - t_eq) * decay
        out[k] = t_in
    return out


def steady_state_temp(temp_out: float, cooling_thermal_kw: float, params: dict) -> float:
    """Analytic steady-state indoor temperature (dT/dt = 0)."""
    r = float(params["r_envelope"])
    q_net = (
        float(params["internal_gain_kw"])
        - float(cooling_thermal_kw)
    )
    return float(temp_out + r * q_net)
