"""Train the quantile load forecaster (LightGBM primary, sklearn fallback).

Design notes
------------
* One model per quantile (q10 / q50 / q90) → prediction band (SRS §5.3).
* A single-step-ahead model over lag + exogenous features, rolled forward
  recursively at inference (see ``predict.py``). This keeps train/inference
  feature logic identical and avoids leakage.
* If the history is too short to fit a tree model, a *seasonal-naive*
  fallback bundle is stored so downstream endpoints never 500 (NFR-2).
"""
from __future__ import annotations

from typing import Any, Optional, Sequence

import numpy as np

from app.data_utils import series_to_arrays
from app.forecasting import evaluate
from app.forecasting.features import (
    build_training_matrix,
    feature_groups_for,
    feature_names,
    select_lags,
    select_rolling,
)
from app.registry.model_store import QUANTILES, ModelBundle, save_bundle

try:  # pragma: no cover - exercised by environment
    import lightgbm as _lgb

    LIGHTGBM_AVAILABLE = True
except Exception:  # noqa: BLE001
    _lgb = None
    LIGHTGBM_AVAILABLE = False

from sklearn.ensemble import GradientBoostingRegressor

MIN_SAMPLES_FOR_ML = 64


def backend_name() -> str:
    return "lightgbm" if LIGHTGBM_AVAILABLE else "sklearn_gbr"


def _make_estimator(q: float, seed: int = 42) -> Any:
    if LIGHTGBM_AVAILABLE:
        return _lgb.LGBMRegressor(
            objective="quantile",
            alpha=q,
            n_estimators=400,
            learning_rate=0.05,
            num_leaves=31,
            min_child_samples=20,
            subsample=0.8,
            subsample_freq=1,
            colsample_bytree=0.8,
            reg_lambda=0.1,
            random_state=seed,
            verbosity=-1,
        )
    return GradientBoostingRegressor(
        loss="quantile",
        alpha=q,
        n_estimators=300,
        learning_rate=0.05,
        max_depth=3,
        subsample=0.8,
        random_state=seed,
    )


def _seasonal_fallback_bundle(
    facility_id: str,
    model_type: str,
    step_minutes: int,
    horizon: int,
    power: np.ndarray,
    arrays: dict,
) -> ModelBundle:
    period = max(1, int(round(24 * 60 / step_minutes)))
    seasonal = power[-period:] if len(power) >= period else power
    residual_std = float(np.std(power - np.mean(power))) if len(power) else 0.0
    metrics: dict[str, Any] = {}
    if len(power) >= 2 * period:
        season_pred = np.tile(seasonal, len(power) // period + 1)[: len(power)]
        metrics = evaluate.all_metrics(power, season_pred)
    return ModelBundle(
        facility_id=facility_id,
        model_type=model_type,
        backend="seasonal_naive",
        feature_names=[],
        feature_groups={},
        lags=[],
        rolling=[],
        step_minutes=step_minutes,
        horizon=horizon,
        models={},
        metrics=metrics,
        n_samples=int(len(power)),
        version="v1-fallback",
        seasonal_period=period,
        residual_std=residual_std,
    )


def train_model(
    facility_id: str,
    history: Sequence[Any],
    *,
    model_type: str = "generic",
    horizon: int = 96,
    test_fraction: float = 0.2,
    step_minutes: int = 15,
    persist: bool = True,
) -> tuple[ModelBundle, str]:
    """Train and (optionally) persist a bundle. Returns (bundle, status)."""
    arrays = series_to_arrays(history, step_minutes=step_minutes)
    power = arrays["power_kw"]
    n = len(power)

    if n < MIN_SAMPLES_FOR_ML:
        bundle = _seasonal_fallback_bundle(
            facility_id, model_type, step_minutes, horizon, power, arrays
        )
        if persist:
            save_bundle(bundle)
        return bundle, "trained_fallback"

    lags = select_lags(n)
    rolling = select_rolling(n)
    names = feature_names(lags, rolling)
    groups = feature_groups_for(lags, rolling)

    X, y, idx = build_training_matrix(
        arrays["ts"],
        power,
        arrays["temp_out"],
        arrays["humidity"],
        arrays["irradiance"],
        arrays["ci"],
        arrays["occupancy"],
        lags,
        rolling,
    )

    if len(y) < MIN_SAMPLES_FOR_ML:
        bundle = _seasonal_fallback_bundle(
            facility_id, model_type, step_minutes, horizon, power, arrays
        )
        if persist:
            save_bundle(bundle)
        return bundle, "trained_fallback"

    split = int(round((1.0 - test_fraction) * len(y)))
    split = max(1, min(len(y) - 1, split))
    X_train, y_train = X[:split], y[:split]
    X_test, y_test = X[split:], y[split:]

    models: dict[str, Any] = {}
    for q in QUANTILES:
        est = _make_estimator(q)
        est.fit(X_train, y_train)
        models[f"{q:.2f}"] = est

    # Enforce monotone quantiles (q10 <= q50 <= q90) on the training fit.
    train_pred = _stack_quantiles(models, X_train)
    test_pred = _stack_quantiles(models, X_test)

    metrics: dict[str, Any] = {}
    if len(y_test) >= 8:
        metrics = evaluate.all_metrics(
            y_test, test_pred["q50"], test_pred["q10"], test_pred["q90"]
        )
    else:
        metrics = evaluate.all_metrics(y_train, train_pred["q50"])

    residual = y_train - train_pred["q50"]
    residual_std = float(np.std(residual)) if len(residual) else 0.0

    bundle = ModelBundle(
        facility_id=facility_id,
        model_type=model_type,
        backend=backend_name(),
        feature_names=names,
        feature_groups=groups,
        lags=lags,
        rolling=rolling,
        step_minutes=step_minutes,
        horizon=horizon,
        models=models,
        metrics=metrics,
        n_samples=int(len(y)),
        version="v1",
        seasonal_period=max(1, int(round(24 * 60 / step_minutes))),
        residual_std=residual_std,
        training_window={
            "start": str(idx[0]) + " (" + str(arrays["ts"][idx[0]]) + ")",
            "end": str(arrays["ts"][idx[-1]]),
        },
    )
    if persist:
        save_bundle(bundle)
    return bundle, "trained"


def _stack_quantiles(models: dict[str, Any], X: np.ndarray) -> dict[str, np.ndarray]:
    """Predict all quantiles and enforce monotonicity."""
    preds = {q: models[q].predict(X) for q in models}
    order = ["0.10", "0.50", "0.90"]
    present = [o for o in order if o in preds]
    if len(present) == 3:
        p10 = np.minimum(preds["0.10"], preds["0.50"])
        p90 = np.maximum(preds["0.90"], preds["0.50"])
        preds["0.10"], preds["0.90"] = p10, p90
    return {
        "q10": preds.get("0.10", preds.get(present[0])),
        "q50": preds.get("0.50", preds.get(present[len(present) // 2])),
        "q90": preds.get("0.90", preds.get(present[-1])),
    }


def top_features(bundle: ModelBundle, k: int = 8) -> list[str]:
    """Rank features by the q50 model's impurity importance if available."""
    model = bundle.model_for(0.5)
    if model is None:
        return []
    importances = getattr(model, "feature_importances_", None)
    if importances is None or not len(bundle.feature_names):
        return bundle.feature_names[:k]
    order = np.argsort(importances)[::-1][:k]
    return [bundle.feature_names[i] for i in order if i < len(bundle.feature_names)]
