"""Stretch (P2): lightweight multi-zone RC twin (2–5 zones).

Each zone has its own RC parameters, HVAC rating, orientation-driven solar
aperture and comfort band. Zones are coupled only through the outdoor node and
the shared HVAC electric bus, which is the right fidelity/complexity trade-off
for a no-sensor software twin. Reported at 15-min resolution, integrated with
the exact piecewise-constant update from :mod:`app.twin.rc_model`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from app.twin.hvac import cop as cop_fn
from app.twin.rc_model import expand_profile


@dataclass
class ZoneSpec:
    name: str
    r_envelope: float = 0.08
    c_thermal: float = 40.0
    hvac_rated_kw: float = 40.0
    solar_aperture_m2: float = 150.0
    occupancy_gain_kw: float = 15.0
    internal_gain_kw: float = 10.0
    orientation: float = 0.0  # radians; scales the solar profile phase/weight
    comfort_min_c: float = 22.0
    comfort_max_c: float = 26.0
    initial_temp_c: float = 24.0


@dataclass
class ZoneResult:
    name: str
    temp_in: np.ndarray
    temp_out: np.ndarray
    power_kw: np.ndarray
    emissions_kg: np.ndarray
    comfort_ok: np.ndarray


@dataclass
class MultiZoneResult:
    zones: list[ZoneResult] = field(default_factory=list)
    total_power_kw: np.ndarray = field(default_factory=lambda: np.array([]))
    total_emissions_kg: np.ndarray = field(default_factory=lambda: np.array([]))

    @property
    def total_energy_kwh(self) -> float:
        return float(np.sum(self.total_power_kw) * 0.25)


def _orientation_weight(solar: np.ndarray, orientation: float) -> np.ndarray:
    # Shift the diurnal solar peak by orientation and damp off-axis gain.
    shift = int(round(orientation / (2 * np.pi) * len(solar)))
    shifted = np.roll(solar, shift)
    return shifted * (0.75 + 0.25 * np.cos(orientation))


def simulate_multizone(
    zones: Sequence[ZoneSpec],
    *,
    outdoor_temp_c: Sequence[float],
    solar_w_m2: Sequence[float],
    occupancy: Sequence[float],
    ci_g_per_kwh: Sequence[float],
    throttle_profile: Sequence[float],
    cop_a: float = 4.4,
    cop_b: float = 0.06,
    step_minutes: int = 15,
) -> MultiZoneResult:
    """Simulate 2–5 coupled zones sharing the outdoor node and HVAC bus."""
    n = len(outdoor_temp_c)
    t_out = np.asarray(outdoor_temp_c, dtype=float)
    solar = np.asarray(solar_w_m2, dtype=float)
    occ = np.asarray(occupancy, dtype=float)
    ci = np.asarray(ci_g_per_kwh, dtype=float)
    throttle = expand_profile(throttle_profile, n, 0.7)
    step_h = step_minutes / 60.0

    result = MultiZoneResult(
        total_power_kw=np.zeros(n),
        total_emissions_kg=np.zeros(n),
    )

    for zone in zones:
        zone_solar = _orientation_weight(solar, zone.orientation)
        tau = zone.r_envelope * zone.c_thermal
        decay = float(np.exp(-step_h / tau))
        t_in = zone.initial_temp_c
        temp = np.empty(n)
        power = np.empty(n)
        comms = np.empty(n)
        comfort = np.empty(n, dtype=bool)

        for k in range(n):
            cp = cop_fn(t_out[k], cop_a, cop_b)
            u = float(throttle[k])
            q_cool = cp * zone.hvac_rated_kw * u
            solar_gain = zone_solar[k] * zone.solar_aperture_m2 / 1000.0
            q_net = (
                zone.internal_gain_kw
                + zone.occupancy_gain_kw * occ[k]
                + solar_gain
                - q_cool
            )
            t_eq = t_out[k] + zone.r_envelope * q_net
            t_in = t_eq + (t_in - t_eq) * decay

            temp[k] = t_in
            power[k] = zone.hvac_rated_kw * u
            comms[k] = power[k] * step_h * ci[k] / 1000.0
            comfort[k] = zone.comfort_min_c <= t_in <= zone.comfort_max_c

        result.zones.append(
            ZoneResult(
                name=zone.name,
                temp_in=temp,
                temp_out=t_out.copy(),
                power_kw=power,
                emissions_kg=comms,
                comfort_ok=comfort,
            )
        )
        result.total_power_kw += power
        result.total_emissions_kg += comms

    return result
