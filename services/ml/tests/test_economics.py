"""Unit tests for scenario economics (SRS §5.7)."""
from __future__ import annotations

import pytest

from app.scenarios import economics


def test_emissions_conversion():
    assert economics.emissions_tco2e(1000, 400) == pytest.approx(0.4)
    assert economics.emissions_kg(1000, 400) == pytest.approx(400.0)


def test_payback_years():
    assert economics.payback_years(240000, 51200) == pytest.approx(4.6875, rel=1e-3)
    assert economics.payback_years(1000, 0) is None


def test_npv_sign():
    positive = economics.npv(10000, 3000, 5, 0.08)
    negative = economics.npv(100000, 1000, 5, 0.08)
    assert positive > 0
    assert negative < 0


def test_annualized_capex_capital_recovery():
    ann = economics.annualized_capex(100000, 10, 0.08)
    # should be greater than straight-line 10k and less than naive /? 
    assert 14000 < ann < 16000
    assert economics.annualized_capex(5000, 5, 0.0) == pytest.approx(1000.0)


def test_abatement_cost_negative_when_self_financing():
    abatement = economics.abatement_cost_per_tco2e(1000, 5000, 100)
    assert abatement == pytest.approx(-40.0)
    assert economics.abatement_cost_per_tco2e(0, 0, 0) is None


def test_impact_equivalents():
    eq = economics.impact_equivalents(1.0)
    assert eq["trees_equivalent"] > 0
    assert eq["car_km_equivalent"] > 0
    assert "trees" in eq["headline"]
