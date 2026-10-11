"""FastAPI application entrypoint for the CarbonTwin ML / Digital Twin service."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.forecasting.train import LIGHTGBM_AVAILABLE, backend_name
from app.routers import api_router
from app.schemas import CONTRACT_VERSION, HealthResponse
from app.xai.shap_explainer import SHAP_AVAILABLE

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
)
logger = logging.getLogger("carbontwin.ml")

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "Physics-informed Digital Twin (RC), LightGBM quantile forecasting, "
        "SHAP explainability, carbon-aware MPC, scenario economics and anomaly "
        "detection for CarbonTwin."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ValueError)
async def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
    logger.warning("Validation error: %s", exc)
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.get("/", tags=["meta"])
def root() -> dict:
    return {
        "service": settings.app_name,
        "version": settings.version,
        "contract_version": CONTRACT_VERSION,
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health", response_model=HealthResponse, tags=["meta"])
def health() -> HealthResponse:
    dependencies = {
        "numpy": True,
        "scipy": True,
        "scikit-learn": True,
        "lightgbm": LIGHTGBM_AVAILABLE,
        "shap": SHAP_AVAILABLE,
    }
    return HealthResponse(
        status="ok" if (LIGHTGBM_AVAILABLE and SHAP_AVAILABLE) else "degraded",
        service=settings.app_name,
        version=settings.version,
        contract_version=CONTRACT_VERSION,
        environment=settings.environment,
        backend=backend_name(),
        shap_available=SHAP_AVAILABLE,
        lightgbm_available=LIGHTGBM_AVAILABLE,
        dependencies=dependencies,
        time=datetime.now(timezone.utc),
    )


app.include_router(api_router)


@app.on_event("startup")
def _startup() -> None:
    logger.info(
        "%s v%s up (backend=%s, shap=%s, model_dir=%s)",
        settings.app_name,
        settings.version,
        backend_name(),
        SHAP_AVAILABLE,
        settings.model_dir,
    )
