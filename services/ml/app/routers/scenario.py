"""Scenario endpoints: /scenario/evaluate and /scenario/macc."""
from __future__ import annotations

from fastapi import APIRouter

from app.mock.mock_responses import macc_mock, scenario_mock
from app.routers.ml import use_mocks
from app.scenarios import engine
from app.scenarios.macc import with_cumulative
from app.schemas import (
    LeverResult,
    MaccResponse,
    ScenarioEvaluateRequest,
    ScenarioEvaluateResponse,
    ScenarioKPIs,
    ScenarioSeries,
)

router = APIRouter(tags=["scenario"])


@router.post("/scenario/evaluate", response_model=ScenarioEvaluateResponse)
def evaluate_scenario(req: ScenarioEvaluateRequest) -> ScenarioEvaluateResponse:
    if use_mocks():
        return ScenarioEvaluateResponse(**scenario_mock(req.facility_id))

    result = engine.evaluate_scenario(req.levers, req.context)
    return ScenarioEvaluateResponse(
        facility_id=req.facility_id,
        levers=[LeverResult(**l) for l in result["levers"]],
        kpis=ScenarioKPIs(**result["kpis"]),
        series=ScenarioSeries(**result["series"]),
        narrative=result["narrative"],
        notes=result["notes"],
    )


@router.get("/scenario/macc", response_model=MaccResponse)
def macc_default(facility_id: str = "scenario") -> MaccResponse:
    if use_mocks():
        return MaccResponse(**macc_mock(facility_id))
    data = with_cumulative(engine.build_macc({}))
    data["facility_id"] = facility_id
    return MaccResponse(**data)


@router.post("/scenario/macc", response_model=MaccResponse)
def macc_custom(payload: dict | None = None) -> MaccResponse:
    if use_mocks():
        return MaccResponse(**macc_mock("scenario"))
    payload = payload or {}
    data = with_cumulative(
        engine.build_macc(payload.get("context"), payload.get("levers"))
    )
    if payload.get("facility_id"):
        data["facility_id"] = payload["facility_id"]
    return MaccResponse(**data)
