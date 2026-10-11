"""HVAC thermodynamics helpers: temperature-dependent COP and cooling delivery.

The RC twin treats the HVAC as an ideal heat pump: it removes ``cooling_kw`` of
heat from the conditioned space at an electrical cost of ``cooling_kw / COP``.
That electrical power is what feeds the dynamic Scope 2 emission calculation.

Reference: standard air-source chiller COP curve, linearised around a 24 °C
outdoor design point: ``COP = cop_a − cop_b·(T_out − 24)``. The linear form is
easy to calibrate and monotonic in the operating range that matters.
"""
from __future__ import annotations

from dataclasses import dataclass

MIN_COP = 1.6


@dataclass(frozen=True)
class HvacSpec:
    a: float = 4.4
    b: float = 0.06
    rated_kw: float = 120.0
    min_cop: float = MIN_COP


def cop(t_out_c: float, a: float = 4.4, b: float = 0.06, min_cop: float = MIN_COP) -> float:
    """Coefficient of performance as a function of outdoor temperature."""
    value = a - b * (float(t_out_c) - 24.0)
    return float(max(min_cop, value))


def cooling_kw(t_out_c: float, rated_kw: float, throttle: float, a: float, b: float) -> float:
    """Thermal cooling delivered (kW) for a given throttle in [0, 1]."""
    throttle = min(1.0, max(0.0, float(throttle)))
    return cop(t_out_c, a, b) * float(rated_kw) * throttle


def electric_kw(rated_kw: float, throttle: float) -> float:
    """Electrical input power (kW) drawn by the HVAC at a given throttle."""
    throttle = min(1.0, max(0.0, float(throttle)))
    return float(rated_kw) * throttle


def aggregation_scale(floors: int) -> float:
    """Zone grouping scale: an N-storey building of identical zones is ~N× rated.

    The digital twin keeps a single lumped node but allows the rated HVAC power,
    capacitance and gains to scale with the number of floors so multi-storey
    facilities can be modelled without a full multi-zone state vector.
    """
    return float(max(1, int(floors)))
