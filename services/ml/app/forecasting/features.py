"""Feature engineering for the 24 h (96-step) load / emissions forecaster.

Feature groups are deliberately named to match the XAI group rollup so the
Command Center SHAP panel ("Weather / Time-of-day / Grid carbon / Occupancy /
Historical pattern") can be produced directly from the model's inputs.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional, Sequence

import numpy as np

# Calendar
F_TIME = [
    "hour_sin",
    "hour_cos",
    "minute_of_day",
    "dayofweek",
    "is_weekend",
    "is_holiday",
]
# Weather
F_WEATHER = ["temp_out", "humidity", "irradiance"]
# Grid
F_GRID = ["ci"]
# Occupancy
F_OCC = ["occupancy"]
# Historical (lag / rolling) — selected dynamically by data availability
LAG_CANDIDATES = [1, 4, 96, 672]
ROLL_CANDIDATES = [4, 96]

FEATURE_GROUPS = {
    "Time-of-day": F_TIME,
    "Weather": F_WEATHER,
    "Grid carbon": F_GRID,
    "Occupancy": F_OCC,
}

# Small, region-agnostic holiday set (month, day) used only as a soft signal.
HOLIDAYS = {(1, 1), (5, 1), (8, 15), (10, 2), (12, 25), (12, 31)}


def _is_holiday(ts: datetime) -> float:
    return 1.0 if (ts.month, ts.day) in HOLIDAYS else 0.0


def select_lags(n_history: int) -> list[int]:
    """Keep only lag features that have enough history to be meaningful."""
    lags = [lag for lag in LAG_CANDIDATES if n_history > lag + 4]
    if 1 not in lags:
        lags = [1, 4]
    return sorted(lags)


def select_rolling(n_history: int) -> list[int]:
    windows = [w for w in ROLL_CANDIDATES if n_history > w + 2]
    if not windows:
        windows = [4]
    return sorted(windows)


def feature_names(lags: Sequence[int], rolling: Sequence[int]) -> list[str]:
    names = list(F_TIME + F_WEATHER + F_GRID + F_OCC)
    names += [f"lag_{lag}" for lag in lags]
    for w in rolling:
        names.append(f"roll_mean_{w}")
    if 4 in rolling:
        names.append("roll_std_4")
    return names


def feature_groups_for(lags: Sequence[int], rolling: Sequence[int]) -> dict[str, list[str]]:
    groups = {k: list(v) for k, v in FEATURE_GROUPS.items()}
    hist = [f"lag_{lag}" for lag in lags]
    hist += [f"roll_mean_{w}" for w in rolling]
    if 4 in rolling:
        hist.append("roll_std_4")
    groups["Historical pattern"] = hist
    return groups


def _row(
    idx: int,
    ts: np.ndarray,
    power: np.ndarray,
    temp_out: np.ndarray,
    humidity: np.ndarray,
    irradiance: np.ndarray,
    ci: np.ndarray,
    occupancy: np.ndarray,
    lags: Sequence[int],
    rolling: Sequence[int],
) -> Optional[dict[str, float]]:
    """Feature dict for a single time index, or None if lags are unavailable."""
    row: dict[str, float] = {}

    dt = ts[idx].astype("datetime64[s]").astype(datetime) if hasattr(ts[idx], "astype") else ts[idx]
    if not isinstance(dt, datetime):
        dt = datetime.fromtimestamp(0)
    minute_of_day = dt.hour * 60 + dt.minute
    hour_frac = minute_of_day / 1440.0
    row["hour_sin"] = float(np.sin(2 * np.pi * hour_frac))
    row["hour_cos"] = float(np.cos(2 * np.pi * hour_frac))
    row["minute_of_day"] = float(minute_of_day)
    row["dayofweek"] = float(dt.weekday())
    row["is_weekend"] = 1.0 if dt.weekday() >= 5 else 0.0
    row["is_holiday"] = _is_holiday(dt)

    row["temp_out"] = float(temp_out[idx])
    row["humidity"] = float(humidity[idx])
    row["irradiance"] = float(irradiance[idx])
    row["ci"] = float(ci[idx])
    row["occupancy"] = float(occupancy[idx])

    for lag in lags:
        j = idx - lag
        if j < 0:
            return None
        row[f"lag_{lag}"] = float(power[j])

    for w in rolling:
        if idx - w < 0:
            return None
        window = power[idx - w : idx]
        row[f"roll_mean_{w}"] = float(np.mean(window))
    if 4 in rolling:
        if idx - 4 < 0:
            return None
        row["roll_std_4"] = float(np.std(power[idx - 4 : idx]))

    return row


def build_training_matrix(
    ts: np.ndarray,
    power: np.ndarray,
    temp_out: np.ndarray,
    humidity: np.ndarray,
    irradiance: np.ndarray,
    ci: np.ndarray,
    occupancy: np.ndarray,
    lags: Sequence[int],
    rolling: Sequence[int],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (X, y, valid_indices) for supervised one-step-ahead training."""
    names = feature_names(lags, rolling)
    rows: list[list[float]] = []
    targets: list[float] = []
    idxs: list[int] = []
    for idx in range(len(power)):
        row = _row(idx, ts, power, temp_out, humidity, irradiance, ci, occupancy, lags, rolling)
        if row is None:
            continue
        rows.append([row[n] for n in names])
        targets.append(float(power[idx]))
        idxs.append(idx)
    if not rows:
        return np.empty((0, len(names))), np.empty((0,)), np.empty((0,), dtype=int)
    return np.asarray(rows, dtype=float), np.asarray(targets, dtype=float), np.asarray(idxs, dtype=int)


def build_inference_row(
    idx: int,
    ts: np.ndarray,
    power: np.ndarray,
    temp_out: np.ndarray,
    humidity: np.ndarray,
    irradiance: np.ndarray,
    ci: np.ndarray,
    occupancy: np.ndarray,
    lags: Sequence[int],
    rolling: Sequence[int],
) -> np.ndarray:
    """Feature vector for recursive multi-step inference (raises if warmup short)."""
    row = _row(idx, ts, power, temp_out, humidity, irradiance, ci, occupancy, lags, rolling)
    if row is None:
        raise ValueError(f"Not enough history to build features at index {idx}")
    return np.asarray([row[n] for n in feature_names(lags, rolling)], dtype=float)
