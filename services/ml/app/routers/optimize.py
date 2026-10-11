"""Optimization endpoint: POST /optimize (carbon-aware MPC)."""
from __future__ import annotations

from fastapi import APIRouter

from app.mock.mock_responses import optimize_mock
from app.optimization import mpc
from app.routers.ml import use_mocks
from app.schemas import OptimizeRequest, OptimizeResponse, SchedulePoint
from app.xai import nlg

router = APIRouter(tags=["optimize"])


@router.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest) -> OptimizeResponse:
    if use_mocks():
        return OptimizeResponse(**optimize_mock(req.facility_id))

    result = mpc.optimize(
        horizon=req.horizon,
        step_minutes=req.step_minutes,
        params=req.params,
        comfort_min_c=req.comfort.min_c,
        comfort_max_c=req.comfort.max_c,
        initial_temp_in=req.initial_temp_in,
        throttle_min=req.throttle_min,
        lambda_comfort=req.lambda_comfort,
        mu_ramp=req.mu_ramp,
        outdoor_temp_profile=req.outdoor_temp_profile,
        solar_profile=req.solar_profile,
        occupancy_profile=req.occupancy_profile,
        ci_profile=req.ci_profile,
        history_power_kw=req.history_power_kw,
        start_ts=req.start_ts,
    )

    schedule = [SchedulePoint(**p) for p in result["schedule"]]
    narrative = nlg.optimize_narrative(
        result["emissions_reduction_pct"],
        result["pre_cool_hour"],
        result["cleanest_hour"],
        result["comfort_violation_hours"],
    )

    return OptimizeResponse(
        facility_id=req.facility_id,
        solver=result["solver"],
        status=result["status"],
        schedule=schedule,
        baseline_emissions_kg=result["baseline_emissions_kg"],
        optimized_emissions_kg=result["optimized_emissions_kg"],
        emissions_saved_kg=result["emissions_saved_kg"],
        emissions_reduction_pct=result["emissions_reduction_pct"],
        baseline_energy_kwh=result["baseline_energy_kwh"],
        optimized_energy_kwh=result["optimized_energy_kwh"],
        comfort_violation_hours=result["comfort_violation_hours"],
        pre_cool_hour=result["pre_cool_hour"],
        cleanest_hour=result["cleanest_hour"],
        narrative=narrative,
        notes=[
            "Baseline = thermostat holding the comfort midpoint (or supplied history).",
            "SLSQP over the RC twin with soft comfort + ramp penalties.",
        ],
    )
