"""Simple carbon-aware battery dispatch.

Rule-based (transparent, demo-safe) heuristic: charge during the cleanest grid
intervals and discharge during the dirtiest, subject to power, capacity and
round-trip efficiency limits. Returns the battery net-power profile (positive =
discharge to the building, negative = charging) and the residual grid draw.

This is deliberately *not* a hard optimization — it is easy to explain on stage
and monotone in carbon intensity, which is what the margin-abatement story needs.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass
class BatterySpec:
    capacity_kwh: float = 200.0
    power_kw: float = 100.0
    efficiency: float = 0.9
    initial_soc: float = 0.5
    min_soc: float = 0.1
    max_soc: float = 0.95
    charge_quantile: float = 0.3
    discharge_quantile: float = 0.7


def dispatch(
    load_kw: Sequence[float],
    ci_g_per_kwh: Sequence[float],
    *,
    step_minutes: int = 15,
    spec: BatterySpec | None = None,
) -> dict:
    spec = spec or BatterySpec()
    load = np.asarray(load_kw, dtype=float)
    ci = np.asarray(ci_g_per_kwh, dtype=float)
    n = len(load)
    step_h = step_minutes / 60.0

    low_thr = float(np.quantile(ci, spec.charge_quantile))
    high_thr = float(np.quantile(ci, spec.discharge_quantile))

    soc_kwh = spec.initial_soc * spec.capacity_kwh
    # battery_kw: net power delivered to the building.
    #   positive = discharging (reduces grid import)
    #   negative = charging    (increases grid import)
    battery_kw = np.zeros(n)
    eta = float(np.sqrt(max(spec.efficiency, 1e-3)))  # symmetric charge/discharge

    for t in range(n):
        # Max grid-side charge power that still fits in the pack.
        headroom_charge_kw = max(0.0, (spec.max_soc * spec.capacity_kwh - soc_kwh)) / (
            eta * step_h
        )
        # Max delivered discharge power available from the pack.
        headroom_discharge_kw = max(0.0, (soc_kwh - spec.min_soc * spec.capacity_kwh)) * eta / step_h

        if ci[t] <= low_thr and headroom_charge_kw > 1e-6:
            charge = min(spec.power_kw, headroom_charge_kw)
            soc_kwh += charge * eta * step_h
            battery_kw[t] = -charge
        elif ci[t] >= high_thr and headroom_discharge_kw > 1e-6:
            discharge = min(spec.power_kw, headroom_discharge_kw, load[t])
            soc_kwh -= discharge * step_h / eta
            battery_kw[t] = discharge

    grid_kw = np.clip(load - battery_kw, 0.0, None)
    baseline_emissions = load * step_h * ci / 1000.0
    battery_emissions = grid_kw * step_h * ci / 1000.0

    return {
        "battery_kw": battery_kw,
        "grid_kw": grid_kw,
        "baseline_emissions_kg": baseline_emissions,
        "with_battery_emissions_kg": battery_emissions,
        "emissions_saved_kg": float(np.sum(baseline_emissions - battery_emissions)),
        "final_soc": float(soc_kwh / spec.capacity_kwh),
        "charge_threshold_ci": low_thr,
        "discharge_threshold_ci": high_thr,
    }
