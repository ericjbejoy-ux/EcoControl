"""Anomaly endpoint: POST /anomaly/detect."""
from __future__ import annotations

from fastapi import APIRouter

from app.anomaly import detector
from app.mock.mock_responses import anomaly_mock
from app.routers.ml import use_mocks
from app.schemas import AnomalyDetectRequest, AnomalyDetectResponse, AnomalyFlag

router = APIRouter(tags=["anomaly"])


@router.post("/anomaly/detect", response_model=AnomalyDetectResponse)
def detect_anomalies(req: AnomalyDetectRequest) -> AnomalyDetectResponse:
    if use_mocks():
        return AnomalyDetectResponse(**anomaly_mock(req.facility_id))

    result = detector.detect(
        req.history,
        expected_power_kw=req.expected_power_kw or None,
        z_threshold=req.z_threshold,
        contamination=req.contamination,
        step_minutes=req.step_minutes,
        ci_g_per_kwh=req.ci_g_per_kwh,
    )
    return AnomalyDetectResponse(
        facility_id=req.facility_id,
        method=result["method"],
        n_flagged=result["n_flagged"],
        total_est_waste_kg_co2e=result["total_est_waste_kg_co2e"],
        flags=[AnomalyFlag(**f) for f in result["flags"]],
        notes=result["notes"],
    )
