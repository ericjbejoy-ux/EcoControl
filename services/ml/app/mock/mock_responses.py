"""Deterministic mock payloads so M3 (gateway) and M4 (frontend) are never
blocked by ML progress (Co-Collaboration contract, Day 3).

These mirror the response schemas in ``app.schemas`` and the shared TS contract.
They are used by the routers when ``ML_USE_MOCKS=true`` or when a heavy
dependency is unavailable in a constrained environment.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

_NOW = datetime(2025, 6, 2, 12, 0, tzinfo=timezone.utc)


def _series(n: int = 96, step_minutes: int = 15, base: float = 700.0) -> list[dict]:
    import math

    points = []
    for i in range(n):
        ts = _NOW + timedelta(minutes=step_minutes * i)
        hour = ts.hour + ts.minute / 60.0
        load = base * (0.6 + 0.4 * math.sin(math.pi * (hour - 6) / 12)) if 6 < hour < 18 else base * 0.5
        ci = 480 - 160 * math.cos(2 * math.pi * (hour - 4) / 24)
        points.append(
            {
                "ts": ts.isoformat(),
                "power_kw_p10": round(load * 0.88, 2),
                "power_kw_p50": round(load, 2),
                "power_kw_p90": round(load * 1.12, 2),
                "emissions_kg_p10": round(load * 0.25 * ci / 1000 * 0.88, 4),
                "emissions_kg_p50": round(load * 0.25 * ci / 1000, 4),
                "emissions_kg_p90": round(load * 0.25 * ci / 1000 * 1.12, 4),
                "ci": round(ci, 1),
                "temp_out": round(30 + 6 * math.sin(2 * math.pi * (hour - 9) / 24), 2),
            }
        )
    return points


def forecast_mock(facility_id: str = "office-tower-01") -> dict:
    return {
        "facility_id": facility_id,
        "generated_at": _NOW.isoformat(),
        "horizon": 96,
        "step_minutes": 15,
        "model_version": "mock-v1",
        "backend": "mock",
        "points": _series(),
        "metrics": {"mae": 21.4, "rmse": 30.1, "mape": 8.7, "r2": 0.91, "coverage_p10_p90": 0.79},
        "data_source": "synthetic",
        "notes": ["MOCK response — ML service placeholder."],
    }


def explain_mock(facility_id: str = "office-tower-01") -> dict:
    return {
        "facility_id": facility_id,
        "method": "TreeSHAP",
        "backend": "mock",
        "base_value": 640.0,
        "predicted_power_kw": 842.0,
        "explained_ts": _NOW.isoformat(),
        "global_importance": [
            {"feature": "temp_out", "group": "Weather", "value": 33.1, "shap_value": 46.0, "abs_value": 46.0, "pct": 41.0, "direction": "increase"},
            {"feature": "ci", "group": "Grid carbon", "value": 612.0, "shap_value": 30.0, "abs_value": 30.0, "pct": 27.0, "direction": "increase"},
            {"feature": "hour_sin", "group": "Time-of-day", "value": 0.4, "shap_value": 20.0, "abs_value": 20.0, "pct": 18.0, "direction": "increase"},
        ],
        "local": [],
        "narrative": "Demand 14:15 (forecast 842 kW) is driven 41% by outdoor temperature, 27% by grid carbon intensity and 18% by time of day.",
        "group_rollup": {"Weather": 41.0, "Grid carbon": 27.0, "Time-of-day": 18.0},
        "notes": ["MOCK response — ML service placeholder."],
    }


def twin_simulate_mock(facility_id: str = "office-tower-01") -> dict:
    points = []
    for i, p in enumerate(_series()):
        temp_in = 24.0 - 0.8 * (i / 96)
        points.append(
            {
                "ts": p["ts"],
                "temp_in": round(temp_in, 2),
                "temp_out": p["temp_out"],
                "power_kw": round(120 * 0.7, 2),
                "cop": 3.8,
                "cooling_kw": round(120 * 0.7 * 3.8, 2),
                "emissions_kg": round(120 * 0.7 * 0.25 * p["ci"] / 1000, 4),
                "ci": p["ci"],
                "throttle": 0.7,
                "comfort_ok": True,
            }
        )
    return {
        "facility_id": facility_id,
        "step_minutes": 15,
        "comfort": {"min_c": 22.0, "max_c": 26.0},
        "points": points,
        "params": {
            "r_envelope": 0.05, "c_thermal": 120.0, "cop_a": 4.4, "cop_b": 0.06,
            "window_factor": 0.35, "internal_gain_kw": 30.0, "hvac_rated_kw": 100.0,
            "solar_aperture_m2": 400.0, "occupancy_gain_kw": 40.0, "floors": 1,
        },
        "energy_kwh": round(120 * 0.7 * 24, 2),
        "emissions_kg": 3210.0,
        "min_temp_in": 23.2,
        "max_temp_in": 24.0,
        "comfort_violation_hours": 0.0,
        "interpretation": "MOCK: indoor temperature holds inside the comfort band.",
    }


def scenario_mock(facility_id: str = "office-tower-01") -> dict:
    return {
        "facility_id": facility_id,
        "levers": [
            {"type": "hvac_peak_shaving", "kwh_saved_year": 120300.0, "tco2e_avoided_year": 54.2, "cost_saved_year": 14436.0, "capex": 0.0, "payback_years": None, "abatement_cost_per_tco2e": -266.0, "notes": []},
            {"type": "rooftop_solar", "kwh_saved_year": 292000.0, "tco2e_avoided_year": 132.2, "cost_saved_year": 35040.0, "capex": 225000.0, "payback_years": 4.4, "abatement_cost_per_tco2e": 32.5, "notes": []},
        ],
        "kpis": {
            "kwh_saved_year": 412300.0, "tco2e_avoided_year": 186.4, "cost_saved_year": 51200.0,
            "capex": 240000.0, "payback_years": 4.7, "npv": 190000.0, "abatement_cost_per_tco2e": -38.2,
            "comfort_violation_hours": 0.0, "emissions_reduction_pct": 16.8,
            "kwhSavedYear": 412300.0, "tco2eAvoidedYear": 186.4, "costSavedYear": 51200.0,
            "paybackYears": 4.7, "abatementCostPerTco2e": -38.2,
        },
        "series": {
            "baseline_power_kw": [], "scenario_power_kw": [],
            "baseline_emissions_kg": [], "scenario_emissions_kg": [],
            "temp_in": [], "ci": [],
        },
        "narrative": "This scenario combines 2 levers, 186.4 tCO₂e avoided/yr, $51,200 saved/yr, payback 4.7 yr.",
        "notes": ["MOCK response — ML service placeholder."],
    }


def optimize_mock(facility_id: str = "office-tower-01") -> dict:
    schedule = []
    for i, p in enumerate(_series()):
        schedule.append(
            {
                "ts": p["ts"],
                "throttle": 0.9 if 3 <= i <= 5 else 0.6,
                "power_kw": round(120 * (0.9 if 3 <= i <= 5 else 0.6), 2),
                "temp_in": round(23.4 + 0.4 * (i % 4), 2),
                "temp_out": p["temp_out"],
                "ci": p["ci"],
                "emissions_kg": round(120 * 0.6 * 0.25 * p["ci"] / 1000, 4),
                "comfort_ok": True,
            }
        )
    return {
        "facility_id": facility_id,
        "solver": "SLSQP",
        "status": "optimal",
        "schedule": schedule,
        "baseline_emissions_kg": 3210.0,
        "optimized_emissions_kg": 2600.0,
        "emissions_saved_kg": 610.0,
        "emissions_reduction_pct": 19.0,
        "baseline_energy_kwh": 2016.0,
        "optimized_energy_kwh": 1900.0,
        "comfort_violation_hours": 0.0,
        "pre_cool_hour": 4,
        "cleanest_hour": 4,
        "narrative": "Pre-cool at 04:00 when the grid is 38% cleaner → 19% lower emissions, 0.0 h comfort-band violation.",
        "notes": ["MOCK response — ML service placeholder."],
    }


def anomaly_mock(facility_id: str = "office-tower-01") -> dict:
    return {
        "facility_id": facility_id,
        "method": "residual_zscore + isolation_forest",
        "n_flagged": 1,
        "total_est_waste_kg_co2e": 18.0,
        "flags": [
            {
                "ts": (_NOW.replace(hour=2, minute=15)).isoformat(),
                "severity": "critical",
                "method": "residual_zscore + isolation_forest",
                "score": 4.8,
                "observed_kw": 300.0,
                "expected_kw": 120.0,
                "excess_kwh": 45.0,
                "est_waste_kg_co2e": 18.0,
                "reason": "Heavy load at 02:00 while typically unoccupied — possible AHU running out of hours",
            }
        ],
        "notes": ["MOCK response — ML service placeholder."],
    }


def macc_mock(facility_id: str = "office-tower-01") -> dict:
    return {
        "facility_id": facility_id,
        "currency": "USD",
        "total_tco2e_avoided": 320.0,
        "total_capex": 465000.0,
        "entries": [
            {"type": "setpoint_relaxation", "label": "Setpoint relaxation", "tco2e_avoided_year": 38.0, "abatement_cost_per_tco2e": -120.0, "capex": 0.0, "cost_saved_year": 9000.0, "payback_years": None, "profitable": True},
            {"type": "rooftop_solar", "label": "Rooftop solar", "tco2e_avoided_year": 132.2, "abatement_cost_per_tco2e": 32.5, "capex": 225000.0, "cost_saved_year": 35040.0, "payback_years": 4.4, "profitable": False},
            {"type": "battery", "label": "Battery storage", "tco2e_avoided_year": 60.0, "abatement_cost_per_tco2e": 210.0, "capex": 90000.0, "cost_saved_year": 12000.0, "payback_years": 7.5, "profitable": False},
        ],
    }


def model_card_mock(facility_id: str = "office-tower-01") -> dict:
    return {
        "facility_id": facility_id,
        "exists": True,
        "model_version": "mock-v1",
        "backend": "mock",
        "model_type": "office",
        "trained_at": _NOW.isoformat(),
        "n_samples": 8760,
        "horizon": 96,
        "metrics": {"mae": 21.4, "rmse": 30.1, "mape": 8.7, "r2": 0.91, "coverage_p10_p90": 0.79},
        "features": ["hour_sin", "temp_out", "ci", "lag_1", "lag_96"],
        "feature_groups": {"Weather": ["temp_out"], "Time-of-day": ["hour_sin"]},
        "training_window": {"start": "2024-06-01T00:00:00", "end": "2025-06-01T00:00:00"},
        "target": "power_kw (15-min mean)",
        "notes": ["MOCK response — ML service placeholder."],
        "model_card": {},
    }
