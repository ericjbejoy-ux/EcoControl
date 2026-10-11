"""Model lifecycle endpoints: /ml/train, /ml/model-card, /ml/models."""
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException

from app.config import settings
from app.data_utils import infer_step_minutes, series_to_arrays, to_datetime
from app.forecasting.train import backend_name, top_features, train_model
from app.registry.model_store import list_models, load_bundle, model_card
from app.schemas import (
    ModelCardResponse,
    ModelMetrics,
    TrainRequest,
    TrainResponse,
)

router = APIRouter(tags=["ml"])


def _metrics(d: dict | None) -> ModelMetrics | None:
    if not d:
        return None
    return ModelMetrics(
        mae=d.get("mae"),
        rmse=d.get("rmse"),
        mape=d.get("mape"),
        r2=d.get("r2"),
        coverage_p10_p90=d.get("coverage_p10_p90"),
    )


def use_mocks() -> bool:
    return os.getenv("ML_USE_MOCKS", "false").lower() in {"1", "true", "yes", "on"}


@router.post("/ml/train", response_model=TrainResponse)
def train(req: TrainRequest) -> TrainResponse:
    arrays = series_to_arrays(req.history, step_minutes=settings.step_minutes)
    step = infer_step_minutes(arrays["ts"], settings.step_minutes)
    bundle, status = train_model(
        req.facility_id,
        req.history,
        model_type=req.model_type,
        horizon=req.horizon,
        test_fraction=req.test_fraction,
        step_minutes=step,
        persist=True,
    )
    return TrainResponse(
        facility_id=req.facility_id,
        status=status,
        backend=bundle.backend,
        n_samples=bundle.n_samples,
        horizon=bundle.horizon,
        metrics=_metrics(bundle.metrics) or ModelMetrics(),
        model_version=bundle.version,
        trained_at=to_datetime(bundle.trained_at),
        top_features=top_features(bundle),
    )


@router.get("/ml/model-card/{facility_id}", response_model=ModelCardResponse)
def get_model_card(facility_id: str) -> ModelCardResponse:
    bundle = load_bundle(facility_id)
    if bundle is None:
        return ModelCardResponse(facility_id=facility_id, exists=False)
    card = model_card(bundle)
    return ModelCardResponse(
        facility_id=facility_id,
        exists=True,
        model_version=card["model_version"],
        backend=card["backend"],
        model_type=card["model_type"],
        trained_at=to_datetime(card["trained_at"]),
        n_samples=card["n_samples"],
        horizon=card["horizon"],
        metrics=_metrics(card["metrics"]),
        features=card["features"],
        feature_groups=card["feature_groups"],
        training_window=card.get("training_window"),
        target=card["target"],
        notes=card["notes"],
        model_card=card,
    )


@router.get("/ml/models")
def list_trained_models() -> dict:
    return {"backend": backend_name(), "models": list_models()}
