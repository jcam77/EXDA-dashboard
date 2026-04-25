"""Typed payload models for plot aggregation inputs."""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class PlotSeries:
    """One named series containing plot-ready points."""
    name: str
    plot_data: List[Dict[str, float]]

    @staticmethod
    def from_dict(payload: Dict[str, Any]) -> "PlotSeries":
        """Create PlotSeries from API payload aliases."""
        return PlotSeries(
            name=payload.get("displayName") or payload.get("display_name") or payload.get("name") or "",
            plot_data=payload.get("plotData") or payload.get("plot_data") or [],
        )


@dataclass
class AggregatePlotRequest:
    """Normalized request model for aggregated plot generation."""
    active_tab: str
    series: List[PlotSeries]
    experimental: Optional[List[Dict[str, float]]]

    @staticmethod
    def from_dict(payload: Dict[str, Any]) -> "AggregatePlotRequest":
        """Create AggregatePlotRequest from API payload aliases."""
        active_tab = payload.get("activeTab", "filter")
        series_payload = payload.get("series", [])
        series = [PlotSeries.from_dict(item) for item in series_payload]
        experimental = payload.get("experimental")
        return AggregatePlotRequest(active_tab=active_tab, series=series, experimental=experimental)
