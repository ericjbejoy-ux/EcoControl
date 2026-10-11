"""Runtime configuration for the CarbonTwin ML service.

Kept dependency-free (plain ``os.environ``) so the service can boot with an
empty environment, which matters for the offline demo pack (NFR-9 / NFR-2).
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return default
    return [part.strip() for part in raw.split(",") if part.strip()]


class Settings:
    """Immutable-ish settings container resolved once at import time."""

    def __init__(self) -> None:
        self.app_name: str = os.getenv("ML_APP_NAME", "CarbonTwin ML Service")
        self.version: str = os.getenv("ML_VERSION", "2.0.0")
        self.environment: str = os.getenv("ML_ENV", "development")
        self.log_level: str = os.getenv("ML_LOG_LEVEL", "INFO").upper()

        service_root = Path(__file__).resolve().parent.parent
        self.service_root: Path = service_root
        self.model_dir: Path = Path(
            os.getenv("ML_MODEL_DIR", str(service_root / "artifacts"))
        )

        # Physics / comfort / economics defaults (overridable per request).
        self.default_region: str = os.getenv("ML_DEFAULT_REGION", "IN-SO")
        self.comfort_min_c: float = _env_float("ML_COMFORT_MIN", 22.0)
        self.comfort_max_c: float = _env_float("ML_COMFORT_MAX", 26.0)
        self.default_tariff_usd_per_kwh: float = _env_float("ML_TARIFF_USD_KWH", 0.12)
        self.default_discount_rate: float = _env_float("ML_DISCOUNT_RATE", 0.08)
        self.default_project_years: int = _env_int("ML_PROJECT_YEARS", 15)

        self.step_minutes: int = _env_int("ML_STEP_MINUTES", 15)
        self.default_horizon: int = _env_int("ML_HORIZON_STEPS", 96)
        self.twin_internal_step_s: int = _env_int("ML_TWIN_INTERNAL_STEP_S", 60)

        # Set true to force the deterministic synthetic/offline responses.
        self.force_offline: bool = os.getenv("USE_FALLBACK_DATA", "false").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

        self.cors_origins: list[str] = _env_list(
            "ML_CORS_ORIGINS",
            ["http://localhost:5173", "http://localhost:4000", "http://localhost:3000"],
        )

        self.model_dir.mkdir(parents=True, exist_ok=True)

    # Convenience helpers -------------------------------------------------
    @property
    def hour_step(self) -> float:
        return self.step_minutes / 60.0

    @property
    def steps_per_day(self) -> int:
        return int(round(24 * 60 / self.step_minutes))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
