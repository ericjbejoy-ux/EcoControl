"""Small, dependency-light helpers to turn API payloads into numpy arrays.

All ML modules consume plain numpy arrays; this is the single place where the
pydantic/JSON payload shapes are unwrapped. Keeps the scientific code testable
without constructing HTTP objects.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional, Sequence

import numpy as np

DEFAULT_TEMP_OUT_C = 28.0
DEFAULT_CI_G_PER_KWH = 500.0
DEFAULT_IRRADIANCE = 0.0
DEFAULT_OCCUPANCY = 0.5
DEFAULT_HUMIDITY = 55.0


def _get(point: Any, key: str) -> Any:
    if isinstance(point, dict):
        return point.get(key)
    return getattr(point, key, None)


def _float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _fill(values: list[Optional[float]], default: float) -> np.ndarray:
    """Linear-interpolate internal gaps, then edge-fill with ``default``."""
    arr = np.array([np.nan if v is None else v for v in values], dtype=float)
    if np.all(np.isnan(arr)):
        return np.full(len(arr), default)
    idx = np.arange(len(arr))
    good = ~np.isnan(arr)
    arr = np.interp(idx, idx[good], arr[good])
    return arr


def series_to_arrays(points: Sequence[Any], step_minutes: int = 15) -> dict[str, np.ndarray]:
    """Convert a list of SeriesPoint-like objects into aligned numpy arrays."""
    if not points:
        return {
            "power_kw": np.array([]),
            "temp_out": np.array([]),
            "temp_in": np.array([]),
            "irradiance": np.array([]),
            "occupancy": np.array([]),
            "ci": np.array([]),
            "humidity": np.array([]),
            "ts": np.array([], dtype="datetime64[ns]"),
        }

    power = [_float(_get(p, "power_kw")) or 0.0 for p in points]
    temp_out = [_float(_get(p, "temp_out")) for p in points]
    temp_in_raw = [_float(_get(p, "temp_in")) for p in points]
    irr = [_float(_get(p, "irradiance")) for p in points]
    occ = [_float(_get(p, "occupancy")) for p in points]
    ci = [_float(_get(p, "ci")) for p in points]
    hum = [_float(_get(p, "humidity")) for p in points]

    ts: list[datetime] = []
    for i, p in enumerate(points):
        raw = _get(p, "ts")
        if isinstance(raw, datetime):
            ts.append(raw)
        elif isinstance(raw, str):
            try:
                ts.append(datetime.fromisoformat(raw.replace("Z", "+00:00")))
            except ValueError:
                ts.append(datetime(2025, 1, 1) + timedelta(minutes=step_minutes * i))
        else:
            ts.append(datetime(2025, 1, 1) + timedelta(minutes=step_minutes * i))

    return {
        "power_kw": np.asarray(power, dtype=float),
        "temp_out": _fill(temp_out, DEFAULT_TEMP_OUT_C),
        "temp_in": _fill(temp_in_raw, 24.0) if any(v is not None for v in temp_in_raw) else np.array([]),
        "irradiance": _fill(irr, DEFAULT_IRRADIANCE),
        "occupancy": _fill(occ, DEFAULT_OCCUPANCY),
        "ci": _fill(ci, DEFAULT_CI_G_PER_KWH),
        "humidity": _fill(hum, DEFAULT_HUMIDITY),
        "ts": np.asarray(ts, dtype="datetime64[ns]"),
    }


def infer_step_minutes(ts: np.ndarray, default: int = 15) -> int:
    if ts is None or len(ts) < 2:
        return default
    deltas = np.diff(ts.astype("datetime64[ns]").astype("int64"))
    pos = deltas[deltas > 0]
    if len(pos) == 0:
        return default
    return int(round(float(np.median(pos)) / 60_000_000_000.0))


def to_datetime(value: Any) -> datetime:
    """Coerce numpy datetime64 / str / datetime into a python ``datetime``."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, np.datetime64):
        return value.astype("datetime64[us]").astype(datetime)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime(2025, 1, 1)
    return datetime(2025, 1, 1)


def resample_to_step(values: np.ndarray, target_len: int) -> np.ndarray:
    """Nearest/linear resample of a 1-D array to ``target_len`` samples."""
    values = np.asarray(values, dtype=float)
    if len(values) == target_len:
        return values
    if len(values) == 0:
        return np.zeros(target_len)
    src = np.linspace(0.0, 1.0, len(values))
    dst = np.linspace(0.0, 1.0, target_len)
    return np.interp(dst, src, values)
