"""MF4 helpers that convert binary MDF4 data into numeric text tables."""

from __future__ import annotations

import numpy as np

try:
    from asammdf import MDF
except Exception:  # pragma: no cover - optional dependency
    MDF = None


def mf4_to_content(file_path: str, max_channels: int = 64):
    """Return MF4 as CSV-like text content compatible with existing parsers."""
    if MDF is None:
        return None, (
            "MF4 support requires optional dependency 'asammdf'. "
            "Install with: pip install asammdf"
        )

    try:
        mdf = MDF(file_path)
        df = mdf.to_dataframe(time_from_zero=True)
    except Exception as exc:
        return None, f"Failed to read MF4 file: {exc}"

    if df is None or df.empty:
        return None, "MF4 file has no samples."

    numeric_df = df.select_dtypes(include=["number"]).copy()
    if numeric_df.empty:
        return None, "MF4 file has no numeric channels."

    if max_channels > 0 and numeric_df.shape[1] > max_channels:
        numeric_df = numeric_df.iloc[:, :max_channels]

    try:
        t = numeric_df.index.to_numpy(dtype=float)
    except Exception:
        t = np.arange(len(numeric_df), dtype=float)

    y = numeric_df.to_numpy(dtype=float, copy=False)
    if y.ndim == 1:
        y = y.reshape(-1, 1)

    finite_mask = np.isfinite(t) & np.all(np.isfinite(y), axis=1)
    if not np.any(finite_mask):
        return None, "MF4 file has no finite numeric rows."

    t = t[finite_mask]
    y = y[finite_mask]

    order = np.argsort(t)
    t = t[order]
    y = y[order]

    header = ["time"] + [
        (str(col).strip() if str(col).strip() else f"Signal {idx + 1}")
        for idx, col in enumerate(numeric_df.columns)
    ]

    lines = [",".join(header)]
    for ti, row in zip(t, y):
        values = ",".join(f"{float(val):.12g}" for val in row)
        lines.append(f"{float(ti):.12g},{values}")

    return "\n".join(lines), None
