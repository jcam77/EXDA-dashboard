"""Utilities for interpolating and aggregating multi-series plot payloads."""

from typing import Dict, List, Optional

from .models import AggregatePlotRequest


def _get_keys(active_tab: str) -> Dict[str, str]:
    """Return axis keys and sampling resolution per analysis tab."""
    is_flame = active_tab == "flame_speed"
    return {
        "is_flame": is_flame,
        "key_x": "x" if is_flame else "t",
        "key_y": "v" if is_flame else "p",
        "steps": 500 if is_flame else 2000,
    }


def _max_axis(data: Optional[List[Dict[str, float]]], key_x: str) -> float:
    """Return the maximum x-axis value in a series."""
    if not data:
        return 0.0
    return max((pt.get(key_x, 0.0) for pt in data), default=0.0)


def _interpolate(target: float, src_data: List[Dict[str, float]], key_x: str, key_y: str) -> Optional[float]:
    """Linearly interpolate y-value at target x for one series."""
    if not src_data or len(src_data) < 2:
        return None
    for i in range(len(src_data) - 1):
        x0 = src_data[i].get(key_x)
        x1 = src_data[i + 1].get(key_x)
        if x0 is None or x1 is None:
            continue
        if target >= x0 and target <= x1:
            y0 = src_data[i].get(key_y)
            y1 = src_data[i + 1].get(key_y)
            if y0 is None or y1 is None or x1 == x0:
                return None
            return y0 + (y1 - y0) * (target - x0) / (x1 - x0)
    return None


def _time_key(value: float) -> str:
    """Stable key for floating-point timeline merging."""
    return f"{float(value):.9f}"


def _aggregate_native_time(
    request: AggregatePlotRequest,
    *,
    key_x: str,
    key_y: str,
    is_flame: bool,
    max_points: int = 12000,
) -> List[Dict[str, float]]:
    """Merge series on the union of native x-values without interpolation."""
    if is_flame:
        return []

    timeline = {}
    series_maps: Dict[str, Dict[str, float]] = {}

    for item in request.series:
        if not item.name:
            continue
        value_map: Dict[str, float] = {}
        for point in item.plot_data or []:
            x_val = point.get(key_x)
            y_val = point.get(key_y)
            if x_val is None or y_val is None:
                continue
            try:
                x_num = float(x_val)
                y_num = float(y_val)
            except (TypeError, ValueError):
                continue
            if not (x_num == x_num and y_num == y_num):  # NaN check
                continue
            key = _time_key(x_num)
            timeline.setdefault(key, x_num)
            value_map[key] = y_num
        series_maps[item.name] = value_map

    experimental_map: Dict[str, float] = {}
    if request.experimental:
        for point in request.experimental:
            x_val = point.get(key_x)
            y_val = point.get(key_y)
            if x_val is None or y_val is None:
                continue
            try:
                x_num = float(x_val)
                y_num = float(y_val)
            except (TypeError, ValueError):
                continue
            if not (x_num == x_num and y_num == y_num):
                continue
            key = _time_key(x_num)
            timeline.setdefault(key, x_num)
            experimental_map[key] = y_num

    if not timeline:
        return []

    ordered_keys = sorted(timeline.keys(), key=lambda key: timeline[key])
    if max_points > 0 and len(ordered_keys) > max_points:
        picks = [int(round(i * (len(ordered_keys) - 1) / (max_points - 1))) for i in range(max_points)]
        ordered_keys = [ordered_keys[idx] for idx in picks]

    rows: List[Dict[str, float]] = []
    for key in ordered_keys:
        row = {"time": timeline[key]}
        for series_name, value_map in series_maps.items():
            row[series_name] = value_map.get(key)
        if request.experimental:
            row["Experimental"] = experimental_map.get(key)
        rows.append(row)
    return rows


def aggregate_plot_data(payload: dict) -> List[Dict[str, float]]:
    """Build a common-grid plot dataset from heterogeneous input series."""
    request = AggregatePlotRequest.from_dict(payload or {})
    keys = _get_keys(request.active_tab)
    key_x = keys["key_x"]
    key_y = keys["key_y"]
    steps = keys["steps"]
    if request.preserve_native_time:
        return _aggregate_native_time(request, key_x=key_x, key_y=key_y, is_flame=keys["is_flame"])

    max_val = 0.0
    for item in request.series:
        max_val = max(max_val, _max_axis(item.plot_data, key_x))
    if request.experimental:
        max_val = max(max_val, _max_axis(request.experimental, key_x))

    if max_val <= 0:
        return []

    plot_data: List[Dict[str, float]] = []
    for i in range(steps + 1):
        val = (i / steps) * max_val
        point = {"x": val} if keys["is_flame"] else {"time": val}
        for item in request.series:
            if item.name:
                point[item.name] = _interpolate(val, item.plot_data, key_x, key_y)
        if request.experimental:
            point["Experimental"] = _interpolate(val, request.experimental, key_x, key_y)
        plot_data.append(point)

    return plot_data
