"""Forecast endpoint: POST /ml/forecast (quantile LightGBM + prediction band)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from app.config import settings
from app.data_utils import infer_step_minutes, series_to_arrays, to_datetime
from app.forecasting.predict import emissions_band, forecast
from app.forecasting.train import train_model
from app.mock.mock_responses import forecast_mock
from app.registry.model_store import load_bundle
from app.routers.ml import use_mocks
from app.schemas import (
    ForecastPoint,
    ForecastRequest,
    ForecastResponse,
    ModelMetrics,
)

router = APIRouter(tags=["forecast"])


def _resolve_bundle(req: ForecastRequest):
    notes: list[str] = []
    step = req.step_minutes
    bundle = load_bundle(req.facility_id)
    if bundle is None:
        bundle, status = train_model(
            req.facility_id,
            req.history,
            model_type=req.model_type,
            horizon=req.horizon,
            step_minutes=step,
            persist=req.train_if_missing,
        )
        notes.append(f"Model {'trained' if req.train_if_missing else 'built in-memory'} ({status}).")
    return bundle, notes


@router.post("/ml/forecast", response_model=ForecastResponse)
def create_forecast(req: ForecastRequest) -> ForecastResponse:
    if use_mocks():
        return ForecastResponse(**forecast_mock(req.facility_id))

    arrays = series_to_arrays(req.history, step_minutes=req.step_minutes)
    step = infer_step_minutes(arrays["ts"], req.step_minutes)

    bundle, notes = _resolve_bundle(req)
    preds = forecast(
        bundle,
        req.history,
        req.future_weather,
        horizon=req.horizon,
        step_minutes=step,
        fallback_start_ts=None,
    )
    em = emissions_band(preds["q10"], preds["q50"], preds["q90"], preds["ci"], step)

    points = []
    for i in range(req.horizon):
        points.append(
            ForecastPoint(
                ts=to_datetime(preds["ts"][i]),
                power_kw_p10=round(float(preds["q10"][i]), 3),
                power_kw_p50=round(float(preds["q50"][i]), 3),
                power_kw_p90=round(float(preds["q90"][i]), 3),
                emissions_kg_p10=round(float(em["p10"][i]), 5),
                emissions_kg_p50=round(float(em["p50"][i]), 5),
                emissions_kg_p90=round(float(em["p90"][i]), 5),
                ci=round(float(preds["ci"][i]), 2),
                temp_out=(
                    round(float(preds["temp_out"][i]), 2) if "temp_out" in preds else None
                ),
            )
        )

    data_source = "cached" if req.future_weather else "synthetic"
    if not req.future_weather:
        notes.append("No future weather/CI supplied — used synthetic diurnal profiles.")

    metrics = None
    if bundle.metrics:
        metrics = ModelMetrics(
            mae=bundle.metrics.get("mae"),
            rmse=bundle.metrics.get("rmse"),
            mape=bundle.metrics.get("mape"),
            r2=bundle.metrics.get("r2"),
            coverage_p10_p90=bundle.metrics.get("coverage_p10_p90"),
        )

    return ForecastResponse(
        facility_id=req.facility_id,
        generated_at=datetime.now(timezone.utc),
        horizon=req.horizon,
        step_minutes=step,
        model_version=bundle.version,
        backend=bundle.backend,
        points=points,
        metrics=metrics,
        data_source=data_source,
        notes=notes,
    )
