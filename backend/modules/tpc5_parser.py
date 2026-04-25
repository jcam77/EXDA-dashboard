"""TPC5 helpers that convert binary data into numeric text tables."""

from __future__ import annotations

import numpy as np

try:
    import h5py
except Exception:  # pragma: no cover - optional dependency
    h5py = None


def _decode_text(value):
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8", errors="ignore")
        except Exception:
            return str(value)
    return str(value)


def _as_scalar(attrs, key, default):
    value = attrs.get(key, default)
    if isinstance(value, np.ndarray):
        if value.size == 0:
            return default
        value = value.reshape(-1)[0]
    try:
        return float(value)
    except Exception:
        return default


def _collect_channels(handle):
    channels = []
    measurements = handle.get("measurements")
    if measurements is None:
        return channels

    for measurement_key in measurements.keys():
        channels_group = measurements.get(f"{measurement_key}/channels")
        if channels_group is None:
            continue
        for channel_key in channels_group.keys():
            channel = channels_group[channel_key]
            blocks = channel.get("blocks")
            if blocks is None:
                continue
            block_keys = list(blocks.keys())
            if not block_keys:
                continue
            block = blocks[block_keys[0]]
            raw_dataset = block.get("raw")
            if raw_dataset is None:
                continue
            raw = raw_dataset[()]
            if raw is None:
                continue
            raw = np.asarray(raw).reshape(-1)
            if raw.size == 0:
                continue

            sample_rate = _as_scalar(block.attrs, "sampleRateHertz", 1.0)
            if not np.isfinite(sample_rate) or sample_rate <= 0:
                sample_rate = 1.0
            trigger_sample = int(_as_scalar(block.attrs, "triggerSample", 0.0))
            trigger_time = _as_scalar(block.attrs, "triggerTimeSeconds", 0.0)

            bin_to_volt_factor = _as_scalar(channel.attrs, "binToVoltFactor", 1.0)
            bin_to_volt_constant = _as_scalar(channel.attrs, "binToVoltConstant", 0.0)
            volt_to_phys_factor = _as_scalar(channel.attrs, "voltToPhysicalFactor", 1.0)
            volt_to_phys_constant = _as_scalar(channel.attrs, "voltToPhysicalConstant", 0.0)

            values = raw.astype(float)
            volts = values * bin_to_volt_factor + bin_to_volt_constant
            physical = volts * volt_to_phys_factor + volt_to_phys_constant

            name = _decode_text(channel.attrs.get("name", f"channel_{channel_key}")).strip()
            if not name:
                name = f"channel_{channel_key}"
            unit = _decode_text(channel.attrs.get("physicalUnit", "")).strip()

            channels.append(
                {
                    "name": f"{name} [{unit}]" if unit else name,
                    "sample_rate": sample_rate,
                    "trigger_sample": trigger_sample,
                    "trigger_time": trigger_time,
                    "values": physical,
                }
            )
    return channels


def tpc5_to_content(
    file_path: str,
    max_channels: int = 64,
    max_samples: int = 200000,
    time_start: float | None = None,
    time_end: float | None = None,
):
    """Return TPC5 as CSV-like text content compatible with existing parsers."""
    if h5py is None:
        return None, (
            "TPC5 support requires optional dependency 'h5py'. "
            "Install with: pip install h5py"
        )

    try:
        with h5py.File(file_path, "r") as handle:
            channels = _collect_channels(handle)
    except Exception as exc:
        return None, f"Failed to read TPC5 file: {exc}"

    if not channels:
        return None, "TPC5 file has no readable numeric channels."

    if max_channels > 0 and len(channels) > max_channels:
        channels = channels[:max_channels]

    lengths = [len(ch["values"]) for ch in channels if len(ch["values"]) > 0]
    if not lengths:
        return None, "TPC5 file has no non-empty channels."
    min_len = min(lengths)
    channels = [{**ch, "values": ch["values"][:min_len]} for ch in channels]

    ref = channels[0]
    sample_idx = np.arange(min_len, dtype=np.int64)
    t_all = (
        sample_idx.astype(float) - float(ref["trigger_sample"])
    ) / float(ref["sample_rate"]) + float(ref["trigger_time"])

    start = float(time_start) if time_start is not None and np.isfinite(time_start) else None
    end = float(time_end) if time_end is not None and np.isfinite(time_end) else None
    if start is not None and end is not None and start > end:
        start, end = end, start

    if start is not None or end is not None:
        window_mask = np.ones_like(t_all, dtype=bool)
        if start is not None:
            window_mask &= t_all >= start
        if end is not None:
            window_mask &= t_all <= end
        sample_idx = sample_idx[window_mask]
        if sample_idx.size == 0:
            return None, "TPC5 time window has no samples."

    if max_samples > 0 and sample_idx.size > max_samples:
        pick = np.linspace(0, sample_idx.size - 1, max_samples, dtype=np.int64)
        sample_idx = sample_idx[pick]

    t = (
        sample_idx.astype(float) - float(ref["trigger_sample"])
    ) / float(ref["sample_rate"]) + float(ref["trigger_time"])
    channels = [{**ch, "values": ch["values"][sample_idx]} for ch in channels]

    finite_mask = np.isfinite(t)
    for ch in channels:
        finite_mask &= np.isfinite(ch["values"])
    if not np.any(finite_mask):
        return None, "TPC5 file has no finite numeric rows."

    t = t[finite_mask]
    matrix = np.column_stack([ch["values"][finite_mask] for ch in channels])

    header = ["time"] + [ch["name"] for ch in channels]
    lines = [",".join(header)]
    for row_idx in range(len(t)):
        row_values = ",".join(f"{float(v):.12g}" for v in matrix[row_idx])
        lines.append(f"{float(t[row_idx]):.12g},{row_values}")

    return "\n".join(lines), None
