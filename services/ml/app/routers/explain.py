"""Explainability endpoint: POST /ml/explain (SHAP global + local + NLG)."""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter

from app.config import settings
from app.data_utils import series_to_arrays, to_datetime
from app.forecasting.features import build_inference_row, build_training_matrix
from app.forecasting.train import train_model
from app.mock.mock_responses import explain_mock
from app.registry.model_store import load_bundle
from app.routers.ml import use_mocks
from app.schemas import ExplainRequest, ExplainResponse, FeatureContribution
from app.xai import nlg
from app.xai.shap_explainer import (
    SHAP_AVAILABLE,
    global_explanation,
    local_explanation,
    method_name,
)

router = APIRouter(tags=["explain"])


def _to_contribs(items: list[dict]) -> list[FeatureContribution]:
    return [FeatureContribution(**c) for c in items]


@router.post("/ml/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest) -> ExplainResponse:
    if use_mocks():
        return ExplainResponse(**explain_mock(req.facility_id))

    bundle = load_bundle(req.facility_id)
    notes: list[str] = []
    if bundle is None:
        bundle, status = train_model(
            req.facility_id,
            req.history,
            model_type=req.model_type,
            step_minutes=settings.step_minutes,
            persist=False,
        )
        notes.append(f"Model built for explanation ({status}).")

    if not bundle.models:
        return ExplainResponse(
            facility_id=req.facility_id,
            method=method_name(),
            backend=bundle.backend,
            global_importance=[],
            local=[],
            narrative="Insufficient data for SHAP explanation; using seasonal baseline.",
            notes=notes + ["No tree model available (seasonal-naive fallback)."],
        )

    arrays = series_to_arrays(req.history, step_minutes=bundle.step_minutes)
    X, _y, idx = build_training_matrix(
        arrays["ts"],
        arrays["power_kw"],
        arrays["temp_out"],
        arrays["humidity"],
        arrays["irradiance"],
        arrays["ci"],
        arrays["occupancy"],
        bundle.lags,
        bundle.rolling,
    )

    global_contribs, rollup = (
        global_explanation(bundle, X, top_k=req.top_k) if req.global_explain else ([], {})
    )

    local_contribs: list[dict] = []
    base_value = None
    predicted = None
    explained_ts = None
    narrative = None

    if req.ts is not None and len(X) > 0:
        ts_arr = arrays["ts"]
        target = np.datetime64(req.ts.replace(tzinfo=None))
        global_idx = int(np.argmin(np.abs(ts_arr.astype("datetime64[ns]") - target)))
        try:
            row = build_inference_row(
                global_idx,
                arrays["ts"],
                arrays["power_kw"],
                arrays["temp_out"],
                arrays["humidity"],
                arrays["irradiance"],
                arrays["ci"],
                arrays["occupancy"],
                bundle.lags,
                bundle.rolling,
            )
            local_contribs, local_rollup, base_value, predicted = local_explanation(
                bundle, row, top_k=req.top_k
            )
            rollup = local_rollup or rollup
            explained_ts = to_datetime(ts_arr[global_idx])
            narrative = nlg.explain_contributions(
                local_contribs, ts=explained_ts, predicted_power_kw=predicted
            )
        except ValueError as exc:
            notes.append(f"Could not build local features: {exc}")

    if narrative is None and global_contribs:
        narrative = nlg.explain_group_rollup(rollup)

    return ExplainResponse(
        facility_id=req.facility_id,
        method=method_name(),
        backend=bundle.backend,
        base_value=base_value,
        predicted_power_kw=predicted,
        explained_ts=explained_ts,
        global_importance=_to_contribs(global_contribs),
        local=_to_contribs(local_contribs),
        narrative=narrative,
        group_rollup=rollup,
        notes=notes
        + ([] if SHAP_AVAILABLE else ["`shap` not installed — approximate importances shown."]),
    )
