"""Rooftop PV yield model (simplified but physically grounded).

Yield(dc) = irradiance/1000 · area · module_efficiency · derate
Cell temperature derating uses a NOCT model, inverter clipping caps AC output.
"""
from __future__ import annotations

from typing import Optional, Sequence

import numpy as np

DEFAULT_EFFICIENCY = 0.18  # modern rooftop modules
DEFAULT_DERATE = 0.85  # soiling, wiring, mismatch, inverter
DEFAULT_NOCT_C = 45.0
DEFAULT_TEMP_COEFF = -0.004  # per °C above 25 °C
STC_TEMP_C = 25.0


def cell_temperature(
    irradiance_w_m2: np.ndarray,
    ambient_c: np.ndarray,
    noct_c: float = DEFAULT_NOCT_C,
) -> np.ndarray:
    irradiance = np.asarray(irradiance_w_m2, dtype=float)
    ambient = np.asarray(ambient_c, dtype=float)
    return ambient + (noct_c - 20.0) / 800.0 * irradiance


def pv_yield_kw(
    irradiance_w_m2: Sequence[float] | np.ndarray,
    *,
    system_kwp: float,
    ambient_c: Optional[Sequence[float] | np.ndarray] = None,
    efficiency: float = DEFAULT_EFFICIENCY,
    derate: float = DEFAULT_DERATE,
    temp_coeff: float = DEFAULT_TEMP_COEFF,
    inverter_clip_kw: Optional[float] = None,
) -> np.ndarray:
    """AC PV power (kW) per interval from irradiance (W/m²)."""
    irradiance = np.asarray(irradiance_w_m2, dtype=float)
    if ambient_c is None:
        temp_factor = np.ones_like(irradiance)
    else:
        cell = cell_temperature(irradiance, np.asarray(ambient_c, dtype=float))
        temp_factor = np.clip(1.0 + temp_coeff * (cell - STC_TEMP_C), 0.5, 1.05)

    # system_kwp already embeds module area·efficiency at STC; scale by irradiance.
    ideal = irradiance / 1000.0 * float(system_kwp)
    ac = ideal * float(derate) * temp_factor
    if inverter_clip_kw is not None:
        ac = np.minimum(ac, float(inverter_clip_kw))
    return np.clip(ac, 0.0, None)


def self_consumption(
    load_kw: Sequence[float] | np.ndarray,
    pv_kw: Sequence[float] | np.ndarray,
    *,
    export_allowed: bool = True,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Split PV into self-consumed, exported and residual grid import.

    Returns ``(grid_import_kw, self_consumed_kw, export_kw)``.
    """
    load = np.asarray(load_kw, dtype=float)
    pv = np.asarray(pv_kw, dtype=float)
    self_consumed = np.minimum(load, pv)
    residual = np.clip(load - self_consumed, 0.0, None)
    export = np.clip(pv - load, 0.0, None) if export_allowed else np.zeros_like(pv)
    return residual, self_consumed, export
