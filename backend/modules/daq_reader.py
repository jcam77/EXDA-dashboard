"""Full-resolution single-channel reader for DAQ files (EXDA-Check B1, B5).

Reads one channel of a TPC5 (h5py) or MF4 (asammdf) file directly with numpy,
with its native time base and the unit stored in the file. Nothing is
decimated. Channel indices follow the same order as the text content produced
by tpc5_parser / mf4_parser, so the channel picked in the UI is the channel
analysed.

Files are opened read-only.
"""

from __future__ import annotations

import os

import numpy as np

from modules import data_parser

try:
    import h5py
except Exception:  # pragma: no cover
    h5py = None

try:
    from asammdf import MDF
except Exception:  # pragma: no cover
    MDF = None


class DaqReadError(ValueError):
    pass


def _decode(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")
    return str(value)


def _attr_float(attrs, key, default):
    value = attrs.get(key, default)
    if isinstance(value, np.ndarray):
        if value.size == 0:
            return default
        value = value.reshape(-1)[0]
    try:
        return float(value)
    except Exception:
        return default


def _tpc5_channel_entries(handle):
    """Same traversal and skip rules as tpc5_parser._collect_channels."""
    entries = []
    measurements = handle.get("measurements")
    if measurements is None:
        return entries
    for measurement_key in measurements.keys():
        group = measurements.get(f"{measurement_key}/channels")
        if group is None:
            continue
        for channel_key in group.keys():
            channel = group[channel_key]
            blocks = channel.get("blocks")
            if blocks is None:
                continue
            block_keys = list(blocks.keys())
            if not block_keys:
                continue
            block = blocks[block_keys[0]]
            raw = block.get("raw")
            if raw is None or raw.size == 0:
                continue
            name = _decode(channel.attrs.get("name", f"channel_{channel_key}")).strip() or f"channel_{channel_key}"
            unit = _decode(channel.attrs.get("physicalUnit", "")).strip()
            entries.append({
                "channel": channel,
                "block": block,
                "blockCount": len(block_keys),
                "name": name,
                "unit": unit,
                "label": f"{name} [{unit}]" if unit else name,
            })
    return entries


def _read_tpc5(path, channel_index):
    if h5py is None:
        raise DaqReadError("TPC5 support requires 'h5py' (see backend/requirements.txt).")
    with h5py.File(path, "r") as handle:
        entries = _tpc5_channel_entries(handle)
        if not entries:
            raise DaqReadError("TPC5 file has no readable channels.")
        if channel_index >= len(entries):
            raise DaqReadError(f"Channel {channel_index + 1} does not exist (file has {len(entries)} channels).")
        entry = entries[channel_index]
        channel, block = entry["channel"], entry["block"]
        raw = np.asarray(block["raw"][()]).reshape(-1).astype(float)
        fs = _attr_float(block.attrs, "sampleRateHertz", float("nan"))
        if not np.isfinite(fs) or fs <= 0:
            raise DaqReadError("TPC5 block has no valid sampleRateHertz.")
        trigger_sample = int(_attr_float(block.attrs, "triggerSample", 0.0))
        trigger_time = _attr_float(block.attrs, "triggerTimeSeconds", 0.0)
        volts = raw * _attr_float(channel.attrs, "binToVoltFactor", 1.0) + _attr_float(channel.attrs, "binToVoltConstant", 0.0)
        values = volts * _attr_float(channel.attrs, "voltToPhysicalFactor", 1.0) + _attr_float(channel.attrs, "voltToPhysicalConstant", 0.0)
        t = (np.arange(raw.size, dtype=float) - trigger_sample) / fs + trigger_time
        start_time = _decode(block.attrs.get("startTime", "")) if "startTime" in block.attrs else ""
        info = {
            "fileType": "tpc5",
            "channelIndex": channel_index,
            "channelName": entry["label"],
            "fileUnit": entry["unit"],
            "fsHz": fs,
            "samples": int(raw.size),
            "triggerSample": trigger_sample,
            "startTime": start_time,
            "blocksInChannel": entry["blockCount"],
        }
        if entry["blockCount"] > 1:
            info["note"] = f"Channel has {entry['blockCount']} blocks; only the first is read (same as the preview)."
        return t, values, info


def _mf4_channel_entries(mdf):
    """Non-master numeric 1-D channels in the order of MDF.to_dataframe columns."""
    entries = []
    for group_index, group in enumerate(mdf.groups):
        for channel_index, channel in enumerate(group.channels):
            if getattr(channel, "channel_type", 0) in (2, 3):  # master / virtual master
                continue
            entries.append({
                "group": group_index,
                "index": channel_index,
                "name": str(channel.name).strip(),
                "unit": str(getattr(channel, "unit", "") or "").strip(),
            })
    return entries


def _read_mf4(path, channel_index):
    if MDF is None:
        raise DaqReadError("MF4 support requires 'asammdf' (see backend/requirements.txt).")
    mdf = MDF(path)
    try:
        entries = []
        first_stamps = []
        for entry in _mf4_channel_entries(mdf):
            sig = mdf.get(group=entry["group"], index=entry["index"])
            samples = np.asarray(sig.samples)
            if samples.ndim != 1 or samples.dtype.kind not in "iuf" or samples.size == 0:
                continue
            stamps = np.asarray(sig.timestamps, dtype=float)
            if stamps.size:
                first_stamps.append(float(stamps[0]))
            entries.append((entry, sig))
        if not entries:
            raise DaqReadError("MF4 file has no numeric channels.")
        if channel_index >= len(entries):
            raise DaqReadError(f"Channel {channel_index + 1} does not exist (file has {len(entries)} channels).")
        entry, sig = entries[channel_index]
        t = np.asarray(sig.timestamps, dtype=float)
        # Same time origin as the preview content (to_dataframe(time_from_zero=True)).
        t0 = min(first_stamps) if first_stamps else 0.0
        t = t - t0
        values = np.asarray(sig.samples, dtype=float)
        unit = str(getattr(sig, "unit", "") or entry["unit"] or "").strip()
        dt = np.diff(t)
        positive = dt[dt > 0]
        fs = float(1.0 / np.median(positive)) if positive.size else None
        start_time = ""
        try:
            start_time = mdf.header.start_time.isoformat()
        except Exception:
            pass
        return t, values, {
            "fileType": "mf4",
            "channelIndex": channel_index,
            "channelName": entry["name"],
            "fileUnit": unit,
            "fsHz": fs,
            "samples": int(values.size),
            "group": entry["group"],
            "startTime": start_time,
        }
    finally:
        try:
            mdf.close()
        except Exception:
            pass


def _read_text(path, channel_index):
    with open(path, "r", encoding="utf-8", errors="strict") as handle:
        content = handle.read()
    t, y, err = data_parser.parse_time_signal_content(content, channel_index=channel_index)
    if err:
        raise DaqReadError(err)
    from modules.pressure_analysis import channel_label_from_content, unit_from_channel_label

    label = channel_label_from_content(content, channel_index)
    dt = np.diff(np.asarray(t, dtype=float))
    positive = dt[dt > 0]
    return np.asarray(t, dtype=float), np.asarray(y, dtype=float), {
        "fileType": "text",
        "channelIndex": channel_index,
        "channelName": label,
        "fileUnit": unit_from_channel_label(label),
        "fsHz": float(1.0 / np.median(positive)) if positive.size else None,
        "samples": int(len(t)),
    }


def read_channel(path, channel_index=0):
    """Return (t, values, info) for one channel at full resolution."""
    try:
        channel_index = int(channel_index)
    except (TypeError, ValueError):
        raise DaqReadError(f"Invalid channel index: {channel_index!r}") from None
    if channel_index < 0:
        raise DaqReadError("Channel index must be >= 0.")
    ext = os.path.splitext(path)[1].lower()
    if ext == ".tpc5":
        t, y, info = _read_tpc5(path, channel_index)
    elif ext == ".mf4":
        t, y, info = _read_mf4(path, channel_index)
    else:
        t, y, info = _read_text(path, channel_index)
    info["file"] = os.path.basename(path)
    info["fullResolution"] = True
    return t, y, info
