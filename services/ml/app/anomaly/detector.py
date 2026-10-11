"""Anomaly / waste detection (FR-19, SRS §5.8).

Two complementary signals:

* **Residual z-score** — robust (median/MAD) deviation from the expected load
  (forecast if provided, else a seasonal-rolling baseline). Catches "the load
  should not be here" events like a weekend AHU running unoccupied.
* **Isolation Forest** — unsupervised multivariate outlier score over
  (power, hour-of-day) to catch shape anomalies the residual misses.

Flagged intervals carry an *estimated wasted* kgCO₂e so the Command Center anomaly
feed can quantify the opportunity, not just raise an alarm.
"""
from __future__ import annotations

from typing import Any, Optional, Sequence

import numpy as np

from app.data_utils import series_to_arrays

try:  # pragma: no cover
    from sklearn.ensemble import IsolationForest

    _ISO_AVAILABLE = True
except Exception:  # noqa: BLE001
    IsolationForest = None  # type: ignore
    _ISO_AVAILABLE = False

MAD_SCALE = 1.4826


def _seasonal_baseline(power: np.ndarray, period: int) -> np.ndarray:
    """Rolling seasonal median baseline (same slot on previous days)."""
    n = len(power)
    baseline = np.full(n, np.nan)
    for i in range(n):
        j = i - period
        window = [power[j - period * k] for k in range(1, 4) if j - period * k >= 0]
        if window:
            baseline[i] = float(np.median(window))
    if np.all(np.isnan(baseline)):
        baseline = np.full(n, float(np.median(power)) if n else 0.0)
    else:
        fallback = float(np.nanmedian(baseline))
        baseline = np.where(np.isnan(baseline), fallback, baseline)
    return baseline


def detect(
    history: Sequence[Any],
    *,
    expected_power_kw: Optional[Sequence[float]] = None,
    z_threshold: float = 3.0,
    contamination: float = 0.05,
    step_minutes: int = 15,
    ci_g_per_kwh: Optional[float] = None,
) -> dict:
    arrays = series_to_arrays(history, step_minutes=step_minutes)
    power = arrays["power_kw"]
    ts = arrays["ts"]
    n = len(power)
    method = "residual_zscore"

    if n < 8:
        return {
            "method": method,
            "n_flagged": 0,
            "total_est_waste_kg_co2e": 0.0,
            "flags": [],
            "notes": ["Not enough history for anomaly detection."],
        }

    ci = float(ci_g_per_kwh) if ci_g_per_kwh else float(np.mean(arrays["ci"]))
    period = max(1, int(round(24 * 60 / step_minutes)))

    if expected_power_kw and len(expected_power_kw) == n:
        expected = np.asarray(expected_power_kw, dtype=float)
        method = "residual_zscore (forecast)"
    else:
        expected = _seasonal_baseline(power, period)

    residual = power - expected
    med = float(np.median(residual))
    mad = float(np.median(np.abs(residual - med))) * MAD_SCALE
    scale = mad if mad > 1e-6 else (float(np.std(residual)) or 1.0)
    z = (residual - med) / scale

    iso_labels = np.ones(n, dtype=int)
    iso_scores = np.zeros(n)
    if _ISO_AVAILABLE and n >= 32:
        hours = (ts.astype("datetime64[h]").astype(int) % 24).astype(float)
        features = np.column_stack([power, hours])
        iso = IsolationForest(
            contamination=min(max(contamination, 0.01), 0.4), random_state=42
        )
        iso_labels = iso.fit_predict(features)
        iso_scores = iso.score_samples(features)

    flags = []
    for i in range(n):
        z_i = float(z[i])
        iso_flag = iso_labels[i] == -1
        if abs(z_i) < z_threshold and not (iso_flag and residual[i] > 0):
            continue
        if residual[i] <= 0 and abs(z_i) < z_threshold:
            continue

        excess_kwh = max(0.0, float(residual[i])) * step_minutes / 60.0
        waste = excess_kwh * ci / 1000.0
        severity = "critical" if abs(z_i) >= 5 else ("warning" if abs(z_i) >= z_threshold else "info")

        hour = int(ts[i].astype("datetime64[h]").astype(int) % 24)
        reason = (
            f"Consumption {float(power[i]):.0f} kW vs expected {float(expected[i]):.0f} kW "
            f"({z_i:+.1f}σ)"
        )
        if 0 <= hour <= 5 and float(power[i]) > 0.4 * float(np.max(power)):
            reason = (
                f"Heavy load at {hour:02d}:00 while typically unoccupied — "
                f"possible AHU/plant running out of hours"
            )
            severity = "critical" if severity != "critical" else severity

        flags.append(
            {
                "ts": ts[i].astype("datetime64[ms]").astype("O"),
                "severity": severity,
                "method": method,
                "score": round(z_i, 3),
                "observed_kw": round(float(power[i]), 3),
                "expected_kw": round(float(expected[i]), 3),
                "excess_kwh": round(excess_kwh, 4),
                "est_waste_kg_co2e": round(waste, 4),
                "reason": reason,
            }
        )

    total_waste = float(sum(f["est_waste_kg_co2e"] for f in flags))
    return {
        "method": method + (" + isolation_forest" if _ISO_AVAILABLE and n >= 32 else ""),
        "n_flagged": len(flags),
        "total_est_waste_kg_co2e": round(total_waste, 4),
        "flags": flags,
        "notes": [
            f"Robust z-threshold {z_threshold} on a {period}-step seasonal baseline.",
            f"Waste valued at {ci:.0f} gCO₂/kWh.",
        ],
    }
