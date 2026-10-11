"""Marginal Abatement Cost Curve (MACC) dataset builder (FR-25).

The heavy lifting lives in :func:`app.scenarios.engine.build_macc`; this module
exposes it and adds presentation helpers (sorting, cumulative abatement) so the
frontend can render the classic MACC bars where width = tCO₂e avoided and
height = $/tCO₂e.
"""
from __future__ import annotations

from typing import Any, Optional, Sequence

from app.scenarios.engine import build_macc as _build_macc


def build_macc(context: Any = None, lever_requests: Optional[Sequence[Any]] = None) -> dict:
    return _build_macc(context, lever_requests)


def with_cumulative(macc: dict) -> dict:
    """Annotate entries with cumulative tCO₂e for a stepped MACC waterfall."""
    cumulative = 0.0
    for entry in macc.get("entries", []):
        cumulative += float(entry.get("tco2e_avoided_year", 0.0))
        entry["cumulative_tco2e_avoided"] = round(cumulative, 4)
    macc["cumulative_tco2e_avoided"] = round(cumulative, 4)
    return macc
