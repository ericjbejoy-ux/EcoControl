"""HTTP contract smoke tests via FastAPI TestClient (skipped if httpx missing)."""
from __future__ import annotations

import pytest

pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def _history_payload(history):
    return [
        {
            "ts": p["ts"].isoformat(),
            "power_kw": p["power_kw"],
            "temp_out": p["temp_out"],
            "humidity": p["humidity"],
            "irradiance": p["irradiance"],
            "ci": p["ci"],
            "occupancy": p["occupancy"],
        }
        for p in history
    ]


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] in {"ok", "degraded"}
    assert "backend" in body


def test_twin_simulate_endpoint():
    r = client.post(
        "/twin/simulate",
        json={"facility_id": "sim", "horizon": 24, "throttle": 0.6, "outdoor_temp_c": 31.0},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["points"]) == 24
    assert body["emissions_kg"] >= 0


def test_optimize_endpoint():
    r = client.post(
        "/optimize",
        json={"facility_id": "opt", "horizon": 48, "throttle_min": 0.2},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["schedule"]) == 48
    assert body["narrative"]


def test_scenario_evaluate_endpoint():
    r = client.post(
        "/scenario/evaluate",
        json={
            "facility_id": "office-tower-01",
            "levers": [
                {"type": "hvac_peak_shaving", "params": {"capPct": 85}},
                {"type": "rooftop_solar", "params": {"kWp": 250}},
            ],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["kpis"]["tco2e_avoided_year"] > 0


def test_forecast_endpoint(history):
    r = client.post(
        "/ml/forecast",
        json={
            "facility_id": "office-tower-01",
            "history": _history_payload(history),
            "horizon": 24,
        },
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["points"]) == 24


def test_anomaly_endpoint(history):
    r = client.post(
        "/anomaly/detect",
        json={"facility_id": "office-tower-01", "history": _history_payload(history)},
    )
    assert r.status_code == 200, r.text
    assert "flags" in r.json()
