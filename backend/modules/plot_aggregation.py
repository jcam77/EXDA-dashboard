from typing import Dict, List, Optional

from .models import AggregatePlotRequest


def _get_keys(active_tab: str) -> Dict[str, str]:
    is_flame = active_tab == "flame_speed"
    return {
        "is_flame": is_flame,
        "key_x": "x" if is_flame else "t",
        "key_y": "v" if is_flame else "p",
        "steps": 500 if is_flame else 2000,
    }


def _max_axis(data: Optional[List[Dict[str, float]]], key_x: str) -> float:
    if not data:
        return 0.0
    return max((pt.get(key_x, 0.0) for pt in data), default=0.0)


def _interpolate(target: float, src_data: List[Dict[str, float]], key_x: str, key_y: str) -> Optional[float]:
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


def aggregate_plot_data(payload: dict) -> List[Dict[str, float]]:
    request = AggregatePlotRequest.from_dict(payload or {})
    keys = _get_keys(request.active_tab)
    key_x = keys["key_x"]
    key_y = keys["key_y"]
    steps = keys["steps"]

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
