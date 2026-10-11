"""Scenario engine + MACC tests."""
from __future__ import annotations

from app.scenarios import engine


def test_evaluate_scenario_stacks_levers():
    levers = [
        {"type": "hvac_peak_shaving", "params": {"capPct": 85}},
        {"type": "rooftop_solar", "params": {"kWp": 250}},
        {"type": "load_shifting", "params": {"flexiblePct": 20}},
    ]
    result = engine.evaluate_scenario(levers, context=None)
    kpis = result["kpis"]
    assert len(result["levers"]) == 3
    assert kpis["tco2e_avoided_year"] > 0
    assert kpis["kwh_saved_year"] > 0
    # camelCase aliases exposed for the gateway/frontend
    assert "tco2eAvoidedYear" in kpis
    assert "abatementCostPerTco2e" in kpis
    assert len(result["series"]["baseline_power_kw"]) == 96
    assert len(result["series"]["scenario_power_kw"]) == 96
    assert result["narrative"]


def test_all_levers_are_implemented():
    for lever in (
        {"type": "hvac_peak_shaving", "params": {}},
        {"type": "load_shifting", "params": {}},
        {"type": "rooftop_solar", "params": {}},
        {"type": "setpoint_relaxation", "params": {}},
        {"type": "retrofit", "params": {}},
        {"type": "battery", "params": {}},
    ):
        res = engine.evaluate_scenario([lever], context=None)
        assert res["kpis"]["emissions_reduction_pct"] >= 0


def test_macc_sorted_ascending_by_abatement_cost():
    macc = engine.build_macc(context=None)
    assert len(macc["entries"]) >= 5
    costs = [e["abatement_cost_per_tco2e"] for e in macc["entries"]]
    assert costs == sorted(costs)
    # At least one self-financing lever should appear for a typical building.
    assert any(e["profitable"] for e in macc["entries"])
