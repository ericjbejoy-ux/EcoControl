"""Digital twin endpoints: /twin/simulate and /twin/calibrate."""
from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
from fastapi import APIRouter

from app.config import settings
from app.data_utils import infer_step_minutes, series_to_arrays, to_datetime
from app.mock.mock_responses import twin_simulate_mock
from app.routers.ml import use_mocks
from app.schemas import (
    CalibrateRequest,
    CalibrateResponse,
    ComfortBand,
    TwinParams,
    TwinPoint,
    TwinSimulateRequest,
    TwinSimulateResponse,
)
from app.twin import calibrate as calibrate_mod
from app.twin import rc_model

router = APIRouter(tags=["twin"])


def _outdoor_profile(req: TwinSimulateRequest, n: int) -> np.ndarray:
    if req.outdoor_temp_profile:
        return rc_model.expand_profile(req.outdoor_temp_profile, n, 28.0)
    if req.outdoor_temp_c is not None:
        return np.full(n, float(req.outdoor_temp_c))
    return rc_model.synth_outdoor_profile(n)


@router.post("/twin/simulate", response_model=TwinSimulateResponse)
def twin_simulate(req: TwinSimulateRequest) -> TwinSimulateResponse:
    if use_mocks():
        return TwinSimulateResponse(**twin_simulate_mock(req.facility_id))

    n = req.horizon
    inputs = rc_model.TwinInputs(
        outdoor_temp_c=_outdoor_profile(req, n),
        solar_w_m2=rc_model.expand_profile(req.solar_profile, n, 0.0),
        occupancy=rc_model.expand_profile(req.occupancy_profile, n, 0.5),
        ci_g_per_kwh=rc_model.expand_profile(req.ci_profile, n, 500.0),
        throttle=rc_model.expand_profile(req.throttle_profile, n, req.throttle),
    )
    result = rc_model.simulate(
        inputs,
        req.params.model_dump(),
        initial_temp_in=req.initial_temp_in,
        step_minutes=req.step_minutes,
        internal_step_s=settings.twin_internal_step_s,
    )

    step_h = req.step_minutes / 60.0
    base = req.start_ts or datetime(2025, 1, 1)
    points = []
    violations = 0
    for k in range(n):
        ok = req.comfort.min_c - 0.05 <= result.temp_in[k] <= req.comfort.max_c + 0.05
        violations += 0 if ok else 1
        points.append(
            TwinPoint(
                ts=base + timedelta(minutes=req.step_minutes * k),
                temp_in=round(float(result.temp_in[k]), 3),
                temp_out=round(float(result.temp_out[k]), 3),
                power_kw=round(float(result.power_kw[k]), 3),
                cop=round(float(result.cop[k]), 3),
                cooling_kw=round(float(result.cooling_kw[k]), 3),
                emissions_kg=round(float(result.emissions_kg[k]), 5),
                ci=round(float(inputs.ci_g_per_kwh[k]), 2),
                throttle=round(float(result.throttle[k]), 4),
                comfort_ok=ok,
            )
        )

    energy_kwh = float(np.sum(result.power_kw) * step_h)
    emissions = float(np.sum(result.emissions_kg))
    min_t = float(np.min(result.temp_in))
    max_t = float(np.max(result.temp_in))
    viol_hours = violations * step_h
    interpretation = (
        f"Indoor temperature stayed between {min_t:.1f}–{max_t:.1f} °C "
        f"({viol_hours:.1f} h outside the {req.comfort.min_c:.0f}–{req.comfort.max_c:.0f} °C band); "
        f"HVAC used {energy_kwh:,.0f} kWh and emitted {emissions:,.0f} kgCO₂e."
    )

    return TwinSimulateResponse(
        facility_id=req.facility_id,
        step_minutes=req.step_minutes,
        comfort=req.comfort,
        points=points,
        params=req.params,
        energy_kwh=round(energy_kwh, 3),
        emissions_kg=round(emissions, 4),
        min_temp_in=round(min_t, 3),
        max_temp_in=round(max_t, 3),
        comfort_violation_hours=round(viol_hours, 3),
        interpretation=interpretation,
    )


@router.post("/twin/calibrate", response_model=CalibrateResponse)
def twin_calibrate(req: CalibrateRequest) -> CalibrateResponse:
    arrays = series_to_arrays(req.history, step_minutes=settings.step_minutes)
    step = infer_step_minutes(arrays["ts"], settings.step_minutes)
    fitted = calibrate_mod.calibrate(
        req.history, initial_guess=req.initial_guess, step_minutes=step
    )
    allowed = set(TwinParams.model_fields)
    params = TwinParams(**{k: v for k, v in fitted["params"].items() if k in allowed})
    return CalibrateResponse(
        facility_id=req.facility_id,
        status=fitted["status"],
        params=params,
        rmse_c=fitted["rmse_c"],
        mape_power=fitted["mape_power"],
        n_observations=fitted["n_observations"],
        notes=fitted["notes"],
    )
