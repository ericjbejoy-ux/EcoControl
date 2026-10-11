"""Joblib-backed model registry. One bundle per facility (versioned)."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import joblib

from app.config import settings

QUANTILES = (0.1, 0.5, 0.9)


@dataclass
class ModelBundle:
    facility_id: str
    model_type: str
    backend: str
    feature_names: list[str]
    feature_groups: dict[str, list[str]]
    lags: list[int]
    rolling: list[int]
    step_minutes: int
    horizon: int
    models: dict[str, Any] = field(default_factory=dict)  # {"0.1": est, "0.5": est, "0.9": est}
    metrics: dict[str, Any] = field(default_factory=dict)
    n_samples: int = 0
    version: str = "v1"
    seasonal_period: int = 96
    residual_std: float = 0.0
    trained_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    training_window: dict[str, Optional[str]] = field(default_factory=dict)

    def model_for(self, q: float) -> Any:
        return self.models.get(f"{q:.2f}") or self.models.get(str(q))


def _bundle_path(facility_id: str) -> Path:
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in facility_id)
    return settings.model_dir / f"{safe}.joblib"


def _card_path(facility_id: str) -> Path:
    return _bundle_path(facility_id).with_suffix(".card.json")


def save_bundle(bundle: ModelBundle) -> Path:
    path = _bundle_path(bundle.facility_id)
    joblib.dump(bundle, path)
    card = model_card(bundle)
    _card_path(bundle.facility_id).write_text(json.dumps(card, indent=2), encoding="utf-8")
    return path


def load_bundle(facility_id: str) -> Optional[ModelBundle]:
    path = _bundle_path(facility_id)
    if not path.exists():
        return None
    try:
        return joblib.load(path)
    except Exception:
        return None


def delete_bundle(facility_id: str) -> bool:
    path = _bundle_path(facility_id)
    existed = path.exists()
    if existed:
        path.unlink()
    card = _card_path(facility_id)
    if card.exists():
        card.unlink()
    return existed


def list_models() -> list[str]:
    return sorted(p.stem for p in settings.model_dir.glob("*.joblib"))


def model_card(bundle: ModelBundle) -> dict[str, Any]:
    return {
        "facility_id": bundle.facility_id,
        "model_version": bundle.version,
        "backend": bundle.backend,
        "model_type": bundle.model_type,
        "trained_at": bundle.trained_at,
        "n_samples": bundle.n_samples,
        "horizon": bundle.horizon,
        "step_minutes": bundle.step_minutes,
        "target": "power_kw (15-min mean)",
        "quantiles": list(bundle.models.keys()) or [f"{q:.2f}" for q in QUANTILES],
        "metrics": bundle.metrics,
        "features": bundle.feature_names,
        "feature_groups": bundle.feature_groups,
        "lags": bundle.lags,
        "rolling": bundle.rolling,
        "training_window": bundle.training_window,
        "residual_std": bundle.residual_std,
        "notes": [
            "Quantile LightGBM (q10/q50/q90) when lightgbm is installed; "
            "scikit-learn GradientBoosting quantile fallback otherwise.",
            "Time-series hold-out split — no shuffling, no leakage.",
            "Prediction interval = q10..q90 (80% nominal coverage).",
        ],
    }


def save_card_json(facility_id: str, card: dict[str, Any]) -> Path:
    path = _card_path(facility_id)
    path.write_text(json.dumps(card, indent=2), encoding="utf-8")
    return path


def bundle_as_dict(bundle: ModelBundle) -> dict[str, Any]:
    data = asdict(bundle)
    data.pop("models", None)
    return data
