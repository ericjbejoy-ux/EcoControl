"""Shared pytest fixtures + synthetic data generator for the ML service tests."""
from __future__ import annotations

import math
import os
import tempfile
from datetime import datetime, timedelta

import numpy as np

# Redirect the model registry to a throwaway dir BEFORE app.config is imported.
os.environ.setdefault("ML_MODEL_DIR", tempfile.mkdtemp(prefix="carbontwin-test-artifacts-"))
os.environ.setdefault("ML_USE_MOCKS", "false")

import pytest  # noqa: E402


def synthetic_history(n: int = 600, step_minutes: int = 15, peak_kw: float = 800.0, seed: int = 7):
    """Realistic-ish office profile with weather + grid-CI dependence."""
    rng = np.random.default_rng(seed)
    start = datetime(2025, 6, 1)
    points = []
    for i in range(n):
        ts = start + timedelta(minutes=step_minutes * i)
        hour = ts.hour + ts.minute / 60.0
        occ = max(0.0, math.sin(math.pi * (hour - 7.0) / 12.0))
        temp_out = 30.0 + 6.0 * math.sin(2 * math.pi * (hour - 9.0) / 24.0) + 0.4 * rng.standard_normal()
        irradiance = max(0.0, math.sin(math.pi * (hour - 6.0) / 12.0)) * 800.0
        ci = 480.0 - 160.0 * math.cos(2 * math.pi * (hour - 4.0) / 24.0)
        power = peak_kw * (0.35 + 0.65 * occ) + 8.0 * (temp_out - 28.0) + 25.0 * rng.standard_normal()
        power = max(20.0, power)
        points.append(
            {
                "ts": ts,
                "power_kw": round(power, 3),
                "temp_out": round(temp_out, 2),
                "humidity": 55.0,
                "irradiance": round(irradiance, 1),
                "ci": round(ci, 1),
                "occupancy": round(occ, 3),
            }
        )
    return points


def synthetic_day(n: int = 96, step_minutes: int = 15):
    """One full day of profile arrays for the twin / optimizer tests.

    Keys match ``mpc.optimize`` kwargs (``*_profile``).
    """
    hours = np.linspace(0, 24, n, endpoint=False)
    return {
        "outdoor_temp_profile": (30.0 + 6.0 * np.sin(2 * np.pi * (hours - 9.0) / 24.0)).tolist(),
        "solar_profile": (np.clip(np.sin(np.pi * (hours - 6.0) / 12.0), 0, None) * 800.0).tolist(),
        "occupancy_profile": (np.clip(np.sin(np.pi * (hours - 7.0) / 12.0), 0, None)).tolist(),
        "ci_profile": (480.0 - 160.0 * np.cos(2 * np.pi * (hours - 4.0) / 24.0)).tolist(),
    }


@pytest.fixture
def history():
    return synthetic_history()


@pytest.fixture
def day_profiles():
    return synthetic_day()
