"""Peak-preserving reduction of multichannel signals for plotting.

For display only: metrics (pMax, impulse, ...) are always computed from every
sample elsewhere. Uniform index picking can skip a short peak or a clipped
plateau; this keeps, in every time interval, each channel's lowest and
highest sample, so peaks and clipping always stay visible.
"""

from __future__ import annotations

import math

import numpy as np

ENVELOPE_METHOD = "min/max per interval"


def envelope_row_indices(values, max_rows):
    """Sorted row indices that keep each channel's min and max in every interval.

    values: array of shape (n,) or (n, channels). max_rows <= 0 means no reduction.
    The result has at most about 2 * max_rows rows; the first and last sample
    are always kept.
    """
    y = np.asarray(values, dtype=float)
    if y.ndim == 1:
        y = y.reshape(-1, 1)
    n, channels = y.shape
    if max_rows <= 0 or n <= max_rows:
        return np.arange(n, dtype=np.int64)

    # Each interval contributes up to 2 rows per channel; fewer intervals for
    # many channels keep the total near max_rows (at most about twice it).
    intervals = max(1, min(n, max_rows // (2 * max(1, math.ceil(channels / 2)))))
    edges = np.linspace(0, n, intervals + 1).astype(np.int64)
    kept = [np.array([0, n - 1], dtype=np.int64)]
    for start, end in zip(edges[:-1], edges[1:]):
        if end <= start:
            continue
        segment = y[start:end]
        finite = np.isfinite(segment)
        low = np.where(finite, segment, np.inf).argmin(axis=0)
        high = np.where(finite, segment, -np.inf).argmax(axis=0)
        kept.append(start + low)
        kept.append(start + high)
    return np.unique(np.concatenate(kept))


def reduction_info(total_samples, returned_rows, sampling_rate_hz, reduced):
    """What the reader did, for the screen: real sample count and real sampling rate."""
    rate = float(sampling_rate_hz) if sampling_rate_hz is not None and np.isfinite(sampling_rate_hz) and sampling_rate_hz > 0 else None
    return {
        "totalSamples": int(total_samples),
        "returnedRows": int(returned_rows),
        "samplingRateHz": rate,
        "reduction": ENVELOPE_METHOD if reduced else "none",
    }


def median_sampling_rate(t):
    """Sampling rate from the median time step of the full (unreduced) time vector."""
    t = np.asarray(t, dtype=float)
    if t.size < 2:
        return None
    dt = np.diff(t)
    dt = dt[np.isfinite(dt) & (dt > 0)]
    if dt.size == 0:
        return None
    return float(1.0 / np.median(dt))
