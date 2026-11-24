"""Peak values per channel inside a time range, for the screening tab.

Computed from every sample at full resolution (never from the plot preview),
on the raw recorded values: no filter, no baseline correction, no unit change.
A time range is required: the maximum over a whole record would mostly
measure late-time noise or drift, not the event.
"""

from __future__ import annotations

import numpy as np


class PeakRangeError(ValueError):
    pass


def parse_range(start, end):
    """Validate the time range. Both ends are required (no default range)."""
    try:
        start = float(start)
        end = float(end)
    except (TypeError, ValueError):
        raise PeakRangeError("Set a time range (start and end, in s) to calculate the peaks.") from None
    if not (np.isfinite(start) and np.isfinite(end)):
        raise PeakRangeError("Set a time range (start and end, in s) to calculate the peaks.")
    if end <= start:
        raise PeakRangeError("The end of the time range must be after its start.")
    return start, end


def peak_in_range(t, values, start, end):
    """Max and time of max of `values` for start <= t <= end, using every finite sample."""
    t = np.asarray(t, dtype=float)
    values = np.asarray(values, dtype=float)
    n = min(t.size, values.size)
    t, values = t[:n], values[:n]
    inside = (t >= start) & (t <= end) & np.isfinite(values)
    count = int(np.count_nonzero(inside))
    if count == 0:
        return {"max": None, "tMax": None, "samples": 0}
    positions = np.flatnonzero(inside)
    best = positions[int(np.argmax(values[positions]))]
    return {"max": float(values[best]), "tMax": float(t[best]), "samples": count}
