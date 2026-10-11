"""Forecast training / prediction tests (works with LightGBM or the sklearn fallback)."""
from __future__ import annotations

import numpy as np

from app.forecasting.predict import emissions_band, forecast
from app.forecasting.train import train_model


def test_train_and_forecast_shapes(history):
    bundle, status = train_model(
        "test-office",
        history,
        model_type="office",
        horizon=96,
        step_minutes=15,
        persist=False,
    )
    assert status in {"trained", "trained_fallback"}
    assert bundle.n_samples > 0

    preds = forecast(bundle, history, future_weather=[], horizon=96, step_minutes=15)
    for key in ("q10", "q50", "q90"):
        assert len(preds[key]) == 96
        assert np.all(np.isfinite(preds[key]))
    # Quantiles ordered.
    assert np.all(preds["q10"] <= preds["q50"] + 1e-6)
    assert np.all(preds["q50"] <= preds["q90"] + 1e-6)
    assert np.all(preds["q50"] >= 0)

    em = emissions_band(preds["q10"], preds["q50"], preds["q90"], preds["ci"], 15)
    assert np.all(em["p10"] <= em["p90"] + 1e-9)


def test_metrics_present_when_trained(history):
    bundle, status = train_model("test-metrics", history, step_minutes=15, persist=False)
    if status == "trained":
        assert "mae" in bundle.metrics
        assert bundle.metrics["mape"] == bundle.metrics["mape"]  # not NaN
    assert bundle.feature_names


def test_forecast_uses_provided_future_weather(history):
    from tests.conftest import synthetic_day

    day = synthetic_day(96, 15)
    future = [
        {
            "ts": None,
            "power_kw": 0.0,
            "temp_out": day["outdoor_temp_profile"][i],
            "irradiance": day["solar_profile"][i],
            "occupancy": day["occupancy_profile"][i],
            "ci": day["ci_profile"][i],
        }
        for i in range(96)
    ]
    bundle, _ = train_model("test-fw", history, step_minutes=15, persist=False)
    preds = forecast(bundle, history, future, horizon=96, step_minutes=15)
    assert len(preds["ci"]) == 96
    assert preds["ci"][0] == day["ci_profile"][0]
