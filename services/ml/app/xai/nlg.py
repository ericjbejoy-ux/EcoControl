"""Natural-language generation for SHAP contributions (FR-18).

Turns the top-N contributions into a single human sentence, e.g.::

    "Spike at 14:15 driven 41% by outdoor temperature, 27% by grid carbon
     intensity and 18% by time of day."

Feature → human label mapping keeps the sentence readable without leaking
model-internal column names to judges.
"""
from __future__ import annotations

from typing import Optional, Sequence

FEATURE_LABELS = {
    "temp_out": "outdoor temperature",
    "humidity": "humidity",
    "irradiance": "solar irradiance",
    "ci": "grid carbon intensity",
    "occupancy": "occupancy",
    "hour_sin": "time of day",
    "hour_cos": "time of day",
    "minute_of_day": "time of day",
    "dayofweek": "day of week",
    "is_weekend": "weekend pattern",
    "is_holiday": "holiday pattern",
}

GROUP_LABELS = {
    "Weather": "weather",
    "Time-of-day": "time of day",
    "Grid carbon": "grid carbon intensity",
    "Occupancy": "occupancy",
    "Historical pattern": "historical consumption pattern",
    "Other": "other factors",
}


def _label(feature: str, group: str) -> str:
    if feature in FEATURE_LABELS:
        return FEATURE_LABELS[feature]
    if feature.startswith(("lag_", "roll_")):
        return "historical consumption pattern"
    return GROUP_LABELS.get(group, feature.replace("_", " "))


def _join(parts: Sequence[str]) -> str:
    parts = [p for p in parts if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]} and {parts[1]}"
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def _fmt_ts(ts: Optional[object]) -> str:
    if ts is None:
        return "this interval"
    text = str(ts)
    if "T" in text:
        date, _, rest = text.partition("T")
        return rest[:5] or text
    if " " in text:
        return text.split(" ")[1][:5]
    return text


def explain_contributions(
    contributions: Sequence[dict],
    *,
    ts: Optional[object] = None,
    predicted_power_kw: Optional[float] = None,
    top_k: int = 3,
) -> str:
    """Build the plain-English explanation sentence."""
    if not contributions:
        return "No explanation is available for this interval."

    top = list(contributions)[:top_k]
    parts = []
    for c in top:
        label = _label(c.get("feature", ""), c.get("group", ""))
        pct = abs(float(c.get("pct", 0.0)))
        if pct <= 0:
            continue
        parts.append(f"{pct:.0f}% by {label}")

    when = _fmt_ts(ts)
    if not parts:
        return f"Load {when} is at its typical level; no dominant driver."

    phrase = _join(parts)
    power = ""
    if predicted_power_kw is not None and predicted_power_kw == predicted_power_kw:
        power = f" (forecast {predicted_power_kw:.0f} kW)"
    return f"Demand {when}{power} is driven {phrase}."


def explain_group_rollup(rollup: dict[str, float], *, ts: Optional[object] = None) -> str:
    if not rollup:
        return "No grouped explanation available."
    ordered = sorted(rollup.items(), key=lambda kv: kv[1], reverse=True)[:3]
    parts = [f"{GROUP_LABELS.get(g, g)} ({v:.0f}%)" for g, v in ordered]
    return f"Key drivers {_fmt_ts(ts)}: " + ", ".join(parts) + "."


def optimize_narrative(
    emissions_reduction_pct: float,
    pre_cool_hour: Optional[int],
    cleanest_hour: Optional[int],
    comfort_violation_hours: float,
) -> str:
    if pre_cool_hour is not None and cleanest_hour is not None:
        return (
            f"Pre-cool at {pre_cool_hour:02d}:00 when the grid is cleanest "
            f"(cleanest hour {cleanest_hour:02d}:00) → {emissions_reduction_pct:.0f}% lower "
            f"emissions, {comfort_violation_hours:.1f} h comfort-band violation."
        )
    return (
        f"Carbon-aware schedule cuts emissions by {emissions_reduction_pct:.0f}% with "
        f"{comfort_violation_hours:.1f} h comfort-band violation."
    )


def scenario_narrative(kpis: dict, n_levers: int) -> str:
    tco2e = kpis.get("tco2e_avoided_year", kpis.get("tco2eAvoidedYear", 0.0))
    cost = kpis.get("cost_saved_year", kpis.get("costSavedYear", 0.0))
    payback = kpis.get("payback_years", kpis.get("paybackYears"))
    abatement = kpis.get(
        "abatement_cost_per_tco2e", kpis.get("abatementCostPerTco2e")
    )
    bits = [
        f"{n_levers} lever{'s' if n_levers != 1 else ''}",
        f"{tco2e:,.1f} tCO₂e avoided/yr",
        f"${cost:,.0f} saved/yr",
    ]
    if payback is not None:
        bits.append(f"payback {payback:.1f} yr")
    if abatement is not None and abatement < 0:
        bits.append(f"negative abatement cost (${abatement:,.0f}/tCO₂e) — pays for itself")
    elif abatement is not None:
        bits.append(f"abatement ${abatement:,.0f}/tCO₂e")
    return "This scenario combines " + ", ".join(bits) + "."
