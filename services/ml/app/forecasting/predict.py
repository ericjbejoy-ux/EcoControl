"""Recursive multi-step forecasting with quantile bands + seasonal-naive fallback."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional, Sequence

import numpy as np

from app.data_utils import series_to_arrays
from app.forecasting.features import build_inference_row
from app.registry.model_store import ModelBundle
from app.twin.rc_model import (
    expand_profile,
    synth_occupancy_profile,
    synth_outdoor_profile,
    synth_solar_profile,
)

Z80 = 1.2816  # two-sided 80% interval multiplier for a normal distribution


def prepare_future_exog(
    future_weather: Sequence[Any],
    *,
    horizon: int,
    step_minutes: int,
    start_ts: Optional[datetime] = None,
) -> dict[str, np.ndarray]:
    """Align optional future weather/CI context into length-``horizon`` arrays."""
    arrays = series_to_arrays(future_weather, step_minutes=step_minutes) if future_weather else None

    if arrays is not None and len(arrays["power_kw"]) > 0:
        temp_out = expand_profile(arrays["temp_out"], horizon, 28.0)
        humidity = expand_profile(arrays["humidity"], horizon, 55.0)
        irradiance = expand_profile(arrays["irradiance"], horizon, 0.0)
        ci = expand_profile(arrays["ci"], horizon, 500.0)
        occupancy = expand_profile(arrays["occupancy"], horizon, 0.5)
        ts = arrays["ts"]
    else:
        temp_out = synth_outdoor_profile(horizon)
        humidity = np.full(horizon, 55.0)
        irradiance = synth_solar_profile(horizon)
        ci = 380.0 + 120.0 * np.sin(np.linspace(0, 2 * np.pi, horizon, endpoint=False))
        occupancy = synth_occupancy_profile(horizon)
        ts = np.array([], dtype="datetime64[ns]")

    if len(ts) != horizon:
        base = start_ts or datetime(2025, 1, 1)
        ts = np.array(
            [base + timedelta(minutes=step_minutes * i) for i in range(horizon)],
            dtype="datetime64[ns]",
        )

    return {
        "temp_out": temp_out,
        "humidity": humidity,
        "irradiance": irradiance,
        "ci": ci,
        "occupancy": occupancy,
        "ts": ts,
    }


def _seasonal_naive(
    bundle: ModelBundle, history_power: np.ndarray, horizon: int, step_minutes: int
) -> dict[str, np.ndarray]:
    period = max(1, bundle.seasonal_period)
    if len(history_power) >= period:
        base = history_power[-period:]
    elif len(history_power) > 0:
        base = np.resize(history_power, period)
    else:
        base = np.full(period, 100.0)
    p50 = np.array([base[i % period] for i in range(horizon)], dtype=float)
    spread = max(bundle.residual_std, 1e-3) * Z80
    return {
        "q10": np.clip(p50 - spread, 0, None),
        "q50": p50,
        "q90": p50 + spread,
    }


def forecast(
    bundle: ModelBundle,
    history: Sequence[Any],
    future_weather: Sequence[Any],
    *,
    horizon: int,
    step_minutes: int,
    fallback_start_ts: Optional[datetime] = None,
) -> dict[str, np.ndarray]:
    """Return dict with q10/q50/q90 power (kW), ci and ts arrays."""
    arrays = series_to_arrays(history, step_minutes=step_minutes)
    exog = prepare_future_exog(
        future_weather, horizon=horizon, step_minutes=step_minutes, start_ts=fallback_start_ts
    )

    if bundle.backend == "seasonal_naive" or not bundle.models:
        preds = _seasonal_naive(bundle, arrays["power_kw"], horizon, step_minutes)
        preds["ci"] = exog["ci"]
        preds["ts"] = exog["ts"]
        return preds

    n_hist = len(arrays["power_kw"])
    power_ext = np.concatenate([arrays["power_kw"], np.zeros(horizon)])
    ts_ext = np.concatenate([arrays["ts"], exog["ts"]])
    temp_ext = np.concatenate([arrays["temp_out"], exog["temp_out"]])
    hum_ext = np.concatenate([arrays["humidity"], exog["humidity"]])
    irr_ext = np.concatenate([arrays["irradiance"], exog["irradiance"]])
    ci_ext = np.concatenate([arrays["ci"], exog["ci"]])
    occ_ext = np.concatenate([arrays["occupancy"], exog["occupancy"]])

    models = bundle.models
    q10 = np.zeros(horizon)
    q50 = np.zeros(horizon)
    q90 = np.zeros(horizon)

    try:
        for i in range(horizon):
            idx = n_hist + i
            row = build_inference_row(
                idx,
                ts_ext,
                power_ext,
                temp_ext,
                hum_ext,
                irr_ext,
                ci_ext,
                occ_ext,
                bundle.lags,
                bundle.rolling,
            )
            p10 = float(models["0.10"].predict(row.reshape(1, -1))[0])
            p50 = float(models["0.50"].predict(row.reshape(1, -1))[0])
            p90 = float(models["0.90"].predict(row.reshape(1, -1))[0])
            p10, p90 = min(p10, p50), max(p90, p50)
            q10[i], q50[i], q90[i] = p10, p50, p90
            power_ext[idx] = max(0.0, p50)
    except ValueError:
        return {
            **_seasonal_naive(bundle, arrays["power_kw"], horizon, step_minutes),
            "ci": exog["ci"],
            "ts": exog["ts"],
        }

    return {
        "q10": np.clip(q10, 0, None),
        "q50": np.clip(q50, 0, None),
        "q90": np.clip(q90, 0, None),
        "ci": exog["ci"],
        "ts": exog["ts"],
        "temp_out": exog["temp_out"],
    }


def emissions_band(
    q10: np.ndarray,
    q50: np.ndarray,
    q90: np.ndarray,
    ci: np.ndarray,
    step_minutes: int,
) -> dict[str, np.ndarray]:
    step_h = step_minutes / 60.0
    return {
        "p10": q10 * step_h * ci / 1000.0,
        "p50": q50 * step_h * ci / 1000.0,
        "p90": q90 * step_h * ci / 1000.0,
    }
