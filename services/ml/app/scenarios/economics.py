"""Financial and impact math for scenarios (SRS §5.7).

All functions are pure and unit-tested (tests/test_economics.py). Conventions:
* energy in kWh, money in USD, emissions in kg or tCO₂e
* ``tco2e(kwh, ci_g_per_kwh) = kwh · ci / 1e6``
"""
from __future__ import annotations

from typing import Optional

TREES_KG_CO2_PER_YEAR = 21.0  # mature tree sequestration
CAR_KG_CO2_PER_KM = 0.192  # average passenger car
HOMES_TCO2E_PER_YEAR = 7.5  # average household electricity+gas


def emissions_tco2e(kwh: float, ci_g_per_kwh: float) -> float:
    return float(kwh) * float(ci_g_per_kwh) / 1e6


def emissions_kg(kwh: float, ci_g_per_kwh: float) -> float:
    return float(kwh) * float(ci_g_per_kwh) / 1000.0


def payback_years(capex: float, annual_saving: float) -> Optional[float]:
    if annual_saving <= 0:
        return None
    return float(capex) / float(annual_saving)


def annualized_capex(capex: float, years: int, discount_rate: float) -> float:
    """Capital recovery factor → equivalent annual cost of the investment."""
    if years <= 0:
        return float(capex)
    if discount_rate <= 0:
        return float(capex) / years
    r = discount_rate
    return float(capex) * r / (1.0 - (1.0 + r) ** (-years))


def npv(capex: float, annual_saving: float, years: int, discount_rate: float) -> float:
    value = -float(capex)
    for y in range(1, int(years) + 1):
        value += float(annual_saving) / (1.0 + discount_rate) ** y
    return float(value)


def abatement_cost_per_tco2e(
    annualized_investment: float, annual_saving: float, tco2e_avoided: float
) -> Optional[float]:
    """(Annualised CAPEX − annual saving) / tCO₂e avoided. Negative ⇒ pays for itself."""
    if tco2e_avoided <= 0:
        return None
    return float(annualized_investment - annual_saving) / float(tco2e_avoided)


def impact_equivalents(tco2e: float) -> dict:
    tco2e = float(tco2e)
    trees = tco2e * 1000.0 / TREES_KG_CO2_PER_YEAR
    car_km = tco2e * 1000.0 / CAR_KG_CO2_PER_KM
    homes = tco2e / HOMES_TCO2E_PER_YEAR
    return {
        "tco2e": round(tco2e, 3),
        "trees_equivalent": round(trees, 1),
        "car_km_equivalent": round(car_km, 1),
        "homes_powered_equivalent": round(homes, 2),
        "headline": (
            f"≈ {trees:,.0f} trees planted, {car_km:,.0f} car-km avoided, "
            f"{homes:,.1f} homes powered for a year"
        ),
    }
