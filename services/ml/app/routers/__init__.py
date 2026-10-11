"""Aggregate all ML routers."""
from fastapi import APIRouter

from app.routers import anomaly, explain, forecast, ml, optimize, scenario, twin

api_router = APIRouter()
api_router.include_router(ml.router)
api_router.include_router(forecast.router)
api_router.include_router(explain.router)
api_router.include_router(twin.router)
api_router.include_router(optimize.router)
api_router.include_router(scenario.router)
api_router.include_router(anomaly.router)

__all__ = ["api_router"]
