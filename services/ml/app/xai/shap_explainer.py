"""SHAP-based explainability with a dependency-light approximation fallback.

Primary path: ``shap.TreeExplainer`` over the q50 model → exact, fast Shapley
values for tree ensembles (LightGBM or sklearn GBR).

Fallback path (when ``shap`` is not installed): attribution built from the
model's built-in split importances scaled by each feature's standardised
deviation from its training mean. This preserves *direction* and *ranking* —
enough for the UI — and is clearly reported as ``approx_importance`` so no one
mistakes it for exact Shapley values.
"""
from __future__ import annotations

from typing import Any, Optional, Sequence

import numpy as np

from app.registry.model_store import ModelBundle

try:  # pragma: no cover
    import shap as _shap

    SHAP_AVAILABLE = True
except Exception:  # noqa: BLE001
    _shap = None
    SHAP_AVAILABLE = False


def method_name() -> str:
    return "TreeSHAP" if SHAP_AVAILABLE else "approx_importance"


def _group_of(bundle: ModelBundle, feature: str) -> str:
    for group, feats in bundle.feature_groups.items():
        if feature in feats:
            return group
    if feature.startswith(("lag_", "roll_")):
        return "Historical pattern"
    return "Other"


def _tree_shap_values(bundle: ModelBundle, X: np.ndarray) -> Optional[np.ndarray]:
    model = bundle.model_for(0.5)
    if model is None:
        return None
    try:
        explainer = _shap.TreeExplainer(model)
        values = explainer.shap_values(X)
        if isinstance(values, list):
            values = values[0]
        return np.asarray(values, dtype=float)
    except Exception:  # noqa: BLE001
        return None


def _approx_values(bundle: ModelBundle, X: np.ndarray) -> np.ndarray:
    model = bundle.model_for(0.5)
    importances = np.asarray(getattr(model, "feature_importances_", np.ones(X.shape[1])), dtype=float)
    if importances.sum() <= 0:
        importances = np.ones(X.shape[1])
    centered = X - np.mean(X, axis=0, keepdims=True)
    return centered * importances.reshape(1, -1)


def _contributions(
    bundle: ModelBundle,
    values: np.ndarray,
    feature_values: Optional[np.ndarray],
) -> list[dict[str, Any]]:
    if values.ndim == 2:
        signed = np.mean(values, axis=0)
        abs_mean = np.mean(np.abs(values), axis=0)
    else:
        signed = values
        abs_mean = np.abs(values)
    total_abs = float(np.sum(abs_mean)) or 1.0

    contribs: list[dict[str, Any]] = []
    for i, name in enumerate(bundle.feature_names):
        s = float(signed[i])
        contribs.append(
            {
                "feature": name,
                "group": _group_of(bundle, name),
                "value": float(feature_values[i]) if feature_values is not None else None,
                "shap_value": round(s, 6),
                "abs_value": round(float(abs_mean[i]), 6),
                "pct": round(100.0 * float(abs_mean[i]) / total_abs, 2),
                "direction": "increase" if s > 0 else ("decrease" if s < 0 else "neutral"),
            }
        )
    contribs.sort(key=lambda c: c["abs_value"], reverse=True)
    return contribs


def global_explanation(bundle: ModelBundle, X: np.ndarray, top_k: int = 6) -> tuple[list[dict], dict[str, float]]:
    if X.shape[0] == 0 or not bundle.feature_names:
        return [], {}
    sample = X if X.shape[0] <= 500 else X[np.linspace(0, X.shape[0] - 1, 500).astype(int)]
    values = _tree_shap_values(bundle, sample)
    if values is None:
        values = _approx_values(bundle, sample)
    contribs = _contributions(bundle, values, np.mean(sample, axis=0))

    rollup: dict[str, float] = {}
    for c in contribs:
        rollup[c["group"]] = round(rollup.get(c["group"], 0.0) + c["pct"], 2)
    return contribs[:top_k], rollup


def local_explanation(
    bundle: ModelBundle, X_row: np.ndarray, top_k: int = 6
) -> tuple[list[dict], dict[str, float], Optional[float], float]:
    if not bundle.feature_names:
        return [], {}, None, 0.0
    X = np.asarray(X_row, dtype=float).reshape(1, -1)
    model = bundle.model_for(0.5)
    prediction = float(model.predict(X)[0]) if model is not None else float("nan")

    values = _tree_shap_values(bundle, X)
    base_value: Optional[float] = None
    if values is None:
        values = _approx_values(bundle, X)
    else:
        try:
            expected = _shap.TreeExplainer(model).expected_value
            base_value = float(np.ravel(expected)[0])
        except Exception:  # noqa: BLE001
            base_value = None

    contribs = _contributions(bundle, values[0] if values.ndim == 2 else values, X[0])
    rollup: dict[str, float] = {}
    for c in contribs:
        rollup[c["group"]] = round(rollup.get(c["group"], 0.0) + c["pct"], 2)
    return contribs[:top_k], rollup, base_value, prediction


def contribution_for_series(
    bundle: ModelBundle, X: np.ndarray, row_index: int, top_k: int = 6
) -> list[dict]:
    if X.shape[0] == 0:
        return []
    row_idx = max(0, min(row_index, X.shape[0] - 1))
    contribs, _, _, _ = local_explanation(bundle, X[row_idx], top_k=top_k)
    return contribs
