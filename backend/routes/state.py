"""State routes for loading project files, plan data, and raw-data inventory."""

from flask import Blueprint, jsonify, request, send_file
import json
from datetime import datetime, timezone, timedelta
import os
import re
import csv
import textwrap
import tempfile
import mimetypes
import shutil
import numpy as np
try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None

from modules import data_parser, mf4_parser, project_manager, tpc5_parser

state_bp = Blueprint("state", __name__)
ALLOWED_DATA_EXTENSIONS = (".csv", ".txt", ".dat", ".asc", ".ascii", ".mf4", ".tpc5")
RUN_NAME_ORDER_RE = re.compile(r"^(.*)-(\d+)(?:-([Rr])(\d+))?$")
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
PDF_INSTITUTE_LOGO = os.path.join(REPO_ROOT, "frontend", "public", "institute_logo-LightMode.png")
PDF_UNIVERSITY_LOGO = os.path.join(REPO_ROOT, "frontend", "public", "university_logo-LightMode.png")
SENSOR_MAPPING_REFERENCE_PDF = os.path.join(REPO_ROOT, "frontend", "public", "SensorMountingLocation-000.pdf")
DAQ_MEASUREMENT_CHAIN_REFERENCE_PDF = os.path.join(REPO_ROOT, "frontend", "public", "LU-DBI_MeasurementChain_v001.pdf")
DAQ_MIXTURE_SAMPLING_REFERENCE_PDF = os.path.join(REPO_ROOT, "frontend", "public", "MixtureSampling_Sub-System_000.pdf")
DAQ_SYSTEMS_FILENAME = "daq_systems.json"
SENSORS_MAPPING_FILENAME = "sensors_mapping.json"
CAMERAS_MAPPING_FILENAME = "cameras_mapping.json"
GAS_MIXING_FILENAME = "gas_mixing.json"
CHECKLIST_STATE_FILENAME = "checklist_state.json"
EXDA_DISPLAY_TIMEZONE = "Europe/Stockholm"
DEFAULT_GAS_VERIFY_FILE_A = "scripts/GasMixingVerificationFiles/H2_MFC_Fill_Calculator_v000.m"
DEFAULT_GAS_VERIFY_FILE_B = "scripts/GasMixingVerificationFiles/AuxFcn_H2_MFC_FillCalculator_000.m"


def _get_display_tz():
    if ZoneInfo is None:
        return None
    try:
        return ZoneInfo(EXDA_DISPLAY_TIMEZONE)
    except Exception:
        return None


def _now_display_str(include_seconds=True):
    fmt = "%Y-%m-%d %H:%M:%S" if include_seconds else "%Y-%m-%d %H:%M"
    tz = _get_display_tz()
    if tz is not None:
        return datetime.now(tz).strftime(fmt)
    return datetime.now().strftime(fmt)


def _iso_to_display_str(value, include_seconds=True):
    raw = str(value or "").strip()
    if not raw:
        return ""
    fmt = "%Y-%m-%d %H:%M:%S" if include_seconds else "%Y-%m-%d %H:%M"
    tz = _get_display_tz()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            # Naive values are treated as already-local display timestamps.
            return parsed.strftime(fmt)
        if tz is not None:
            return parsed.astimezone(tz).strftime(fmt)
        return parsed.astimezone().strftime(fmt)
    except Exception:
        return raw


def _to_posix_rel_path(base_path, target_path):
    try:
        return os.path.relpath(target_path, base_path).replace("\\", "/")
    except Exception:
        return str(target_path).replace("\\", "/")


def _to_float(value):
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return float(raw)
    except Exception:
        return None


def _normalize_mounting_label(value):
    text = str(value or "").strip()
    if text.lower() == "flush-mounted":
        return "flush"
    if text.lower() in {"n/a", "na", "not applicable"}:
        return "N/A"
    return text


def _normalize_trigger_method_label(value):
    text = str(value or "").strip()
    if text.lower() == "m-duino control box":
        return "M-Duino"
    return text


def _normalize_gas_verification_meta(raw_meta):
    source = raw_meta if isinstance(raw_meta, dict) else {}
    return {
        "isMatlabVerified": bool(source.get("isMatlabVerified")),
        "verificationRefFileA": str(source.get("verificationRefFileA") or source.get("verificationRefFile") or DEFAULT_GAS_VERIFY_FILE_A).strip(),
        "verificationRefFileB": str(source.get("verificationRefFileB") or DEFAULT_GAS_VERIFY_FILE_B).strip(),
    }


def _normalize_gas_dosage_model(raw_model):
    source = raw_model if isinstance(raw_model, dict) else {}
    model_type = "linear_targetVol_to_mass"
    return {
        "enabled": bool(source.get("enabled")),
        "modelType": model_type,
        "targetBasis": str(source.get("targetBasis") or "percent").strip() or "percent",
        "a": str(source.get("a") or "").strip(),
        "b": str(source.get("b") or "0").strip(),
        "notes": str(source.get("notes") or "").strip(),
    }


def _render_multichannel_content(t, y, channel_names):
    header = ["time"] + [str(name or "").strip() or f"Signal {idx + 1}" for idx, name in enumerate(channel_names or [])]
    lines = [",".join(header)]
    n_rows = len(t)
    if getattr(y, "ndim", 1) == 1:
        for idx in range(n_rows):
            lines.append(f"{float(t[idx]):.12g},{float(y[idx]):.12g}")
    else:
        for idx in range(n_rows):
            row = y[idx]
            row_values = ",".join(f"{float(value):.12g}" for value in row)
            lines.append(f"{float(t[idx]):.12g},{row_values}")
    return "\n".join(lines)


def _apply_time_window_to_text_content(content, time_start=None, time_end=None, max_samples=200000):
    if time_start is None and time_end is None:
        return content, None

    t, y, channel_names, err = data_parser.parse_multichannel_content(content)
    if err:
        return None, f"Failed to parse data for time windowing: {err}"

    start = float(time_start) if time_start is not None else None
    end = float(time_end) if time_end is not None else None
    if start is not None and end is not None and start > end:
        start, end = end, start

    indices = []
    for idx, ti in enumerate(t):
        value = float(ti)
        if start is not None and value < start:
            continue
        if end is not None and value > end:
            continue
        indices.append(idx)

    if not indices:
        return None, "Selected time window has no samples."

    if max_samples and max_samples > 0 and len(indices) > max_samples:
        picks = [int(round(i * (len(indices) - 1) / (max_samples - 1))) for i in range(max_samples)]
        indices = [indices[p] for p in picks]

    t_selected = t[indices]
    y_selected = y[indices]
    return _render_multichannel_content(t_selected, y_selected, channel_names), None


def _safe_stats(values):
    if values is None:
        return None
    arr = np.asarray(values, dtype=float).reshape(-1)
    if arr.size == 0:
        return None
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return None
    return {
        "min": float(np.min(finite)),
        "max": float(np.max(finite)),
        "mean": float(np.mean(finite)),
    }


def _time_summary(time_values):
    arr = np.asarray(time_values, dtype=float).reshape(-1)
    if arr.size == 0:
        return {
            "samples": 0,
            "start": None,
            "end": None,
            "durationSeconds": None,
            "strictlyIncreasing": False,
            "duplicates": 0,
            "estimatedSampleRateHz": None,
        }
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return {
            "samples": 0,
            "start": None,
            "end": None,
            "durationSeconds": None,
            "strictlyIncreasing": False,
            "duplicates": 0,
            "estimatedSampleRateHz": None,
        }

    diffs = np.diff(finite)
    positive_diffs = diffs[diffs > 0]
    estimated_rate = None
    if positive_diffs.size > 0:
        median_dt = float(np.median(positive_diffs))
        if np.isfinite(median_dt) and median_dt > 0:
            estimated_rate = float(1.0 / median_dt)

    return {
        "samples": int(finite.size),
        "start": float(finite[0]),
        "end": float(finite[-1]),
        "durationSeconds": float(finite[-1] - finite[0]) if finite.size > 1 else 0.0,
        "strictlyIncreasing": bool(np.all(diffs > 0)) if finite.size > 1 else True,
        "duplicates": int(np.sum(diffs == 0)) if finite.size > 1 else 0,
        "estimatedSampleRateHz": estimated_rate,
    }


def _build_preview_payload(t, y, channel_names, max_rows=50):
    """Build a compact first-rows preview table for inspector UI."""
    try:
        t_arr = np.asarray(t, dtype=float).reshape(-1)
    except Exception:
        t_arr = np.array([], dtype=float)

    try:
        y_arr = np.asarray(y, dtype=float)
    except Exception:
        y_arr = np.array([], dtype=float)

    if y_arr.ndim == 1:
        y_arr = y_arr.reshape(-1, 1)
    if y_arr.ndim != 2:
        y_arr = np.array([], dtype=float).reshape(0, 0)

    rows_available = min(int(t_arr.size), int(y_arr.shape[0])) if y_arr.size > 0 else 0
    if rows_available <= 0:
        return {"columns": ["time"], "rows": [], "rowCount": 0, "shownRows": 0}

    shown_rows = min(rows_available, int(max_rows))
    names = channel_names or [f"Signal {idx + 1}" for idx in range(y_arr.shape[1])]
    columns = ["time"] + [str(name or f"Signal {idx + 1}") for idx, name in enumerate(names[: y_arr.shape[1]])]

    rows = []
    for idx in range(shown_rows):
        row = [float(t_arr[idx]) if np.isfinite(t_arr[idx]) else None]
        for value in y_arr[idx, :]:
            row.append(float(value) if np.isfinite(value) else None)
        rows.append(row)

    return {
        "columns": columns,
        "rows": rows,
        "rowCount": int(rows_available),
        "shownRows": int(shown_rows),
    }


def _build_mf4_raw_preview_payload(mdf_obj, max_rows=50):
    """Build MF4 preview from native per-channel timestamps/samples (no dataframe merge)."""
    channel_pairs = []
    for group_idx, group in enumerate(getattr(mdf_obj, "groups", []) or []):
        channels = getattr(group, "channels", []) or []
        for channel_idx, channel in enumerate(channels):
            name = str(getattr(channel, "name", "") or "").strip()
            if not name:
                continue
            # Skip explicit MF4 time channels; each signal already carries native timestamps.
            if name.lower() == "time":
                continue
            try:
                signal = mdf_obj.get(group=group_idx, index=channel_idx, samples_only=False, raw=True)
            except Exception:
                continue
            samples = np.asarray(getattr(signal, "samples", []))
            timestamps = np.asarray(getattr(signal, "timestamps", []), dtype=float)
            if samples.size == 0 or timestamps.size == 0:
                continue
            if not np.issubdtype(samples.dtype, np.number):
                continue
            sample_values = np.asarray(samples, dtype=float).reshape(-1)
            time_values = np.asarray(timestamps, dtype=float).reshape(-1)
            pair_len = min(int(sample_values.size), int(time_values.size))
            if pair_len <= 0:
                continue
            unit = str(getattr(signal, "unit", "") or "").strip()
            label = f"{name} [{unit}]" if unit else str(name)
            channel_pairs.append(
                {
                    "label": label,
                    "groupLabel": f"g{group_idx}:{label}",
                    "time": time_values[:pair_len],
                    "values": sample_values[:pair_len],
                    "count": pair_len,
                }
            )

    if not channel_pairs:
        return {"columns": ["time"], "rows": [], "rowCount": 0, "shownRows": 0}

    min_available = min(pair["count"] for pair in channel_pairs)
    max_available = max(pair["count"] for pair in channel_pairs)

    # Prefer a single time column when all signal channels share the same native timestamp vector.
    shared_time_vector = False
    if min_available > 0:
        ref_time = channel_pairs[0]["time"][:min_available]
        shared_time_vector = all(
            pair["count"] >= min_available
            and np.allclose(ref_time, pair["time"][:min_available], rtol=1e-9, atol=1e-12, equal_nan=False)
            for pair in channel_pairs[1:]
        )

    if shared_time_vector:
        shown_rows = min(int(max_rows), int(min_available))
        labels = []
        used = {}
        for pair in channel_pairs:
            base = str(pair["label"] or "Signal")
            seen = used.get(base, 0)
            used[base] = seen + 1
            labels.append(base if seen == 0 else f"{base}__{seen + 1}")

        columns = ["time"] + labels
        rows = []
        for row_idx in range(shown_rows):
            row = [
                float(ref_time[row_idx]) if np.isfinite(ref_time[row_idx]) else None,
            ]
            for pair in channel_pairs:
                value = pair["values"][row_idx]
                row.append(float(value) if np.isfinite(value) else None)
            rows.append(row)

        return {
            "columns": columns,
            "rows": rows,
            "rowCount": int(min_available),
            "shownRows": int(shown_rows),
        }

    columns = []
    for pair in channel_pairs:
        columns.append(f"{pair['groupLabel']}__time")
        columns.append(pair["groupLabel"])

    shown_rows = min(int(max_rows), int(max_available))
    rows = []
    for row_idx in range(shown_rows):
        row = []
        for pair in channel_pairs:
            if row_idx < pair["count"]:
                t_val = pair["time"][row_idx]
                s_val = pair["values"][row_idx]
                row.append(float(t_val) if np.isfinite(t_val) else None)
                row.append(float(s_val) if np.isfinite(s_val) else None)
            else:
                row.append(None)
                row.append(None)
        rows.append(row)

    return {
        "columns": columns,
        "rows": rows,
        "rowCount": int(max_available),
        "shownRows": int(shown_rows),
    }


def _build_native_channel_preview_payload(channel_pairs, max_rows=50):
    """Build preview from native per-channel {label,time,values,count} records."""
    if not channel_pairs:
        return {"columns": ["time"], "rows": [], "rowCount": 0, "shownRows": 0}

    min_available = min(int(pair.get("count", 0)) for pair in channel_pairs)
    max_available = max(int(pair.get("count", 0)) for pair in channel_pairs)
    if max_available <= 0:
        return {"columns": ["time"], "rows": [], "rowCount": 0, "shownRows": 0}

    shared_time_vector = False
    if min_available > 0:
        ref_time = np.asarray(channel_pairs[0].get("time", []), dtype=float)[:min_available]
        shared_time_vector = all(
            int(pair.get("count", 0)) >= min_available
            and np.allclose(
                ref_time,
                np.asarray(pair.get("time", []), dtype=float)[:min_available],
                rtol=1e-9,
                atol=1e-12,
                equal_nan=False,
            )
            for pair in channel_pairs[1:]
        )
    if shared_time_vector:
        shown_rows = min(int(max_rows), int(min_available))
        labels = []
        used = {}
        for pair in channel_pairs:
            base = str(pair.get("label") or "Signal").strip() or "Signal"
            seen = used.get(base, 0)
            used[base] = seen + 1
            labels.append(base if seen == 0 else f"{base}__{seen + 1}")
        columns = ["time"] + labels
        rows = []
        for row_idx in range(shown_rows):
            row = [float(ref_time[row_idx]) if np.isfinite(ref_time[row_idx]) else None]
            for pair in channel_pairs:
                values = np.asarray(pair.get("values", []), dtype=float)
                value = values[row_idx] if row_idx < values.size else np.nan
                row.append(float(value) if np.isfinite(value) else None)
            rows.append(row)
        return {
            "columns": columns,
            "rows": rows,
            "rowCount": int(min_available),
            "shownRows": int(shown_rows),
        }

    shown_rows = min(int(max_rows), int(max_available))
    columns = []
    for pair in channel_pairs:
        label = str(pair.get("label") or "Signal").strip() or "Signal"
        columns.append(f"{label}__time")
        columns.append(label)

    rows = []
    for row_idx in range(shown_rows):
        row = []
        for pair in channel_pairs:
            times = np.asarray(pair.get("time", []), dtype=float)
            values = np.asarray(pair.get("values", []), dtype=float)
            count = int(pair.get("count", 0))
            if row_idx < count:
                t_val = times[row_idx] if row_idx < times.size else np.nan
                v_val = values[row_idx] if row_idx < values.size else np.nan
                row.append(float(t_val) if np.isfinite(t_val) else None)
                row.append(float(v_val) if np.isfinite(v_val) else None)
            else:
                row.append(None)
                row.append(None)
        rows.append(row)
    return {
        "columns": columns,
        "rows": rows,
        "rowCount": int(max_available),
        "shownRows": int(shown_rows),
    }


def _inspect_text_file_structure(target):
    with open(target, "r", encoding="utf-8") as handle:
        content = handle.read()

    t, y, names, err = data_parser.parse_multichannel_content(content)
    if err:
        return None, f"Could not parse text data structure: {err}"

    y_arr = np.asarray(y, dtype=float)
    if y_arr.ndim == 1:
        y_arr = y_arr.reshape(-1, 1)
    names = names or [f"Signal {idx + 1}" for idx in range(y_arr.shape[1])]

    channel_summaries = []
    for idx in range(y_arr.shape[1]):
        channel_summaries.append(
            {
                "index": int(idx),
                "name": str(names[idx]) if idx < len(names) else f"Signal {idx + 1}",
                "samples": int(y_arr.shape[0]),
                "sampleRateHz": _time_summary(t).get("estimatedSampleRateHz"),
                "triggerSample": None,
                "triggerTimeSeconds": None,
                "stats": _safe_stats(y_arr[:, idx]),
            }
        )

    return {
        "parser": "text/csv parser",
        "timeSummary": _time_summary(t),
        "channelCount": int(y_arr.shape[1]),
        "channels": channel_summaries,
        "preview": _build_preview_payload(t, y_arr, names, max_rows=50),
        "notes": [
            "Each channel uses the same parsed time vector for this file.",
            "No interpolation is applied in this structure report.",
        ],
    }, None


def _inspect_tpc5_file_structure(target):
    if getattr(tpc5_parser, "h5py", None) is None:
        return None, (
            "TPC5 structure inspection requires optional dependency 'h5py'. "
            "Install with: pip install h5py"
        )

    try:
        with tpc5_parser.h5py.File(target, "r") as handle:
            channels = tpc5_parser._collect_channels(handle)
    except Exception as exc:
        return None, f"Failed to inspect TPC5 file: {exc}"

    if not channels:
        return None, "TPC5 file has no readable numeric channels."

    ref = channels[0]
    ref_values = ref.get("values")
    if ref_values is None:
        ref_values = []
    sample_count = int(np.asarray(ref_values).size)
    sample_idx = np.arange(sample_count, dtype=np.int64)
    t_ref = (
        sample_idx.astype(float) - float(ref.get("trigger_sample") or 0.0)
    ) / float(ref.get("sample_rate") or 1.0) + float(ref.get("trigger_time") or 0.0)

    channel_summaries = []
    preview_vectors = []
    for idx, channel in enumerate(channels):
        raw_values = channel.get("values")
        if raw_values is None:
            raw_values = []
        values = np.asarray(raw_values, dtype=float).reshape(-1)
        preview_vectors.append(values)
        channel_summaries.append(
            {
                "index": int(idx),
                "name": str(channel.get("name") or f"Channel {idx + 1}"),
                "samples": int(values.size),
                "sampleRateHz": float(channel.get("sample_rate") or 0.0),
                "triggerSample": int(channel.get("trigger_sample") or 0),
                "triggerTimeSeconds": float(channel.get("trigger_time") or 0.0),
                "stats": _safe_stats(values),
            }
        )

    native_pairs = []
    for idx, channel in enumerate(channels):
        values = preview_vectors[idx] if idx < len(preview_vectors) else np.array([], dtype=float)
        sr = float(channel.get("sample_rate") or 1.0)
        ts = float(channel.get("trigger_sample") or 0.0)
        tt = float(channel.get("trigger_time") or 0.0)
        if not np.isfinite(sr) or sr == 0.0:
            sr = 1.0
        channel_idx = np.arange(values.size, dtype=float)
        t_native = (channel_idx - ts) / sr + tt
        native_pairs.append(
            {
                "label": str(channel.get("name") or f"Channel {idx + 1}"),
                "time": t_native,
                "values": values,
                "count": int(values.size),
            }
        )

    return {
        "parser": "tpc5 parser",
        "timeSummary": _time_summary(t_ref),
        "channelCount": int(len(channel_summaries)),
        "channels": channel_summaries,
        "preview": _build_native_channel_preview_payload(native_pairs, max_rows=50),
        "notes": [
            "TPC5 may contain channels with different per-channel timing metadata.",
            "Preview uses native per-channel timing/values from file metadata.",
        ],
    }, None


def _inspect_mf4_file_structure(target):
    if getattr(mf4_parser, "MDF", None) is None:
        return None, (
            "MF4 structure inspection requires optional dependency 'asammdf'. "
            "Install with: pip install asammdf"
        )

    try:
        mdf = mf4_parser.MDF(target)
        df = mdf.to_dataframe(time_from_zero=True)
        raw_preview = _build_mf4_raw_preview_payload(mdf, max_rows=50)
    except Exception as exc:
        return None, f"Failed to inspect MF4 file: {exc}"
    finally:
        try:
            mdf.close()
        except Exception:
            pass

    if df is None or df.empty:
        return None, "MF4 file has no samples."

    numeric_df = df.select_dtypes(include=["number"]).copy()
    if numeric_df.empty:
        return None, "MF4 file has no numeric channels."

    try:
        t = numeric_df.index.to_numpy(dtype=float)
    except Exception:
        t = np.arange(len(numeric_df), dtype=float)
    y_arr = numeric_df.to_numpy(dtype=float, copy=False)

    channel_summaries = []
    for idx, col_name in enumerate(numeric_df.columns):
        values = y_arr[:, idx] if y_arr.ndim == 2 and idx < y_arr.shape[1] else numeric_df.iloc[:, idx].to_numpy(dtype=float, copy=False)
        channel_summaries.append(
            {
                "index": int(idx),
                "name": str(col_name).strip() or f"Signal {idx + 1}",
                "samples": int(values.size),
                "sampleRateHz": _time_summary(t).get("estimatedSampleRateHz"),
                "triggerSample": None,
                "triggerTimeSeconds": None,
                "stats": _safe_stats(values),
            }
        )

    return {
        "parser": "mf4/asammdf parser",
        "timeSummary": _time_summary(t),
        "channelCount": int(len(channel_summaries)),
        "channels": channel_summaries,
        "preview": raw_preview,
        "normalizedPreview": _build_preview_payload(
            t,
            y_arr,
            [entry.get("name") for entry in channel_summaries],
            max_rows=50,
        ),
        "notes": [
            "Preview table shows native per-channel MF4 data (group/channel timestamps + samples).",
            "Normalized statistics still use a numeric dataframe time index.",
            "No interpolation is applied in this structure report.",
        ],
    }, None


def _sanitize_export_stem(value, fallback="Experiment_Plan"):
    raw = str(value or "").strip()
    if not raw:
        return fallback
    no_ext = os.path.splitext(project_manager.sanitize_filename(raw) or raw)[0]
    cleaned = re.sub(r"[\\/:*?\"<>|]+", "-", no_ext)
    cleaned = re.sub(r"\s+", "_", cleaned).strip("._")
    return cleaned or fallback


def _parse_run_name_order(name):
    clean = str(name or "").strip()
    match = RUN_NAME_ORDER_RE.match(clean)
    if not match:
        return (clean.lower(), float("inf"), -1, clean.lower())
    group = str(match.group(1) or "").strip().lower()
    run_num = int(match.group(2))
    repetition = int(match.group(4)) if match.group(4) else -1
    return (group, run_num, repetition, clean.lower())


def _row_schedule(meta):
    planned_date = str((meta or {}).get("plannedDate") or "").strip()
    if planned_date:
        return planned_date
    planned_day = str((meta or {}).get("plannedDay") or "").strip()
    return f"D{planned_day}" if planned_day else ""


def _resolve_pdf_logos():
    return {
        "institute": PDF_INSTITUTE_LOGO if os.path.exists(PDF_INSTITUTE_LOGO) else None,
        "university": PDF_UNIVERSITY_LOGO if os.path.exists(PDF_UNIVERSITY_LOGO) else None,
    }


def _resolve_sensor_mapping_reference_pdf():
    return SENSOR_MAPPING_REFERENCE_PDF if os.path.exists(SENSOR_MAPPING_REFERENCE_PDF) else None


def _resolve_daq_reference_pdfs():
    references = [
        ("LU-DBI Measurement Chain", DAQ_MEASUREMENT_CHAIN_REFERENCE_PDF),
        ("Mixture Sampling Sub-System", DAQ_MIXTURE_SAMPLING_REFERENCE_PDF),
    ]
    existing = []
    for title, path in references:
        if os.path.exists(path):
            existing.append({"title": title, "path": path})
    return existing


def _metadata_file_candidates(project_root, filename):
    reports_dir = os.path.join(project_root, "Reports")
    plan_dir = os.path.join(project_root, "Plan")
    return [
        os.path.join(reports_dir, filename),
        os.path.join(plan_dir, filename),
    ]


def _resolve_existing_metadata_file(project_root, filename):
    for candidate in _metadata_file_candidates(project_root, filename):
        if os.path.exists(candidate):
            return candidate
    return _metadata_file_candidates(project_root, filename)[0]


def _render_pdf_first_page_png(fitz_module, pdf_path, max_width_px=1400, max_height_px=1000):
    """Render first page of a PDF to a bounded-size PNG bytes payload."""
    ref_doc = fitz_module.open(pdf_path)
    try:
        ref_page = ref_doc.load_page(0)
        rect = ref_page.rect
        width = max(float(rect.width or 1.0), 1.0)
        height = max(float(rect.height or 1.0), 1.0)

        scale_x = max_width_px / width
        scale_y = max_height_px / height
        scale = min(scale_x, scale_y, 2.0)
        if scale <= 0:
            scale = 1.0

        pix = ref_page.get_pixmap(
            matrix=fitz_module.Matrix(scale, scale),
            alpha=False,
            annots=False,
        )
        return pix.tobytes("png")
    finally:
        ref_doc.close()


def _build_plan_export_rows(experiments, plan_meta=None):
    safe_experiments = experiments if isinstance(experiments, list) else []
    group_objectives = (plan_meta or {}).get("groupObjectives") if isinstance((plan_meta or {}).get("groupObjectives"), dict) else {}
    ordered = sorted(safe_experiments, key=lambda exp: _parse_run_name_order((exp or {}).get("name")))
    rows = []
    for exp in ordered:
        meta = (exp or {}).get("meta") or {}
        data_files = meta.get("dataFiles") if isinstance(meta.get("dataFiles"), list) else []
        run_name = str((exp or {}).get("name") or "").strip()
        group_match = re.match(r"^(.*)-(\d+)(?:-[Rr]\d+)?$", run_name)
        group = group_match.group(1) if group_match and group_match.group(1) else "GENERAL"
        rows.append({
            "run_name": run_name,
            "group": group,
            "group_description": str(group_objectives.get(group) or ""),
            "done": "Yes" if bool((exp or {}).get("done")) else "No",
            "run_status": "error" if bool(meta.get("hasError")) else ("canceled" if bool(meta.get("isCanceled")) else ("done" if bool((exp or {}).get("done")) else "planned")),
            "preparation": "Yes" if bool(meta.get("isPreparation")) else "No",
            "schedule": _row_schedule(meta),
            "planned_date": str(meta.get("plannedDate") or ""),
            "planned_day": str(meta.get("plannedDay") or ""),
            "h2": str(meta.get("h2") or ""),
            "h2_injected_grams": str(meta.get("h2InjectedGrams") or ""),
            "mfc_flow_slpm": str(meta.get("mfcFlowSlpm") or ""),
            "ignition": str(meta.get("ignition") or ""),
            "vent": str(meta.get("vent") or ""),
            "p0": str(meta.get("p0") or ""),
            "t0": str(meta.get("t0") or ""),
            "recirc_stop_to_ignition_sec": str(meta.get("recircStopToIgnitionSec") or ""),
            "cfd_hash": str(meta.get("cfdHash") or ""),
            "data_files_count": str(len(data_files)),
            "data_files": " | ".join(str(item) for item in data_files),
            "short_description": str(meta.get("shortDescription") or ""),
            "notes": str((exp or {}).get("notes") or ""),
            "error": "Yes" if bool(meta.get("hasError")) else "No",
            "error_note": str(meta.get("errorNote") or ""),
            "canceled": "Yes" if bool(meta.get("isCanceled")) else "No",
            "canceled_note": str(meta.get("canceledNote") or ""),
        })
    return rows


def _write_plan_csv(rows, target_path, plan_name=None, plan_meta=None):
    headers = [
        "Run Name", "Group", "Group Description", "Status", "Done", "Preparation", "Schedule", "Planned Date", "Planned Day",
        "H2 (%)", "H2 Injected (g)", "MFC Flow (SLPM)", "Ignition", "Vent", "Pressure P0 (Pa)", "Temperature T0 (K)",
        "Recirc Stop To Ignition (s)", "Case ID / CFD Hash", "Data Files Count", "File Path (Raw_Data Folder)",
        "Short Description", "Run Notes", "Error", "Error Note", "Canceled", "Canceled Note",
    ]
    with open(target_path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Plan Name", str(plan_name or "Experiment Plan")])
        writer.writerow(["Responsible Researcher", "PhD Student Javier I. Camacho"])
        writer.writerow(["Objective", str((plan_meta or {}).get("objective") or "-")])
        writer.writerow(["Start Date", str((plan_meta or {}).get("startDate") or "-")])
        writer.writerow(["Deadline", str((plan_meta or {}).get("deadline") or "-")])
        writer.writerow(["Total Experiments", str(len(rows))])
        writer.writerow(["Generated At", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
        writer.writerow([])
        writer.writerow(headers)
        for row in rows:
            writer.writerow([
                row["run_name"], row["group"], row["group_description"], row["run_status"], row["done"], row["preparation"], row["schedule"], row["planned_date"], row["planned_day"],
                row["h2"], row["h2_injected_grams"], row["mfc_flow_slpm"], row["ignition"], row["vent"], row["p0"], row["t0"],
                row["recirc_stop_to_ignition_sec"], row["cfd_hash"], row["data_files_count"], row["data_files"],
                row["short_description"], row["notes"], row["error"], row["error_note"], row["canceled"], row["canceled_note"],
            ])


def _parse_plan_date(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    candidates = [raw, raw[:10]]
    for candidate in candidates:
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
            try:
                return datetime.strptime(candidate, fmt).date()
            except Exception:
                continue
    return None


def _format_plan_date(value):
    parsed = _parse_plan_date(value)
    if parsed is not None:
        return parsed.strftime("%Y-%m-%d")
    raw = str(value or "").strip()
    return raw or "-"


def _is_yes(value):
    return str(value or "").strip().lower() in {"yes", "true", "1", "y"}


def _build_plan_overview_stats(plan_meta, rows):
    safe_rows = rows if isinstance(rows, list) else []
    total = len(safe_rows)
    done = sum(1 for row in safe_rows if _is_yes((row or {}).get("done")))
    canceled = sum(1 for row in safe_rows if _is_yes((row or {}).get("canceled")))
    errors = sum(1 for row in safe_rows if _is_yes((row or {}).get("error")))
    preparation = sum(1 for row in safe_rows if _is_yes((row or {}).get("preparation")))
    completion = round((done / total) * 100) if total else 0

    deadline = _parse_plan_date((plan_meta or {}).get("deadline"))
    today_tz = _get_display_tz()
    today = datetime.now(today_tz).date() if today_tz is not None else datetime.now().date()
    days_left = None
    if deadline is not None:
        days_left = max((deadline - today).days, 0)
    remaining = max(total - done, 0)
    pace = "--"
    if days_left and days_left > 0:
        pace = f"{remaining / days_left:.1f}"

    return {
        "total": total,
        "done": done,
        "canceled": canceled,
        "errors": errors,
        "preparation": preparation,
        "completion": completion,
        "days_left": days_left,
        "pace": pace,
    }


def _draw_plan_overview_page(fitz, doc, plan_name, plan_meta, rows, draw_logo):
    page = doc.new_page(width=842, height=595)
    draw_logo(page)

    def _textbox(rect, text, fontname="courier", fontsize=8.5, color=(0, 0, 0), align=0):
        page.insert_textbox(rect, str(text or ""), fontname=fontname, fontsize=fontsize, color=color, align=align)

    def _center_line(rect, y_pos, text, fontname="courier-bold", fontsize=14, color=(0, 0, 0)):
        text_value = str(text or "")
        try:
            text_width = fitz.get_text_length(text_value, fontname=fontname, fontsize=fontsize)
        except Exception:
            text_width = len(text_value) * fontsize * 0.55
        x_pos = rect.x0 + max((rect.width - text_width) / 2, 0)
        page.insert_text((x_pos, y_pos), text_value, fontname=fontname, fontsize=fontsize, color=color)

    def _clip_text(value, max_chars):
        text = str(value or "").strip()
        if len(text) <= max_chars:
            return text
        return text[: max(0, max_chars - 3)] + "..."

    def _status(row):
        if _is_yes((row or {}).get("error")):
            return "error"
        if _is_yes((row or {}).get("canceled")):
            return "canceled"
        if _is_yes((row or {}).get("done")):
            return "done"
        return "planned"

    stats = _build_plan_overview_stats(plan_meta, rows)
    primary = (0.10, 0.62, 0.72)
    cyan = (0.35, 0.78, 0.88)
    orange = (0.97, 0.44, 0.08)
    red = (0.88, 0.14, 0.14)
    yellow = (0.88, 0.72, 0.10)
    border = (0.72, 0.76, 0.82)
    muted = (0.35, 0.38, 0.43)
    light = (0.96, 0.98, 0.99)

    page.insert_text((36, 54), f"Campaign Overview - {plan_name or 'Experiment Plan'}", fontname="courier-bold", fontsize=18, color=(0, 0, 0))
    page.insert_text((36, 76), f"Generated: {_now_display_str(include_seconds=True)}", fontname="courier", fontsize=8.5, color=muted)

    dates_rect = fitz.Rect(36, 94, 806, 128)
    page.draw_rect(dates_rect, color=border, fill=light, width=0.7)
    page.insert_text((50, 116), f"Start: {_format_plan_date((plan_meta or {}).get('startDate'))}", fontname="courier", fontsize=8.5, color=(0, 0, 0))
    page.insert_text((220, 116), f"Deadline: {_format_plan_date((plan_meta or {}).get('deadline'))}", fontname="courier", fontsize=8.5, color=(0, 0, 0))

    # KPI cards
    kpi_y = 150
    kpi_h = 58
    kpi_gap = 12
    kpi_w = (770 - (3 * kpi_gap)) / 4
    kpis = [
        ("Canceled Runs", stats["canceled"], orange),
        ("Error Runs", stats["errors"], red),
        ("Preparation Runs", stats["preparation"], yellow),
        ("Completion", f"{stats['completion']}%", primary),
    ]
    for idx, (label, value, accent) in enumerate(kpis):
        x = 36 + idx * (kpi_w + kpi_gap)
        rect = fitz.Rect(x, kpi_y, x + kpi_w, kpi_y + kpi_h)
        page.draw_rect(rect, color=accent, fill=(0.985, 0.99, 0.995), width=0.8)
        _center_line(rect, kpi_y + 28, value, fontname="courier-bold", fontsize=17, color=accent)
        label_text = label
        if label == "Completion":
            label_text = f"Completion ({stats['done']}/{stats['total']})"
        _textbox(fitz.Rect(x + 4, kpi_y + 37, x + kpi_w - 4, kpi_y + 52), label_text, fontname="courier", fontsize=7.4, color=muted, align=1)

    plot_rect = fitz.Rect(36, 246, 806, 518)
    page.insert_text((36, 234), "Campaign Schedule", fontname="courier-bold", fontsize=10, color=(0, 0, 0))
    page.draw_rect(plot_rect, color=border, fill=(0.99, 0.995, 1.0), width=0.8)

    safe_rows = rows if isinstance(rows, list) else []
    start_date = _parse_plan_date((plan_meta or {}).get("startDate"))
    deadline = _parse_plan_date((plan_meta or {}).get("deadline"))
    dated_rows = []
    for row in safe_rows:
        row_date = _parse_plan_date((row or {}).get("planned_date"))
        key = row_date.strftime("%Y-%m-%d") if row_date is not None else str((row or {}).get("schedule") or "Unscheduled").strip() or "Unscheduled"
        dated_rows.append((key, row))

    day_keys = []
    if start_date is not None and deadline is not None and start_date <= deadline and (deadline - start_date).days <= 14:
        day_count = (deadline - start_date).days + 1
        day_keys = [
            (start_date + timedelta(days=offset)).strftime("%Y-%m-%d")
            for offset in range(day_count)
        ]
    else:
        day_keys = sorted({key for key, _ in dated_rows}, key=lambda value: (_parse_plan_date(value) is None, value))
    if not day_keys:
        day_keys = ["Unscheduled"]

    rows_by_day = {key: [] for key in day_keys}
    for key, row in dated_rows:
        rows_by_day.setdefault(key, []).append(row)
        if key not in day_keys:
            day_keys.append(key)
    for key in rows_by_day:
        rows_by_day[key].sort(key=lambda row: _parse_run_name_order((row or {}).get("run_name")))

    inner_left = plot_rect.x0 + 18
    inner_right = plot_rect.x1 - 18
    inner_top = plot_rect.y0 + 30
    inner_bottom = plot_rect.y1 - 34
    axis_y = inner_bottom + 8
    n_days = max(len(day_keys), 1)
    col_w = (inner_right - inner_left) / n_days
    max_lane_count = max((len(rows_by_day.get(key, [])) for key in day_keys), default=1)
    lane_h = max(11, min(21, (inner_bottom - inner_top) / max(max_lane_count, 1)))
    bar_h = max(8, min(16, lane_h - 3))
    bar_w = max(62, min(112, col_w * 0.68))

    page.draw_line((inner_left, axis_y), (inner_right, axis_y), color=(0.35, 0.38, 0.43), width=0.8)
    for idx, day_key in enumerate(day_keys):
        col_x = inner_left + idx * col_w
        center_x = col_x + col_w / 2
        # Dotted day separator.
        y_cursor = plot_rect.y0 + 18
        while y_cursor < axis_y:
            page.draw_line((center_x, y_cursor), (center_x, min(y_cursor + 2, axis_y)), color=(0.78, 0.84, 0.90), width=0.5)
            y_cursor += 6
        _textbox(fitz.Rect(col_x + 2, axis_y + 5, col_x + col_w - 2, axis_y + 18), day_key, fontname="courier", fontsize=6.8, color=muted, align=1)

        for lane_idx, row in enumerate(rows_by_day.get(day_key, [])):
            x0 = center_x - bar_w / 2
            y0 = inner_top + lane_idx * lane_h
            x1 = center_x + bar_w / 2
            y1 = y0 + bar_h
            status = _status(row)
            fill = {
                "done": cyan,
                "canceled": orange,
                "error": red,
                "planned": (0.80, 0.84, 0.88),
            }.get(status, cyan)
            text_color = (0, 0, 0) if status in {"done", "planned"} else (1, 1, 1)
            page.draw_rect(fitz.Rect(x0, y0, x1, y1), color=fill, fill=fill, width=0.6)
            label = _clip_text((row or {}).get("run_name") or "-", 22)
            _textbox(fitz.Rect(x0 + 2, y0 + 1.5, x1 - 2, y1 + 1.5), label, fontname="courier-bold", fontsize=6.5, color=text_color, align=1)

    legend_y = 548
    legend_items = [("Done", cyan), ("Canceled", orange), ("Error", red)]
    legend_x = 320
    for label, fill in legend_items:
        page.draw_rect(fitz.Rect(legend_x, legend_y - 7, legend_x + 8, legend_y + 1), color=fill, fill=fill, width=0.5)
        page.insert_text((legend_x + 13, legend_y), label, fontname="courier", fontsize=7.5, color=muted)
        legend_x += 82


def _write_plan_pdf(plan_name, plan_meta, rows, target_path):
    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        return False, f"PyMuPDF unavailable: {exc}"

    doc = fitz.open()
    page = None
    x0 = 24
    top_content_y = 92
    y = top_content_y
    line_h = 12
    logo_paths = _resolve_pdf_logos()

    def _draw_logo(page_obj):
        try:
            university_logo = logo_paths.get("university")
            if university_logo:
                page_obj.insert_image(
                    fitz.Rect(500, 16, 660, 76),
                    filename=university_logo,
                    keep_proportion=True,
                    overlay=True,
                )
            institute_logo = logo_paths.get("institute")
            if institute_logo:
                page_obj.insert_image(
                    fitz.Rect(668, 16, 818, 76),
                    filename=institute_logo,
                    keep_proportion=True,
                    overlay=True,
                )
        except Exception:
            # Keep export robust even if image parsing fails.
            return

    _draw_plan_overview_page(fitz, doc, plan_name, plan_meta, rows, _draw_logo)
    page = doc.new_page(width=842, height=595)  # A4 landscape
    y = top_content_y
    _draw_logo(page)

    def _write_line(text, bold=False):
        nonlocal page, y
        if y > 570:
            page = doc.new_page(width=842, height=595)
            y = top_content_y
            _draw_logo(page)
        page.insert_text((x0, y), text, fontname="courier-bold" if bold else "courier", fontsize=8.5, color=(0, 0, 0))
        y += line_h

    page.insert_text((x0, y), f"EXDA Plan Export - {plan_name or 'Experiment Plan'}", fontname="courier-bold", fontsize=18, color=(0, 0, 0))
    y += 22
    _write_line("Responsible Researcher: PhD Student Javier I. Camacho")
    _write_line(f"Objective: {str((plan_meta or {}).get('objective') or '-')}")
    _write_line(f"Start: {str((plan_meta or {}).get('startDate') or '-')} | Deadline: {str((plan_meta or {}).get('deadline') or '-')}")
    _write_line(f"Total Experiments: {len(rows)}")
    _write_line(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    _write_line("")

    grouped_rows = {}
    group_order = []
    for row in rows:
        group_name = row.get("group") or "GENERAL"
        if group_name not in grouped_rows:
            grouped_rows[group_name] = []
            group_order.append(group_name)
        grouped_rows[group_name].append(row)

    for group_name in group_order:
        entries = grouped_rows.get(group_name, [])
        group_description = ""
        for entry in entries:
            if str(entry.get("group_description") or "").strip():
                group_description = str(entry.get("group_description") or "").strip()
                break

        _write_line("")
        _write_line(f"Group: {group_name}", bold=True)
        _write_line(f"Group Objective: {group_description or '-'}")
        _write_line("-" * 112)

        for idx, row in enumerate(entries, start=1):
            _write_line(f"[{idx}/{len(entries)}] Run: {row.get('run_name') or '-'}", bold=True)
            _write_line(
                f"Status: {str(row.get('run_status') or 'planned').upper()} | Done: {row.get('done') or 'No'} | "
                f"Preparation: {row.get('preparation') or 'No'} | Schedule: {row.get('schedule') or '-'}"
            )
            _write_line(
                f"H2: {row.get('h2') or '-'} %vol | H2 Injected: {row.get('h2_injected_grams') or '-'} g | "
                f"MFC Flow: {row.get('mfc_flow_slpm') or '-'} SLPM"
            )
            _write_line(
                f"Ignition: {row.get('ignition') or '-'} | Vent: {row.get('vent') or '-'} | "
                f"P0: {row.get('p0') or '-'} Pa | T0: {row.get('t0') or '-'} K"
            )
            _write_line(
                f"Recirc Stop -> Ignition: {row.get('recirc_stop_to_ignition_sec') or '-'} s | "
                f"Case ID / CFD Hash: {row.get('cfd_hash') or '-'}"
            )
            _write_line(
                f"Error: {row.get('error') or 'No'} | Canceled: {row.get('canceled') or 'No'} | "
                f"Data Files: {row.get('data_files_count') or '0'}"
            )

            short_description = str(row.get("short_description") or "").strip() or "-"
            notes = str(row.get("notes") or "").strip() or "-"
            error_note = str(row.get("error_note") or "").strip() or "-"
            canceled_note = str(row.get("canceled_note") or "").strip() or "-"

            for line in textwrap.wrap(f"Short Description: {short_description}", width=112, break_long_words=True, break_on_hyphens=False) or ["Short Description: -"]:
                _write_line(line)
            for line in textwrap.wrap(f"Run Notes: {notes}", width=112, break_long_words=True, break_on_hyphens=False) or ["Run Notes: -"]:
                _write_line(line)
            for line in textwrap.wrap(f"Error Note: {error_note}", width=112, break_long_words=True, break_on_hyphens=False) or ["Error Note: -"]:
                _write_line(line)
            for line in textwrap.wrap(f"Canceled Note: {canceled_note}", width=112, break_long_words=True, break_on_hyphens=False) or ["Canceled Note: -"]:
                _write_line(line)

            data_files_raw = str(row.get("data_files") or "").strip()
            file_chunks = [chunk.strip() for chunk in data_files_raw.split("|") if chunk.strip()]
            if not file_chunks:
                _write_line("Data Files: -")
            else:
                _write_line("Data Files:")
                for file_path in file_chunks:
                    wrapped = textwrap.wrap(file_path, width=108, break_long_words=True, break_on_hyphens=False) or ["-"]
                    for wrapped_idx, wrapped_line in enumerate(wrapped):
                        prefix = "  - " if wrapped_idx == 0 else "    "
                        _write_line(f"{prefix}{wrapped_line}")
            _write_line("-" * 112)

    total_pages = len(doc)
    for page_index, page_obj in enumerate(doc, start=1):
        footer_text = f"Page {page_index}/{total_pages}"
        page_obj.insert_text(
            (770, 582),
            footer_text,
            fontname="courier",
            fontsize=8,
            color=(0.25, 0.25, 0.25),
        )

    doc.save(target_path, deflate=True, garbage=4)
    doc.close()
    return True, target_path


def _build_daq_export_rows(daq_systems):
    safe_items = daq_systems if isinstance(daq_systems, list) else []
    rows = []
    for item in safe_items:
        record = item if isinstance(item, dict) else {}
        rows.append({
            "name": str(record.get("name") or "").strip(),
            "measured_quantity": str(record.get("measuredQuantity") or "").strip(),
            "vendor": str(record.get("vendor") or "").strip(),
            "model": str(record.get("model") or "").strip(),
            "serial": str(record.get("serialNumber") or "").strip(),
            "sampling_rate_hz": str(record.get("samplingRateHz") or "").strip(),
            "channel_count": str(record.get("channelCount") or "").strip(),
            "owner": str(record.get("owner") or record.get("location") or "").strip(),
            "last_calibration_date": str(record.get("lastCalibrationDate") or "").strip(),
            "calibration_certificate_id": str(record.get("calibrationCertificateId") or "").strip(),
            "active": "Yes" if bool(record.get("isActive")) else "No",
            "notes": str(record.get("notes") or "").strip(),
        })
    rows.sort(key=lambda row: normalize_daq_name(row.get("name")))
    return rows


def normalize_daq_name(value):
    return str(value or "").strip().lower()


def _write_daq_csv(rows, target_path, project_name=None):
    headers = [
        "DAQ System Name",
        "Measured Quantity",
        "Vendor",
        "Model",
        "Serial Number",
        "Sampling Rate (Hz)",
        "Channel Count",
        "Owner",
        "Last Calibration Date",
        "Calibration Certificate ID",
        "Active",
        "Notes",
    ]
    reference_pdfs = _resolve_daq_reference_pdfs()
    with open(target_path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Export Type", "DAQ Systems"])
        writer.writerow(["Project", str(project_name or "-")])
        writer.writerow(["Responsible Researcher", "PhD Student Javier I. Camacho"])
        writer.writerow(["Total DAQ Systems", str(len(rows))])
        if reference_pdfs:
            for item in reference_pdfs:
                writer.writerow(["Reference PDF", f"{item['title']}: {os.path.relpath(item['path'], REPO_ROOT)}"])
        else:
            writer.writerow(["Reference PDF", "Not found"])
        writer.writerow(["Generated At", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
        writer.writerow([])
        writer.writerow(headers)
        for row in rows:
            writer.writerow([
                row["name"],
                row["measured_quantity"],
                row["vendor"],
                row["model"],
                row["serial"],
                row["sampling_rate_hz"],
                row["channel_count"],
                row["owner"],
                row["last_calibration_date"],
                row["calibration_certificate_id"],
                row["active"],
                row["notes"],
            ])


def _write_daq_pdf(project_name, rows, target_path):
    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        return False, f"PyMuPDF unavailable: {exc}"

    def _clip(value, width):
        text = str(value or "")
        if len(text) <= width:
            return text.ljust(width)
        if width <= 1:
            return text[:width]
        return (text[: width - 1] + "…")

    def _wrap(value, width):
        text = str(value or "").strip()
        if not text:
            return ["-"]
        return textwrap.wrap(
            text,
            width=width,
            break_long_words=True,
            break_on_hyphens=False,
        ) or ["-"]

    doc = fitz.open()
    page = doc.new_page(width=842, height=595)  # A4 landscape
    x0 = 24
    top_content_y = 92
    y = top_content_y
    line_h = 12
    logo_paths = _resolve_pdf_logos()
    reference_pdfs = _resolve_daq_reference_pdfs()

    def _draw_logo(page_obj):
        try:
            university_logo = logo_paths.get("university")
            if university_logo:
                page_obj.insert_image(
                    fitz.Rect(500, 16, 660, 76),
                    filename=university_logo,
                    keep_proportion=True,
                    overlay=True,
                )
            institute_logo = logo_paths.get("institute")
            if institute_logo:
                page_obj.insert_image(
                    fitz.Rect(668, 16, 818, 76),
                    filename=institute_logo,
                    keep_proportion=True,
                    overlay=True,
                )
        except Exception:
            return

    _draw_logo(page)

    def _write_line(text, bold=False):
        nonlocal page, y
        if y > 570:
            page = doc.new_page(width=842, height=595)
            y = top_content_y
            _draw_logo(page)
        page.insert_text((x0, y), text, fontname="courier-bold" if bold else "courier", fontsize=8.5, color=(0, 0, 0))
        y += line_h

    page.insert_text((x0, y), "EXDA DAQ Systems Export", fontname="courier-bold", fontsize=18, color=(0, 0, 0))
    y += 22
    _write_line(f"Project: {str(project_name or '-')}")
    _write_line("Responsible Researcher: PhD Student Javier I. Camacho")
    _write_line(f"Total DAQ Systems: {len(rows)}")
    if reference_pdfs:
        for item in reference_pdfs:
            _write_line(f"Reference PDF: {item['title']} ({os.path.relpath(item['path'], REPO_ROOT)})")
    else:
        _write_line("Reference PDF: Not found")
    _write_line(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    _write_line("")

    columns = [
        ("Name", 14),
        ("Quantity", 13),
        ("Vendor", 10),
        ("Model", 10),
        ("Serial", 14),
        ("Fs (Hz)", 8),
        ("Ch", 4),
        ("Owner", 12),
        ("Last Cal.", 10),
        ("Cal Cert ID", 12),
        ("Active", 6),
        ("Notes", 18),
    ]
    divider = "-+-".join("-" * width for _, width in columns)
    header = " | ".join(_clip(name, width) for name, width in columns)
    _write_line(header, bold=True)
    _write_line(divider)

    for row in rows:
        row_values = [
            row.get("name"),
            row.get("measured_quantity"),
            row.get("vendor"),
            row.get("model"),
            row.get("serial"),
            row.get("sampling_rate_hz"),
            row.get("channel_count"),
            row.get("owner"),
            row.get("last_calibration_date"),
            row.get("calibration_certificate_id"),
            row.get("active"),
            row.get("notes"),
        ]
        wrapped_cells = [_wrap(value, width) for value, (_, width) in zip(row_values, columns)]
        row_lines = max(len(lines) for lines in wrapped_cells) if wrapped_cells else 1

        for idx in range(row_lines):
            line = " | ".join(
                _clip((wrapped_cells[col_idx][idx] if idx < len(wrapped_cells[col_idx]) else ""), columns[col_idx][1])
                for col_idx in range(len(columns))
            )
            _write_line(line)

    for item in reference_pdfs:
        try:
            ref_png = _render_pdf_first_page_png(
                fitz,
                item["path"],
                max_width_px=1400,
                max_height_px=1000,
            )

            page = doc.new_page(width=842, height=595)
            _draw_logo(page)
            page.insert_text((x0, top_content_y), f"DAQ Reference Diagram - {item['title']}", fontname="courier-bold", fontsize=10, color=(0, 0, 0))
            page.insert_text(
                (x0, top_content_y + 14),
                f"Source: {os.path.relpath(item['path'], REPO_ROOT)}",
                fontname="courier",
                fontsize=8.5,
                color=(0, 0, 0),
            )
            image_rect = fitz.Rect(40, top_content_y + 28, 802, 570)
            page.insert_image(image_rect, stream=ref_png, keep_proportion=True, overlay=True)
        except Exception:
            # Keep export robust even if rendering a reference diagram fails.
            continue

    total_pages = len(doc)
    for page_index, page_obj in enumerate(doc, start=1):
        footer_text = f"Page {page_index}/{total_pages}"
        page_obj.insert_text(
            (770, 582),
            footer_text,
            fontname="courier",
            fontsize=8,
            color=(0.25, 0.25, 0.25),
        )

    doc.save(target_path, deflate=True, garbage=4)
    doc.close()
    return True, target_path


def _build_sensors_export_rows(mappings_by_group, group_notes=None, group_names=None):
    safe_groups = mappings_by_group if isinstance(mappings_by_group, dict) else {}
    safe_notes = group_notes if isinstance(group_notes, dict) else {}
    provided_groups = group_names if isinstance(group_names, list) else []
    merged_groups = set()
    for group in provided_groups:
        text = str(group).strip()
        if text:
            merged_groups.add(text)
    for group in safe_groups.keys():
        text = str(group).strip()
        if text:
            merged_groups.add(text)
    for group in safe_notes.keys():
        text = str(group).strip()
        if text:
            merged_groups.add(text)
    groups = sorted(merged_groups, key=lambda value: value.lower())
    rows = []
    for group in groups:
        sensors = safe_groups.get(group)
        safe_sensors = sensors if isinstance(sensors, list) else []
        group_note = str(safe_notes.get(group) or "").strip()

        sensor_id_counts = {}
        for item in safe_sensors:
            record = item if isinstance(item, dict) else {}
            sensor_id = str(record.get("sensorId") or "").strip().lower()
            if sensor_id:
                sensor_id_counts[sensor_id] = sensor_id_counts.get(sensor_id, 0) + 1

        ordered = sorted(
            safe_sensors,
            key=lambda item: str((item if isinstance(item, dict) else {}).get("sensorId") or "").strip().lower(),
        )
        if not ordered:
            rows.append({
                "group": group,
                "group_note": group_note,
                "sensor_id": "-",
                "quantity": "-",
                "daq_system": "-",
                "daq_channel": "-",
                "serial": "-",
                "manufacturer": "-",
                "model": "-",
                "sensitivity": "-",
                "location": "-",
                "coordinates": "-",
                "coordinate_origin": "-",
                "mounting": "-",
                "active": "-",
                "blind": "-",
                "trigger_method": "-",
                "status": "Reference",
                "notes": "-",
                "is_reference_only": True,
            })
            continue

        for item in ordered:
            record = item if isinstance(item, dict) else {}
            sensor_id = str(record.get("sensorId") or "").strip()
            measured_quantity = str(record.get("measuredQuantity") or "").strip()
            daq_system = str(record.get("daqSystem") or "").strip()
            daq_channel = str(record.get("daqChannel") or "").strip()
            serial = str(record.get("serialNumber") or "").strip()
            sensitivity = str(record.get("sensitivity") or "").strip()
            sensitivity_unit = str(record.get("sensitivityUnit") or "").strip()
            location = str(record.get("locationLabel") or "").strip()
            x = str(record.get("x") or "").strip()
            y = str(record.get("y") or "").strip()
            z = str(record.get("z") or "").strip()
            coordinate_unit = str(record.get("coordinateUnit") or "").strip()
            coordinate_origin = str(record.get("coordinateOrigin") or "").strip()
            mounting = _normalize_mounting_label(record.get("mountingMethod"))
            manufacturer = str(record.get("manufacturer") or "").strip()
            model = str(record.get("model") or "").strip()
            notes = str(record.get("notes") or "").strip()
            is_active = bool(record.get("isActive"))
            is_blind = bool(record.get("isBlindSensor"))
            is_trigger = bool(record.get("isTriggerChannel"))
            trigger_method = _normalize_trigger_method_label(record.get("triggerMethod"))

            status_errors = []
            if not sensor_id:
                status_errors.append("missing sensor id")
            elif sensor_id_counts.get(sensor_id.lower(), 0) > 1:
                status_errors.append("duplicate sensor id")
            if is_active and not daq_system:
                status_errors.append("missing DAQ system")
            if is_active and not daq_channel:
                status_errors.append("missing DAQ channel")
            # Reused active channel mappings are allowed for repeated runs/groups.
            # Keep duplicate sensor-id checks as hard errors, but do not mark channel reuse as incomplete.
            if not is_trigger:
                if not serial:
                    status_errors.append("missing serial")
                sensitivity_value = _to_float(sensitivity)
                if sensitivity_value is None or sensitivity_value == 0:
                    status_errors.append("invalid sensitivity")
                if not sensitivity_unit:
                    status_errors.append("missing sensitivity unit")
                if _to_float(x) is None or _to_float(y) is None or _to_float(z) is None:
                    status_errors.append("invalid coordinates")
                if not coordinate_origin:
                    status_errors.append("missing coordinate origin")
                if not mounting:
                    status_errors.append("missing mounting")

            status = "Complete" if not status_errors else "Incomplete"
            coordinates = f"({x or '-'},{y or '-'},{z or '-'})"
            sensitivity_display = f"{sensitivity or '-'} {sensitivity_unit}".strip()
            rows.append({
                "group": group,
                "group_note": group_note,
                "sensor_id": sensor_id,
                "quantity": measured_quantity,
                "daq_system": daq_system,
                "daq_channel": daq_channel,
                "serial": serial,
                "manufacturer": manufacturer,
                "model": model,
                "sensitivity": sensitivity_display,
                "location": location,
                "coordinates": coordinates,
                "coordinate_origin": coordinate_origin,
                "mounting": mounting,
                "active": "Yes" if is_active else "No",
                "blind": "Yes" if is_blind else "No",
                "trigger": "Yes" if is_trigger else "No",
                "trigger_method": trigger_method,
                "status": status,
                "notes": notes,
                "is_reference_only": False,
            })
    return rows


def _write_sensors_csv(rows, target_path, project_name=None):
    headers = [
        "Group",
        "Sensor ID",
        "Measured Quantity",
        "DAQ System",
        "DAQ Channel",
        "Serial Number",
        "Manufacturer",
        "Model",
        "Sensitivity",
        "Location Label",
        "Coord.(x,y,z)m",
        "Coordinate Origin",
        "Mounting Method",
        "Active",
        "Blind/Control",
        "Trigger Method",
        "Status",
        "Notes",
    ]
    total_groups = len({str(row.get("group") or "").strip() for row in rows if str(row.get("group") or "").strip()})
    total_mappings = sum(1 for row in rows if not bool(row.get("is_reference_only")))
    unique_sensor_ids = {
        str(row.get("sensor_id") or "").strip().lower()
        for row in rows
        if not bool(row.get("is_reference_only")) and str(row.get("sensor_id") or "").strip() and str(row.get("sensor_id") or "").strip() != "-"
    }
    total_sensors = len(unique_sensor_ids)
    reference_pdf = _resolve_sensor_mapping_reference_pdf()
    reference_display = (
        os.path.relpath(reference_pdf, REPO_ROOT)
        if reference_pdf
        else "Not found (expected: frontend/public/SensorMountingLocation-000.pdf)"
    )
    with open(target_path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Export Type", "Sensors Mapping"])
        writer.writerow(["Project", str(project_name or "-")])
        writer.writerow(["Responsible Researcher", "PhD Student Javier I. Camacho"])
        writer.writerow(["Total Groups", str(total_groups)])
        writer.writerow(["Total Sensor IDs", str(total_sensors)])
        writer.writerow(["Total Sensor Mappings", str(total_mappings)])
        writer.writerow(["Sensor Mounting Reference File", reference_display])
        writer.writerow(["Generated At", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
        writer.writerow([])
        previous_group = None
        previous_group_note = ""
        for row in rows:
            current_group = str(row.get("group") or "").strip()
            current_group_note = str(row.get("group_note") or "").strip()
            if current_group != previous_group:
                if previous_group is not None:
                    if previous_group_note:
                        writer.writerow([f"Group Reference Note ({previous_group})", previous_group_note])
                    writer.writerow([])
                writer.writerow(headers)
            writer.writerow([
                row["group"],
                row["sensor_id"],
                row["quantity"],
                row["daq_system"],
                row["daq_channel"],
                row["serial"],
                row["manufacturer"],
                row["model"],
                row["sensitivity"],
                row["location"],
                row["coordinates"],
                row["coordinate_origin"],
                row["mounting"],
                row["active"],
                row["blind"],
                row.get("trigger_method", ""),
                row["status"],
                row["notes"],
            ])
            previous_group = current_group
            previous_group_note = current_group_note
        if previous_group and previous_group_note:
            writer.writerow([f"Group Reference Note ({previous_group})", previous_group_note])


def _write_sensors_pdf(project_name, rows, target_path):
    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        return False, f"PyMuPDF unavailable: {exc}"

    def _clip(value, width):
        text = str(value or "")
        if len(text) <= width:
            return text.ljust(width)
        if width <= 1:
            return text[:width]
        return (text[: width - 1] + "…")

    def _wrap(value, width):
        text = str(value or "").strip()
        if not text:
            return ["-"]
        return textwrap.wrap(
            text,
            width=width,
            break_long_words=True,
            break_on_hyphens=False,
        ) or ["-"]

    doc = fitz.open()
    page = doc.new_page(width=842, height=595)  # A4 landscape
    x0 = 24
    top_content_y = 92
    y = top_content_y
    line_h = 12
    logo_paths = _resolve_pdf_logos()
    reference_pdf = _resolve_sensor_mapping_reference_pdf()

    def _draw_logo(page_obj):
        try:
            university_logo = logo_paths.get("university")
            if university_logo:
                page_obj.insert_image(
                    fitz.Rect(500, 16, 660, 76),
                    filename=university_logo,
                    keep_proportion=True,
                    overlay=True,
                )
            institute_logo = logo_paths.get("institute")
            if institute_logo:
                page_obj.insert_image(
                    fitz.Rect(668, 16, 818, 76),
                    filename=institute_logo,
                    keep_proportion=True,
                    overlay=True,
                )
        except Exception:
            return

    _draw_logo(page)

    def _write_line(text, bold=False):
        nonlocal page, y
        if y > 570:
            page = doc.new_page(width=842, height=595)
            y = top_content_y
            _draw_logo(page)
        page.insert_text((x0, y), text, fontname="courier-bold" if bold else "courier", fontsize=8.5, color=(0, 0, 0))
        y += line_h

    total_groups = len({str(row.get("group") or "").strip() for row in rows if str(row.get("group") or "").strip()})
    total_mappings = sum(1 for row in rows if not bool(row.get("is_reference_only")))
    unique_sensor_ids = {
        str(row.get("sensor_id") or "").strip().lower()
        for row in rows
        if not bool(row.get("is_reference_only")) and str(row.get("sensor_id") or "").strip() and str(row.get("sensor_id") or "").strip() != "-"
    }
    total_sensors = len(unique_sensor_ids)

    page.insert_text((x0, y), "EXDA Sensors Mapping Export", fontname="courier-bold", fontsize=18, color=(0, 0, 0))
    y += 22
    _write_line(f"Project: {str(project_name or '-')}")
    _write_line("Responsible Researcher: PhD Student Javier I. Camacho")
    _write_line(f"Total Groups: {total_groups}")
    _write_line(f"Total Sensor IDs: {total_sensors}")
    _write_line(f"Total Sensor Mappings: {total_mappings}")
    _write_line(
        "Sensor Mounting Reference File: "
        + (os.path.relpath(reference_pdf, REPO_ROOT) if reference_pdf else "Not found")
    )
    _write_line(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    _write_line("")

    columns = [
        ("Group", 7),
        ("Sensor", 7),
        ("Qty", 9),
        ("DAQ", 8),
        ("Ch", 5),
        ("S/N", 7),
        ("Sensitivity", 10),
        ("Location", 8),
        ("Coord.(x,y,z)m", 14),
        ("Mount", 9),
        ("Active", 6),
        ("Blind", 5),
        ("Trig Method", 11),
        ("Status", 10),
    ]
    divider = "-+-".join("-" * width for _, width in columns)
    header = " | ".join(_clip(name, width) for name, width in columns)

    previous_group = None
    previous_group_note = ""
    for row in rows:
        current_group = str(row.get("group") or "")
        current_group_note = str(row.get("group_note") or "").strip()
        if previous_group is None:
            _write_line("")
            _write_line(f"Group: {current_group or '-'}", bold=True)
            _write_line(header, bold=True)
            _write_line(divider)
        elif current_group != previous_group:
            if previous_group_note:
                _write_line(f"Group Reference Note: {previous_group_note}")
            _write_line("")
            _write_line("=" * len(divider), bold=False)
            _write_line(f"Group: {current_group or '-'}", bold=True)
            _write_line(header, bold=True)
            _write_line(divider)
        previous_group = current_group
        previous_group_note = current_group_note

        row_values = [
            row.get("group"),
            row.get("sensor_id"),
            row.get("quantity"),
            row.get("daq_system"),
            row.get("daq_channel"),
            row.get("serial"),
            row.get("sensitivity"),
            row.get("location"),
            row.get("coordinates"),
            row.get("mounting"),
            row.get("active"),
            row.get("blind"),
            row.get("trigger_method", "-"),
            row.get("status"),
        ]
        wrapped_cells = [_wrap(value, width) for value, (_, width) in zip(row_values, columns)]
        row_lines = max(len(lines) for lines in wrapped_cells) if wrapped_cells else 1

        for idx in range(row_lines):
            line = " | ".join(
                _clip((wrapped_cells[col_idx][idx] if idx < len(wrapped_cells[col_idx]) else ""), columns[col_idx][1])
                for col_idx in range(len(columns))
            )
            _write_line(line)

    if previous_group and previous_group_note:
        _write_line(f"Group Reference Note: {previous_group_note}")

    if reference_pdf:
        try:
            ref_png = _render_pdf_first_page_png(
                fitz,
                reference_pdf,
                max_width_px=1400,
                max_height_px=1000,
            )

            page = doc.new_page(width=842, height=595)
            _draw_logo(page)
            page.insert_text((x0, top_content_y), "Sensor Mounting Reference Diagram", fontname="courier-bold", fontsize=10, color=(0, 0, 0))
            page.insert_text(
                (x0, top_content_y + 14),
                f"Source: {os.path.relpath(reference_pdf, REPO_ROOT)}",
                fontname="courier",
                fontsize=8.5,
                color=(0, 0, 0),
            )
            image_rect = fitz.Rect(40, top_content_y + 28, 802, 570)
            page.insert_image(image_rect, stream=ref_png, keep_proportion=True, overlay=True)
        except Exception:
            # Keep export robust even if rendering the diagram fails.
            pass

    total_pages = len(doc)
    for page_index, page_obj in enumerate(doc, start=1):
        footer_text = f"Page {page_index}/{total_pages}"
        page_obj.insert_text(
            (770, 582),
            footer_text,
            fontname="courier",
            fontsize=8,
            color=(0.25, 0.25, 0.25),
        )

    doc.save(target_path, deflate=True, garbage=4)
    doc.close()
    return True, target_path


def _camera_type_display(record):
    camera_type = str(record.get("cameraType") or "").strip()
    if camera_type == "Other":
        return str(record.get("customCameraType") or "").strip() or "Other"
    return camera_type


def _camera_trigger_display(record):
    trigger_source = str(record.get("triggerSource") or "").strip()
    if trigger_source == "Other":
        return str(record.get("customTriggerSource") or "").strip() or "Other"
    return trigger_source


def _is_infrared_camera_record(record):
    text = f"{_camera_type_display(record)} {record.get('model') or ''}".lower()
    return "infrared" in text or "thermal" in text or re.search(r"\bir\b", text) is not None


def _build_cameras_export_rows(mappings_by_group, group_notes=None, group_names=None):
    safe_groups = mappings_by_group if isinstance(mappings_by_group, dict) else {}
    safe_notes = group_notes if isinstance(group_notes, dict) else {}
    provided_groups = group_names if isinstance(group_names, list) else []
    merged_groups = set()
    for group in provided_groups:
        text = str(group).strip()
        if text:
            merged_groups.add(text)
    for group in safe_groups.keys():
        text = str(group).strip()
        if text:
            merged_groups.add(text)
    for group in safe_notes.keys():
        text = str(group).strip()
        if text:
            merged_groups.add(text)

    rows = []
    groups = sorted(merged_groups, key=lambda value: value.lower())
    for group in groups:
        cameras = safe_groups.get(group)
        safe_cameras = cameras if isinstance(cameras, list) else []
        group_note = str(safe_notes.get(group) or "").strip()

        camera_id_counts = {}
        for item in safe_cameras:
            record = item if isinstance(item, dict) else {}
            camera_id = str(record.get("cameraId") or "").strip().lower()
            if camera_id:
                camera_id_counts[camera_id] = camera_id_counts.get(camera_id, 0) + 1

        ordered = sorted(
            safe_cameras,
            key=lambda item: str((item if isinstance(item, dict) else {}).get("cameraId") or "").strip().lower(),
        )
        if not ordered:
            rows.append({
                "group": group,
                "group_note": group_note,
                "camera_id": "-",
                "camera_type": "-",
                "model": "-",
                "serial": "-",
                "frame_rate": "-",
                "resolution": "-",
                "lens_focal_length": "-",
                "coordinates": "-",
                "coordinate_unit": "-",
                "coordinate_origin": "-",
                "mounting_location": "-",
                "field_of_view": "-",
                "trigger_source": "-",
                "synchronization_notes": "-",
                "active": "-",
                "calibration_reference": "-",
                "emissivity": "-",
                "temperature_range": "-",
                "status": "Reference",
                "notes": "-",
                "is_reference_only": True,
            })
            continue

        for item in ordered:
            record = item if isinstance(item, dict) else {}
            camera_id = str(record.get("cameraId") or "").strip()
            camera_type = _camera_type_display(record)
            model = str(record.get("model") or "").strip()
            serial = str(record.get("serialNumber") or "").strip()
            frame_rate = str(record.get("frameRate") or "").strip()
            resolution = str(record.get("resolution") or "").strip()
            lens_focal_length = str(record.get("lensFocalLength") or "").strip()
            x = str(record.get("x") or "").strip()
            y = str(record.get("y") or "").strip()
            z = str(record.get("z") or "").strip()
            coordinate_unit = str(record.get("coordinateUnit") or "").strip() or "m"
            coordinate_origin = str(record.get("coordinateOrigin") or "").strip()
            mounting_location = str(record.get("mountingLocation") or "").strip()
            field_of_view = str(record.get("fieldOfView") or "").strip()
            trigger_source = _camera_trigger_display(record)
            synchronization_notes = str(record.get("synchronizationNotes") or "").strip()
            is_active = record.get("isActive") is not False
            calibration_reference = str(record.get("calibrationReference") or "").strip()
            emissivity = str(record.get("emissivity") or "").strip()
            temperature_range = str(record.get("temperatureRange") or "").strip()
            notes = str(record.get("notes") or "").strip()

            status_errors = []
            status_warnings = []
            if not camera_id:
                status_errors.append("missing camera id")
            elif camera_id_counts.get(camera_id.lower(), 0) > 1:
                status_errors.append("duplicate camera id")
            if not camera_type:
                status_warnings.append("missing camera type")
            if not model:
                status_warnings.append("missing model")
            if not serial:
                status_warnings.append("missing serial")
            if not frame_rate:
                status_warnings.append("missing frame rate")
            if not resolution:
                status_warnings.append("missing resolution")
            if not lens_focal_length:
                status_warnings.append("missing lens")
            if not mounting_location:
                status_warnings.append("missing mounting description")
            if not field_of_view:
                status_warnings.append("missing field of view")
            if not trigger_source:
                status_warnings.append("missing trigger source")
            if not synchronization_notes:
                status_warnings.append("missing synchronization notes")
            if _to_float(x) is None or _to_float(y) is None or _to_float(z) is None:
                status_warnings.append("coordinates not numeric")
            if not coordinate_origin:
                status_warnings.append("missing coordinate origin")
            if _is_infrared_camera_record(record):
                if not emissivity:
                    status_warnings.append("missing emissivity")
                if not temperature_range:
                    status_warnings.append("missing temperature range")

            if status_errors:
                status = "Incomplete"
            elif status_warnings:
                status = "Needs Review"
            else:
                status = "Complete"

            rows.append({
                "group": group,
                "group_note": group_note,
                "camera_id": camera_id,
                "camera_type": camera_type,
                "model": model,
                "serial": serial,
                "frame_rate": frame_rate,
                "resolution": resolution,
                "lens_focal_length": lens_focal_length,
                "coordinates": f"({x or '-'},{y or '-'},{z or '-'})",
                "coordinate_unit": coordinate_unit,
                "coordinate_origin": coordinate_origin,
                "mounting_location": mounting_location,
                "field_of_view": field_of_view,
                "trigger_source": trigger_source,
                "synchronization_notes": synchronization_notes,
                "active": "Yes" if is_active else "No",
                "calibration_reference": calibration_reference,
                "emissivity": emissivity,
                "temperature_range": temperature_range,
                "status": status,
                "notes": notes,
                "is_reference_only": False,
            })
    return rows


def _write_cameras_csv(rows, target_path, project_name=None):
    headers = [
        "Group",
        "Camera ID",
        "Camera Type",
        "Model",
        "Serial Number",
        "Frame Rate",
        "Resolution",
        "Lens / Focal Length",
        "Position Coordinates",
        "Coordinate Unit",
        "Coordinate Origin",
        "Mounting Description",
        "Field of View / Target Region",
        "Trigger Source",
        "Synchronization Notes",
        "Active",
        "Calibration / Reference Image",
        "Emissivity",
        "Temperature Range",
        "Status",
        "Notes",
    ]
    total_groups = len({str(row.get("group") or "").strip() for row in rows if str(row.get("group") or "").strip()})
    total_mappings = sum(1 for row in rows if not bool(row.get("is_reference_only")))
    unique_camera_ids = {
        str(row.get("camera_id") or "").strip().lower()
        for row in rows
        if not bool(row.get("is_reference_only")) and str(row.get("camera_id") or "").strip() and str(row.get("camera_id") or "").strip() != "-"
    }
    with open(target_path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Export Type", "Cameras Mapping"])
        writer.writerow(["Project", str(project_name or "-")])
        writer.writerow(["Responsible Researcher", "PhD Student Javier I. Camacho"])
        writer.writerow(["Total Groups", str(total_groups)])
        writer.writerow(["Total Camera IDs", str(len(unique_camera_ids))])
        writer.writerow(["Total Camera Mappings", str(total_mappings)])
        writer.writerow(["Generated At", _now_display_str(include_seconds=True)])
        writer.writerow([])
        previous_group = None
        previous_group_note = ""
        for row in rows:
            current_group = str(row.get("group") or "").strip()
            current_group_note = str(row.get("group_note") or "").strip()
            if current_group != previous_group:
                if previous_group is not None:
                    if previous_group_note:
                        writer.writerow([f"Group Reference Note ({previous_group})", previous_group_note])
                    writer.writerow([])
                writer.writerow(headers)
            writer.writerow([
                row.get("group", ""),
                row.get("camera_id", ""),
                row.get("camera_type", ""),
                row.get("model", ""),
                row.get("serial", ""),
                row.get("frame_rate", ""),
                row.get("resolution", ""),
                row.get("lens_focal_length", ""),
                row.get("coordinates", ""),
                row.get("coordinate_unit", ""),
                row.get("coordinate_origin", ""),
                row.get("mounting_location", ""),
                row.get("field_of_view", ""),
                row.get("trigger_source", ""),
                row.get("synchronization_notes", ""),
                row.get("active", ""),
                row.get("calibration_reference", ""),
                row.get("emissivity", ""),
                row.get("temperature_range", ""),
                row.get("status", ""),
                row.get("notes", ""),
            ])
            previous_group = current_group
            previous_group_note = current_group_note
        if previous_group and previous_group_note:
            writer.writerow([f"Group Reference Note ({previous_group})", previous_group_note])


def _write_cameras_pdf(project_name, rows, target_path):
    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        return False, f"PyMuPDF unavailable: {exc}"

    def _clip(value, width):
        text = str(value or "")
        if len(text) <= width:
            return text.ljust(width)
        if width <= 1:
            return text[:width]
        return (text[: width - 1] + "…")

    def _wrap(value, width):
        text = str(value or "").strip()
        if not text:
            return ["-"]
        return textwrap.wrap(text, width=width, break_long_words=True, break_on_hyphens=False) or ["-"]

    doc = fitz.open()
    page = doc.new_page(width=842, height=595)
    x0 = 24
    top_content_y = 92
    y = top_content_y
    line_h = 12
    logo_paths = _resolve_pdf_logos()

    def _draw_logo(page_obj):
        try:
            university_logo = logo_paths.get("university")
            if university_logo:
                page_obj.insert_image(fitz.Rect(500, 16, 660, 76), filename=university_logo, keep_proportion=True, overlay=True)
            institute_logo = logo_paths.get("institute")
            if institute_logo:
                page_obj.insert_image(fitz.Rect(668, 16, 818, 76), filename=institute_logo, keep_proportion=True, overlay=True)
        except Exception:
            return

    _draw_logo(page)

    def _write_line(text, bold=False):
        nonlocal page, y
        if y > 570:
            page = doc.new_page(width=842, height=595)
            y = top_content_y
            _draw_logo(page)
        page.insert_text((x0, y), text, fontname="courier-bold" if bold else "courier", fontsize=8.5, color=(0, 0, 0))
        y += line_h

    total_groups = len({str(row.get("group") or "").strip() for row in rows if str(row.get("group") or "").strip()})
    total_mappings = sum(1 for row in rows if not bool(row.get("is_reference_only")))
    unique_camera_ids = {
        str(row.get("camera_id") or "").strip().lower()
        for row in rows
        if not bool(row.get("is_reference_only")) and str(row.get("camera_id") or "").strip() and str(row.get("camera_id") or "").strip() != "-"
    }

    page.insert_text((x0, y), "EXDA Cameras Mapping Export", fontname="courier-bold", fontsize=18, color=(0, 0, 0))
    y += 22
    _write_line(f"Project: {str(project_name or '-')}")
    _write_line("Responsible Researcher: PhD Student Javier I. Camacho")
    _write_line(f"Total Groups: {total_groups}")
    _write_line(f"Total Camera IDs: {len(unique_camera_ids)}")
    _write_line(f"Total Camera Mappings: {total_mappings}")
    _write_line(f"Generated: {_now_display_str(include_seconds=True)}")
    _write_line("")

    columns = [
        ("Group", 8),
        ("Camera", 8),
        ("Type", 10),
        ("Model", 10),
        ("Serial", 8),
        ("FPS", 7),
        ("Res.", 9),
        ("Lens", 8),
        ("Coord.", 13),
        ("Mount", 10),
        ("Trigger", 10),
        ("IR", 8),
        ("Active", 6),
        ("Status", 10),
    ]
    divider = "-+-".join("-" * width for _, width in columns)
    header = " | ".join(_clip(name, width) for name, width in columns)

    previous_group = None
    previous_group_note = ""
    for row in rows:
        current_group = str(row.get("group") or "")
        current_group_note = str(row.get("group_note") or "").strip()
        if previous_group is None:
            _write_line("")
            _write_line(f"Group: {current_group or '-'}", bold=True)
            _write_line(header, bold=True)
            _write_line(divider)
        elif current_group != previous_group:
            if previous_group_note:
                _write_line(f"Group Reference Note: {previous_group_note}")
            _write_line("")
            _write_line("=" * len(divider))
            _write_line(f"Group: {current_group or '-'}", bold=True)
            _write_line(header, bold=True)
            _write_line(divider)

        previous_group = current_group
        previous_group_note = current_group_note
        ir_display = " / ".join(
            part for part in [str(row.get("emissivity") or "").strip(), str(row.get("temperature_range") or "").strip()] if part
        ) or "-"
        row_values = [
            row.get("group"),
            row.get("camera_id"),
            row.get("camera_type"),
            row.get("model"),
            row.get("serial"),
            row.get("frame_rate"),
            row.get("resolution"),
            row.get("lens_focal_length"),
            f"{row.get('coordinates') or '-'} {row.get('coordinate_unit') or ''}".strip(),
            row.get("mounting_location"),
            row.get("trigger_source"),
            ir_display,
            row.get("active"),
            row.get("status"),
        ]
        wrapped_cells = [_wrap(value, width) for value, (_, width) in zip(row_values, columns)]
        row_lines = max(len(lines) for lines in wrapped_cells) if wrapped_cells else 1
        for idx in range(row_lines):
            line = " | ".join(
                _clip((wrapped_cells[col_idx][idx] if idx < len(wrapped_cells[col_idx]) else ""), columns[col_idx][1])
                for col_idx in range(len(columns))
            )
            _write_line(line)

    if previous_group and previous_group_note:
        _write_line(f"Group Reference Note: {previous_group_note}")

    total_pages = len(doc)
    for page_index, page_obj in enumerate(doc, start=1):
        footer_text = f"Page {page_index}/{total_pages}"
        page_obj.insert_text((770, 582), footer_text, fontname="courier", fontsize=8, color=(0.25, 0.25, 0.25))

    doc.save(target_path, deflate=True, garbage=4)
    doc.close()
    return True, target_path


def _build_gas_mixing_export_rows(records):
    def _short_run_name(group_name, run_name):
        group_clean = str(group_name or "").strip()
        run_clean = str(run_name or "").strip()
        if not run_clean:
            return ""
        prefix = f"{group_clean}-" if group_clean else ""
        if prefix and run_clean.startswith(prefix):
            return run_clean[len(prefix):] or run_clean
        return run_clean

    def _fmt(value, decimals=None):
        numeric = _to_float(value)
        if numeric is None:
            return ""
        if decimals is None:
            return f"{numeric}"
        return f"{numeric:.{decimals}f}"

    def _is_yes(value):
        return str(value or "").strip().lower() in {"yes", "true", "1", "y"}

    def _chamber_l(record):
        v_l = _to_float(record.get("vChamberL"))
        if v_l is not None:
            return v_l
        v_m3 = _to_float(record.get("vChamberCorrectedM3"))
        if v_m3 is not None:
            return v_m3 * 1e3
        return None

    def _h2_inj_l(record):
        direct = _to_float(record.get("vH2InjectedL"))
        if direct is not None:
            return direct
        results = record.get("results") if isinstance(record.get("results"), dict) else {}
        return _to_float(results.get("V_H2_injected_L"))

    def _t_chamber_c(record):
        direct = _to_float(record.get("tChamberC"))
        if direct is not None:
            return direct
        kelvin = _to_float(record.get("tChamberK"))
        if kelvin is None:
            results = record.get("results") if isinstance(record.get("results"), dict) else {}
            kelvin = _to_float(results.get("T_chamber_K"))
        if kelvin is not None:
            return kelvin - 273.15
        return None

    def _h2_mass_est_g(record):
        direct = _to_float(record.get("mH2EstimatedG"))
        if direct is not None:
            return direct
        results = record.get("results") if isinstance(record.get("results"), dict) else {}
        from_results = _to_float(results.get("m_H2_injected_g"))
        if from_results is not None:
            return from_results
        # Backward compatibility: before calibration support, mH2InjectedG stored
        # the uncorrected ideal-gas estimate.
        if not _is_yes(record.get("calibrationApplied")):
            return _to_float(record.get("mH2InjectedG") or record.get("h2MassG"))
        return None

    def _h2_mass_corr_g(record):
        direct = _to_float(record.get("mH2CorrectedG"))
        if direct is not None:
            return direct
        correction = record.get("correction") if isinstance(record.get("correction"), dict) else None
        if isinstance(correction, dict):
            corr_val = _to_float(correction.get("correctedMassG"))
            if corr_val is not None:
                return corr_val
        # Backward compatibility: old field stored corrected mass when applied.
        legacy = _to_float(record.get("mH2InjectedG") or record.get("h2MassG"))
        if legacy is not None:
            return legacy
        return _h2_mass_est_g(record)

    safe_records = records if isinstance(records, list) else []
    rows = []
    for item in safe_records:
        if not isinstance(item, dict):
            continue
        group = str(item.get("group") or "").strip()
        run_name = str(item.get("runName") or "").strip()
        raw_updated = str(item.get("updatedAt") or "").strip()
        updated_short = _iso_to_display_str(raw_updated, include_seconds=True)
        calibration_applied = str(item.get("calibrationApplied") or "")
        correction_applied = _is_yes(calibration_applied)
        h2_mass_corr = _fmt(_h2_mass_corr_g(item), 3)
        calibration_basis = str(item.get("calibrationTargetBasis") or "")
        rows.append({
            "group": group,
            "run_name": run_name,
            "run_short": _short_run_name(group, run_name),
            "target_vol": _fmt(item.get("targetVol"), 2),
            "relative_humidity_pct": _fmt(item.get("relativeHumidityPct"), 1),
            "p_chamber_pa": _fmt(item.get("pChamberPa") or item.get("P_chamber_Pa") or item.get("ambPressure"), 0),
            "t_chamber_c": _fmt(_t_chamber_c(item), 2),
            "t_chamber_k": _fmt(item.get("tChamberK"), 2),
            "l_m": _fmt(item.get("lM"), 3),
            "w_m": _fmt(item.get("wM"), 3),
            "h_m": _fmt(item.get("hM"), 3),
            "vol_pipes_m3": _fmt(item.get("volPipesM3"), 3),
            "hotwire_assembly_m3": _fmt(item.get("hotwireAssemblyM3"), 3),
            "welded_parts_m3": _fmt(item.get("weldedPartsM3"), 3),
            "bolts_m3": _fmt(item.get("boltsM3"), 3),
            "v_chamber_corr_l": _fmt(_chamber_l(item), 2),
            "h2_mass_est_g": _fmt(_h2_mass_est_g(item), 3),
            "h2_mass_corr_g": h2_mass_corr,
            "h2_mass_corr_display": h2_mass_corr if correction_applied else "Not corrected by model",
            "h2_mass_corr_pdf": h2_mass_corr if correction_applied else "No model",
            "v_h2_inj_l": _fmt(_h2_inj_l(item), 2),
            "mfc_flow_slpm": _fmt(item.get("mfcFlowSlpm"), 2),
            "injection_time_s": _fmt(item.get("injectionTimeS"), 1),
            "injection_time_min": _fmt(item.get("injectionTimeMin"), 1),
            "calibration_model_type": str(item.get("calibrationModelType") or ""),
            "calibration_target_basis": calibration_basis,
            "calibration_target_basis_short": "frac" if calibration_basis == "fraction_0_1" else ("pct" if calibration_basis == "percent" else calibration_basis),
            "calibration_enabled": str(item.get("calibrationEnabled") or ""),
            "calibration_applied": calibration_applied,
            "calibration_a": str(item.get("calibrationA") or ""),
            "calibration_b": str(item.get("calibrationB") or ""),
            "calibration_notes": str(item.get("calibrationNotes") or ""),
            "notes": str(item.get("notes") or "").strip(),
            "updated_at": updated_short,
        })

    rows.sort(key=lambda row: (
        str(row.get("group") or "").lower(),
        _parse_run_name_order(row.get("run_name"))[1],
        _parse_run_name_order(row.get("run_name"))[2],
        str(row.get("run_name") or "").lower(),
    ))
    return rows


def _gas_mixing_shared_setup(rows):
    """Detect shared chamber geometry/correction settings across exported rows."""
    setup_fields = [
        ("L (m)", "l_m"),
        ("W (m)", "w_m"),
        ("H (m)", "h_m"),
        ("Pipes + (m^3)", "vol_pipes_m3"),
        ("Hotwire + (m^3)", "hotwire_assembly_m3"),
        ("Welded - (m^3)", "welded_parts_m3"),
        ("Bolts - (m^3)", "bolts_m3"),
        ("Vchamber Corrected (L)", "v_chamber_corr_l"),
    ]
    summary = {}
    varies = False
    for label, key in setup_fields:
        values = [
            str((row or {}).get(key) or "").strip()
            for row in (rows or [])
            if isinstance(row, dict)
        ]
        non_empty = [value for value in values if value]
        if not non_empty:
            summary[label] = "-"
            continue
        first = non_empty[0]
        if all(value == first for value in non_empty):
            summary[label] = first
        else:
            summary[label] = "VARIES"
            varies = True
    return summary, varies


def _write_gas_mixing_csv(rows, target_path, project_name=None, verification_meta=None):
    verification = _normalize_gas_verification_meta(verification_meta)
    shared_setup, shared_varies = _gas_mixing_shared_setup(rows)

    headers = [
        "Group",
        "Run/Test",
        "Target H2 (%vol)",
        "Relative Humidity (%RH)",
        "Pchamber (Pa)",
        "Tchamber (°C)",
        "Tchamber (K)",
        "H2 Injected Estimated (g)",
        "H2 Injected Corrected (g)",
        "H2 Injected Volume (L)",
        "MFC Flow (SLPM)",
        "Fill Time (s)",
        "Fill Time (min)",
        "Calibration Model Type",
        "Calibration Target Basis",
        "Calibration Enabled",
        "Calibration Applied",
        "Calibration a",
        "Calibration b",
        "Calibration Notes",
        "Notes",
        "Updated At",
    ]
    if shared_varies:
        headers = [
            "Group",
            "Run/Test",
            "Target H2 (%vol)",
            "Relative Humidity (%RH)",
            "Pchamber (Pa)",
            "Tchamber (°C)",
            "Tchamber (K)",
            "L (m)",
            "W (m)",
            "H (m)",
            "Pipes + (m^3)",
            "Hotwire + (m^3)",
            "Welded - (m^3)",
            "Bolts - (m^3)",
            "Vchamber Corrected (L)",
            "H2 Injected Estimated (g)",
            "H2 Injected Corrected (g)",
            "H2 Injected Volume (L)",
            "MFC Flow (SLPM)",
            "Fill Time (s)",
            "Fill Time (min)",
            "Calibration Model Type",
            "Calibration Target Basis",
            "Calibration Enabled",
            "Calibration Applied",
            "Calibration a",
            "Calibration b",
            "Calibration Notes",
            "Notes",
            "Updated At",
        ]
    with open(target_path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Export Type", "Gas Mixing"])
        writer.writerow(["Project", str(project_name or "-")])
        writer.writerow(["Responsible Researcher", "PhD Student Javier I. Camacho"])
        writer.writerow(["Total Records", str(len(rows))])
        writer.writerow(["Generated At", _now_display_str(include_seconds=True)])
        writer.writerow(["MATLAB Verified", "Yes" if verification.get("isMatlabVerified") else "No"])
        writer.writerow(["Verification Reference File A", str(verification.get("verificationRefFileA") or "-")])
        writer.writerow(["Verification Reference File B", str(verification.get("verificationRefFileB") or "-")])
        writer.writerow([])
        writer.writerow(["Shared Chamber Setup", "Applies to all runs unless noted otherwise"])
        for label, value in shared_setup.items():
            writer.writerow([label, value])
        if shared_varies:
            writer.writerow(["Setup Note", "One or more chamber setup values vary between runs. Per-run setup columns are included below."])
        writer.writerow([])
        writer.writerow(headers)
        for row in rows:
            if shared_varies:
                writer.writerow([
                    row["group"],
                    row["run_short"] or row["run_name"],
                    row["target_vol"],
                    row["relative_humidity_pct"],
                    row["p_chamber_pa"],
                    row["t_chamber_c"],
                    row["t_chamber_k"],
                    row["l_m"],
                    row["w_m"],
                    row["h_m"],
                    row["vol_pipes_m3"],
                    row["hotwire_assembly_m3"],
                    row["welded_parts_m3"],
                    row["bolts_m3"],
                    row["v_chamber_corr_l"],
                    row["h2_mass_est_g"],
                    row["h2_mass_corr_display"],
                    row["v_h2_inj_l"],
                    row["mfc_flow_slpm"],
                    row["injection_time_s"],
                    row["injection_time_min"],
                    row["calibration_model_type"],
                    row["calibration_target_basis"],
                    row["calibration_enabled"],
                    row["calibration_applied"],
                    row["calibration_a"],
                    row["calibration_b"],
                    row["calibration_notes"],
                    row["notes"],
                    row["updated_at"],
                ])
            else:
                writer.writerow([
                    row["group"],
                    row["run_short"] or row["run_name"],
                    row["target_vol"],
                    row["relative_humidity_pct"],
                    row["p_chamber_pa"],
                    row["t_chamber_c"],
                    row["t_chamber_k"],
                    row["h2_mass_est_g"],
                    row["h2_mass_corr_display"],
                    row["v_h2_inj_l"],
                    row["mfc_flow_slpm"],
                    row["injection_time_s"],
                    row["injection_time_min"],
                    row["calibration_model_type"],
                    row["calibration_target_basis"],
                    row["calibration_enabled"],
                    row["calibration_applied"],
                    row["calibration_a"],
                    row["calibration_b"],
                    row["calibration_notes"],
                    row["notes"],
                    row["updated_at"],
                ])


def _write_gas_mixing_pdf(project_name, rows, target_path, verification_meta=None):
    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        return False, f"PyMuPDF unavailable: {exc}"

    def _clip(value, width):
        text = str(value or "")
        if len(text) <= width:
            return text.ljust(width)
        if width <= 1:
            return text[:width]
        return (text[: width - 1] + "…")

    def _wrap(value, width):
        text = str(value or "").strip()
        if not text:
            return ["-"]
        return textwrap.wrap(text, width=width, break_long_words=False, break_on_hyphens=False) or ["-"]

    doc = fitz.open()
    page = doc.new_page(width=842, height=595)  # A4 landscape
    x0 = 24
    top_content_y = 92
    y = top_content_y
    line_h = 12
    logo_paths = _resolve_pdf_logos()

    def _draw_logo(page_obj):
        try:
            university_logo = logo_paths.get("university")
            if university_logo:
                page_obj.insert_image(
                    fitz.Rect(500, 16, 660, 76),
                    filename=university_logo,
                    keep_proportion=True,
                    overlay=True,
                )
            institute_logo = logo_paths.get("institute")
            if institute_logo:
                page_obj.insert_image(
                    fitz.Rect(668, 16, 818, 76),
                    filename=institute_logo,
                    keep_proportion=True,
                    overlay=True,
                )
        except Exception:
            return

    _draw_logo(page)

    def _write_line(text, bold=False):
        nonlocal page, y
        if y > 570:
            page = doc.new_page(width=842, height=595)
            y = top_content_y
            _draw_logo(page)
        page.insert_text((x0, y), text, fontname="courier-bold" if bold else "courier", fontsize=8.5, color=(0, 0, 0))
        y += line_h

    page.insert_text((x0, y), "EXDA Gas Mixing Export", fontname="courier-bold", fontsize=18, color=(0, 0, 0))
    y += 22
    _write_line(f"Project: {str(project_name or '-')}")
    _write_line("Responsible Researcher: PhD Student Javier I. Camacho")
    _write_line(f"Total Records: {len(rows)}")
    verification = _normalize_gas_verification_meta(verification_meta)
    _write_line(f"Generated: {_now_display_str(include_seconds=True)}")
    _write_line(f"MATLAB Verified: {'Yes' if verification.get('isMatlabVerified') else 'No'}")
    _write_line(f"Verification File A: {str(verification.get('verificationRefFileA') or '-')}")
    _write_line(f"Verification File B: {str(verification.get('verificationRefFileB') or '-')}")
    _write_line("")

    shared_setup, shared_varies = _gas_mixing_shared_setup(rows)
    def _pdf_value_is_not_zero(value):
        text = str(value or "").strip()
        if not text or text == "-":
            return False
        if text == "VARIES":
            return True
        numeric = _to_float(text)
        return numeric is None or abs(numeric) > 1e-12

    show_hotwire_setup = any(_pdf_value_is_not_zero(row.get("hotwire_assembly_m3")) for row in rows)
    show_welded_setup = any(_pdf_value_is_not_zero(row.get("welded_parts_m3")) for row in rows)
    show_bolts_setup = any(_pdf_value_is_not_zero(row.get("bolts_m3")) for row in rows)

    _write_line("Shared Chamber Setup (applies to all runs unless noted otherwise):", bold=True)
    setup_parts = [
        f"L={shared_setup.get('L (m)', '-')} m",
        f"W={shared_setup.get('W (m)', '-')} m",
        f"H={shared_setup.get('H (m)', '-')} m",
        f"Pipes+={shared_setup.get('Pipes + (m^3)', '-')} m^3",
    ]
    if show_hotwire_setup:
        setup_parts.append(f"Hotwire+={shared_setup.get('Hotwire + (m^3)', '-')} m^3")
    if show_welded_setup:
        setup_parts.append(f"Welded-={shared_setup.get('Welded - (m^3)', '-')} m^3")
    if show_bolts_setup:
        setup_parts.append(f"Bolts-={shared_setup.get('Bolts - (m^3)', '-')} m^3")
    setup_parts.append(f"Vcorr={shared_setup.get('Vchamber Corrected (L)', '-')} L")
    _write_line(", ".join(setup_parts))
    if shared_varies:
        _write_line("Note: setup values vary across runs; detailed per-run setup table is included below.")
    _write_line("")

    core_columns = [
        ("Group", 12),
        ("Run/Test", 17),
        ("H2%", 5),
        ("Tch(C)", 7),
        ("H2est(g)", 8),
        ("H2corr(g)", 9),
        ("H2inj(L)", 8),
        ("MFC", 6),
        ("t(min)", 6),
        ("Basis", 5),
        ("a", 8),
        ("b", 8),
        ("Updated", 16),
    ]
    setup_columns = [
        ("Group", 10),
        ("Run/Test", 14),
        ("L (m)", 5),
        ("W (m)", 5),
        ("H (m)", 5),
        ("Pipes+ (m3)", 11),
    ]
    if show_hotwire_setup:
        setup_columns.append(("Hotwire+ (m3)", 13))
    if show_welded_setup:
        setup_columns.append(("Welded- (m3)", 12))
    if show_bolts_setup:
        setup_columns.append(("Bolts- (m3)", 11))
    setup_columns.extend([
        ("Vcorr(L)", 8),
        ("Notes", 28),
    ])

    def _setup_row_values(row):
        values = [
            row.get("group"),
            row.get("run_name"),
            row.get("l_m"),
            row.get("w_m"),
            row.get("h_m"),
            row.get("vol_pipes_m3"),
        ]
        if show_hotwire_setup:
            values.append(row.get("hotwire_assembly_m3"))
        if show_welded_setup:
            values.append(row.get("welded_parts_m3"))
        if show_bolts_setup:
            values.append(row.get("bolts_m3"))
        values.extend([
            row.get("v_chamber_corr_l"),
            row.get("notes"),
        ])
        return values

    def _write_table(title, columns, row_builder):
        _write_line(title, bold=True)
        divider = "-+-".join("-" * width for _, width in columns)
        header = " | ".join(_clip(name, width) for name, width in columns)
        _write_line(header, bold=True)
        _write_line(divider)
        for row in rows:
            row_values = row_builder(row)
            wrapped_cells = [_wrap(value, width) for value, (_, width) in zip(row_values, columns)]
            row_lines = max(len(lines) for lines in wrapped_cells) if wrapped_cells else 1
            for idx in range(row_lines):
                line = " | ".join(
                    _clip((wrapped_cells[col_idx][idx] if idx < len(wrapped_cells[col_idx]) else ""), columns[col_idx][1])
                    for col_idx in range(len(columns))
                )
                _write_line(line)
        _write_line("")

    _write_table(
        "Core Gas Mixing Results",
        core_columns,
        lambda row: [
            row.get("group"),
            row.get("run_name"),
            row.get("target_vol"),
            row.get("t_chamber_c"),
            row.get("h2_mass_est_g"),
            row.get("h2_mass_corr_pdf"),
            row.get("v_h2_inj_l"),
            row.get("mfc_flow_slpm"),
            row.get("injection_time_min"),
            row.get("calibration_target_basis_short"),
            row.get("calibration_a"),
            row.get("calibration_b"),
            row.get("updated_at"),
        ],
    )

    if shared_varies:
        _write_table(
            "Per-Run Chamber Setup (because values vary)",
            setup_columns,
            _setup_row_values,
        )

    total_pages = len(doc)
    for page_index, page_obj in enumerate(doc, start=1):
        footer_text = f"Page {page_index}/{total_pages}"
        page_obj.insert_text(
            (770, 582),
            footer_text,
            fontname="courier",
            fontsize=8,
            color=(0.25, 0.25, 0.25),
        )

    doc.save(target_path, deflate=True, garbage=4)
    doc.close()
    return True, target_path


@state_bp.route('/get_project_state', methods=['GET'])
def get_project_state():
    """Return the latest plan and indexed raw/simulation files for a project."""
    project_path = request.args.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err})

    plan_data = None
    plan_dir = os.path.join(project_root, "Plan")
    if os.path.exists(plan_dir):
        plan_candidates = [
            os.path.join(plan_dir, f)
            for f in os.listdir(plan_dir)
            if f.endswith('.json') and f != project_manager.STATUS_FILENAME
        ]

        # Prefer files that look like actual experiment plans (contain an experiments array).
        valid_plan_files = []
        for candidate_path in plan_candidates:
            try:
                with open(candidate_path, 'r', encoding='utf-8') as handle:
                    payload = json.load(handle)
                if isinstance(payload, dict) and isinstance(payload.get("experiments"), list):
                    valid_plan_files.append(candidate_path)
            except Exception:
                continue

        if valid_plan_files:
            latest_plan_path = max(valid_plan_files, key=os.path.getmtime)
            try:
                with open(latest_plan_path, 'r', encoding='utf-8') as handle:
                    plan_data = json.load(handle)
            except Exception as e:
                print(f"Error loading plan: {e}")

    data_files = []
    sim_files = []
    data_dir = os.path.join(project_root, "Raw_Data")

    if os.path.exists(data_dir):
        for root, dirs, files in os.walk(data_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if f.startswith('.'):
                    continue
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, data_dir)

                file_info = {"name": f, "path": full_path, "rel": rel_path}

                if f.lower().endswith(ALLOWED_DATA_EXTENSIONS):
                    data_files.append(file_info)
                if f in ['p', 'p_rgh'] or 'vol' in f:
                    sim_files.append(file_info)

    project_status = project_manager.read_project_status(project_root) or project_manager.ensure_project_status(project_root)
    checklist_state = {}
    checklist_path = os.path.join(project_root, "Reports", CHECKLIST_STATE_FILENAME)
    if os.path.exists(checklist_path):
        try:
            with open(checklist_path, "r", encoding="utf-8") as handle:
                checklist_payload = json.load(handle)
            if isinstance(checklist_payload, dict) and isinstance(checklist_payload.get("checklistState"), dict):
                checklist_state = checklist_payload.get("checklistState") or {}
        except Exception:
            checklist_state = {}

    return jsonify({
        "success": True,
        "plan": plan_data,
        "project_status": project_status,
        "checklist_state": checklist_state,
        "data_files": data_files,
        "sim_files": sim_files
    })


@state_bp.route('/read_project_file', methods=['GET'])
def read_project_file():
    """Safely read a project-scoped file and return its text content."""
    project_path = request.args.get('projectPath')
    file_path = request.args.get('path')
    full_resolution = str(request.args.get('fullResolution', '')).strip().lower() in ("1", "true", "yes", "on")
    requested_max_points = request.args.get('maxPoints')
    window_start = _to_float(request.args.get('windowStart'))
    window_end = _to_float(request.args.get('windowEnd'))
    try:
        requested_max_points = int(float(requested_max_points)) if requested_max_points is not None else None
    except (TypeError, ValueError):
        requested_max_points = None
    if requested_max_points is not None:
        requested_max_points = max(100, min(2_000_000, requested_max_points))

    # One-step downsampling target:
    # - Full-resolution: disabled (0 => no cap)
    # - Fast preview: downsample once at read stage to maxPoints
    # Hidden hard cap remains as an emergency guard for malformed/huge requests.
    safety_cap = 2_000_000
    if full_resolution:
        max_samples = 0
    else:
        effective_target = requested_max_points if requested_max_points is not None else 200000
        max_samples = max(100, min(safety_cap, int(effective_target)))

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400
    if not file_path:
        return jsonify({"success": False, "error": "File path is required"}), 400
    target = file_path if os.path.isabs(file_path) else os.path.join(project_root, file_path)
    if not project_manager.is_path_within(project_root, target):
        return jsonify({"success": False, "error": "File path not allowed"}), 403
    if not os.path.exists(target):
        return jsonify({"success": False, "error": "File not found"}), 404
    try:
        lower_target = target.lower()
        if lower_target.endswith(".mf4"):
            content, parse_err = mf4_parser.mf4_to_content(
                target,
                max_samples=max_samples,
                time_start=window_start,
                time_end=window_end,
            )
            if parse_err:
                return jsonify({"success": False, "error": parse_err}), 400
            return jsonify({"success": True, "content": content})
        if lower_target.endswith(".tpc5"):
            content, parse_err = tpc5_parser.tpc5_to_content(
                target,
                max_samples=max_samples,
                time_start=window_start,
                time_end=window_end,
            )
            if parse_err:
                return jsonify({"success": False, "error": parse_err}), 400
            return jsonify({"success": True, "content": content})
        with open(target, 'r', encoding='utf-8') as f:
            content = f.read()
        content_windowed, parse_err = _apply_time_window_to_text_content(
            content,
            time_start=window_start,
            time_end=window_end,
            max_samples=max_samples,
        )
        if parse_err:
            return jsonify({"success": False, "error": parse_err}), 400
        return jsonify({"success": True, "content": content_windowed})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@state_bp.route('/inspect_project_file_structure', methods=['GET'])
def inspect_project_file_structure():
    """Inspect parser-level data structure for a project-scoped data file."""
    project_path = request.args.get('projectPath')
    file_path = request.args.get('path')
    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400
    if not file_path:
        return jsonify({"success": False, "error": "File path is required"}), 400

    target = file_path if os.path.isabs(file_path) else os.path.join(project_root, file_path)
    if not project_manager.is_path_within(project_root, target):
        return jsonify({"success": False, "error": "File path not allowed"}), 403
    if not os.path.exists(target):
        return jsonify({"success": False, "error": "File not found"}), 404

    ext = os.path.splitext(target)[1].lower()
    base = {
        "fileName": os.path.basename(target),
        "relativePath": _to_posix_rel_path(project_root, target),
        "extension": ext,
        "sizeBytes": int(os.path.getsize(target)),
        "inspectedAt": _now_display_str(include_seconds=True),
    }

    try:
        if ext == ".mf4":
            details, parse_err = _inspect_mf4_file_structure(target)
        elif ext == ".tpc5":
            details, parse_err = _inspect_tpc5_file_structure(target)
        elif ext in (".csv", ".txt", ".dat", ".asc", ".ascii"):
            details, parse_err = _inspect_text_file_structure(target)
        else:
            return jsonify({"success": False, "error": f"Unsupported file type for structure inspection: {ext}"}), 400

        if parse_err:
            return jsonify({"success": False, "error": parse_err}), 400

        return jsonify(
            {
                "success": True,
                "inspection": {
                    **base,
                    **(details or {}),
                },
            }
        )
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/project_artifact_file', methods=['GET'])
def project_artifact_file():
    """Serve a project-scoped artifact file for inline preview or download."""
    project_path = request.args.get("projectPath")
    file_path = request.args.get("path")
    as_download = str(request.args.get("download", "")).strip().lower() in ("1", "true", "yes", "on")

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400
    if not file_path:
        return jsonify({"success": False, "error": "File path is required"}), 400

    target = file_path if os.path.isabs(file_path) else os.path.join(project_root, file_path)
    if not project_manager.is_path_within(project_root, target):
        return jsonify({"success": False, "error": "File path not allowed"}), 403
    if not os.path.exists(target):
        return jsonify({"success": False, "error": "File not found"}), 404

    mime_type, _ = mimetypes.guess_type(target)
    return send_file(
        target,
        as_attachment=as_download,
        download_name=os.path.basename(target),
        mimetype=mime_type or "application/octet-stream",
        conditional=True,
    )


@state_bp.route('/latest_report_artifact', methods=['GET'])
def latest_report_artifact():
    """Return latest report artifact path for a given kind/format."""
    project_path = request.args.get("projectPath")
    kind = str(request.args.get("kind") or "").strip().lower()
    fmt = str(request.args.get("format") or "").strip().lower()

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400
    if not kind or not fmt:
        return jsonify({"success": False, "error": "Both kind and format are required"}), 400

    reports_dir = os.path.join(project_root, "Reports")
    if not os.path.isdir(reports_dir):
        return jsonify({"success": True, "found": False})

    project_name = os.path.basename(project_root.rstrip("/\\"))
    prefix_map = {
        "metadata": f"{project_name}_Metadata_Report_",
        "daq": f"{project_name}_DAQ_Systems_",
        "sensors": f"{project_name}_Sensors_Mapping_",
        "gas": f"{project_name}_Gas_Mixing_",
    }
    prefix = prefix_map.get(kind)
    if not prefix:
        return jsonify({"success": False, "error": f"Unsupported report kind: {kind}"}), 400

    extension = ".pdf" if fmt == "pdf" else ".csv" if fmt == "csv" else None
    if not extension:
        return jsonify({"success": False, "error": f"Unsupported report format: {fmt}"}), 400

    candidates = []
    try:
        for entry in os.listdir(reports_dir):
            if not entry.startswith(prefix) or not entry.lower().endswith(extension):
                continue
            candidate_path = os.path.join(reports_dir, entry)
            if os.path.isfile(candidate_path):
                candidates.append(candidate_path)
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500

    if not candidates:
        return jsonify({"success": True, "found": False})

    latest_path = max(candidates, key=lambda p: os.path.getmtime(p))
    relative_path = _to_posix_rel_path(project_root, latest_path)
    return jsonify({
        "success": True,
        "found": True,
        "path": latest_path,
        "relativePath": relative_path,
        "filename": os.path.basename(latest_path),
    })


@state_bp.route('/select_data_folder', methods=['POST'])
def select_data_folder():
    """Open a folder picker rooted in the project's Raw_Data directory."""
    try:
        data = request.json
        project_path = data.get('projectPath')
        if not project_path:
            return jsonify({"success": False, "error": "No project path provided"}), 400

        initial_dir = os.path.join(project_path, "Raw_Data")
        path = project_manager.select_folder_dialog(initial_dir=initial_dir)

        if path:
            return jsonify({"success": True, "path": path})
        return jsonify({"success": False, "message": "Selection cancelled"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@state_bp.route('/list_raw_data', methods=['GET'])
def list_raw_data():
    """List all non-hidden files under a project's Raw_Data directory."""
    project_path = request.args.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err})
    data_dir = os.path.join(project_root, "Raw_Data")
    if not os.path.exists(data_dir):
        return jsonify({"success": True, "files": []})
    files_found = []
    for root, dirs, files in os.walk(data_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for f in files:
            if not f.startswith('.'):
                rel_path = os.path.relpath(os.path.join(root, f), data_dir)
                files_found.append(rel_path)
    return jsonify({"success": True, "files": sorted(files_found)})


@state_bp.route('/list_plan_files', methods=['GET'])
def list_plan_files():
    """List available JSON plan files for a project."""
    project_path = request.args.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400
    plan_dir = os.path.join(project_root, "Plan")
    if not os.path.exists(plan_dir):
        return jsonify({"success": True, "files": []})
    if not os.path.isdir(plan_dir):
        return jsonify({"success": False, "error": "Plan path is not a directory"}), 400
    files = []
    for name in os.listdir(plan_dir):
        if name.startswith('.'):
            continue
        if not name.lower().endswith('.json'):
            continue
        if name == project_manager.STATUS_FILENAME:
            continue
        full = os.path.join(plan_dir, name)
        if not os.path.isfile(full):
            continue
        try:
            modified = datetime.fromtimestamp(os.path.getmtime(full)).strftime('%Y-%m-%d %H:%M')
        except Exception:
            modified = None
        files.append({"name": name, "path": full, "modified": modified})
    files.sort(key=lambda f: f.get("modified") or "", reverse=True)
    return jsonify({"success": True, "files": files})


@state_bp.route('/load_plan_dialog', methods=['POST'])
def load_plan_dialog():
    """Open a file picker and load a selected plan JSON into memory."""
    data = request.json or {}
    project_path = data.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    plan_dir = os.path.join(project_root, "Plan")
    start_dir = plan_dir if os.path.isdir(plan_dir) else project_root
    file_path = project_manager.select_file_dialog(start_dir)

    fallback_used = False
    allow_fallback = bool(data.get('allowFallback'))
    if not file_path and allow_fallback:
        # Fallback: load the most recent plan file from the Plan folder
        if os.path.isdir(plan_dir):
            candidates = [
                os.path.join(plan_dir, f)
                for f in os.listdir(plan_dir)
                if f.lower().endswith(".json") and not f.startswith(".") and f != project_manager.STATUS_FILENAME
            ]
            if candidates:
                file_path = max(candidates, key=lambda p: os.path.getmtime(p))
                fallback_used = True
            else:
                return jsonify({"success": False, "error": "No plan files found in Plan folder"})
        else:
            return jsonify({"success": False, "error": "Selection cancelled"})
    elif not file_path:
        return jsonify({"success": False, "error": "Selection cancelled"})
    if not os.path.exists(file_path):
        return jsonify({"success": False, "error": "File not found"}), 404
    if not project_manager.is_path_within(project_root, file_path):
        return jsonify({"success": False, "error": "File path not allowed"}), 403

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = json.load(f)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    return jsonify({
        "success": True,
        "data": content,
        "filename": os.path.basename(file_path),
        "fallback": bool(fallback_used)
    })


@state_bp.route('/save_plan', methods=['POST'])
def save_plan():
    """Persist a plan file in the project's Plan directory."""
    data = request.json
    success, result = project_manager.save_plan_to_project(
        data.get('projectPath'), data.get('filename'), data.get('content')
    )
    return jsonify({"success": success, "path": result})


@state_bp.route('/get_daq_systems', methods=['GET'])
def get_daq_systems():
    """Load DAQ systems metadata for a project."""
    project_path = request.args.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_path = os.path.join(project_root, "Reports", DAQ_SYSTEMS_FILENAME)
    plan_path = os.path.join(project_root, "Plan", DAQ_SYSTEMS_FILENAME)
    file_path = _resolve_existing_metadata_file(project_root, DAQ_SYSTEMS_FILENAME)

    if not os.path.exists(file_path):
        return jsonify({"success": True, "daqSystems": [], "path": file_path})

    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, dict):
            daq_systems = payload.get("daqSystems")
        else:
            daq_systems = payload
        if not isinstance(daq_systems, list):
            daq_systems = []

        migrated = False
        # One-time migration: if data is still in Plan, copy it into Reports for consistency.
        if os.path.exists(plan_path) and file_path == plan_path and not os.path.exists(reports_path):
            try:
                os.makedirs(os.path.dirname(reports_path), exist_ok=True)
                with open(reports_path, "w", encoding="utf-8") as out_handle:
                    json.dump({
                        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "daqSystems": daq_systems,
                    }, out_handle, indent=2)
                file_path = reports_path
                migrated = True
            except Exception:
                migrated = False

        return jsonify({"success": True, "daqSystems": daq_systems, "path": file_path, "migratedToReports": migrated})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/save_daq_systems', methods=['POST'])
def save_daq_systems():
    """Persist DAQ systems metadata in Reports/daq_systems.json."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    daq_systems = payload.get("daqSystems")
    if not isinstance(daq_systems, list):
        return jsonify({"success": False, "error": "daqSystems must be a list"}), 400

    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)
    file_path = os.path.join(reports_dir, DAQ_SYSTEMS_FILENAME)
    if not project_manager.is_path_within(reports_dir, file_path):
        return jsonify({"success": False, "error": "Invalid DAQ systems path"}), 400

    try:
        data = {
            "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "daqSystems": daq_systems,
        }
        with open(file_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
        return jsonify({"success": True, "path": file_path, "count": len(daq_systems)})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/save_sensors_mapping', methods=['POST'])
def save_sensors_mapping():
    """Persist sensors mapping metadata in Reports/sensors_mapping.json."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    mappings_by_group = payload.get("mappingsByGroup")
    group_notes = payload.get("groupNotes") if isinstance(payload.get("groupNotes"), dict) else {}
    selected_group = str(payload.get("selectedGroup") or "").strip()

    if not isinstance(mappings_by_group, dict):
        return jsonify({"success": False, "error": "mappingsByGroup must be an object"}), 400

    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)
    file_path = os.path.join(reports_dir, SENSORS_MAPPING_FILENAME)
    if not project_manager.is_path_within(reports_dir, file_path):
        return jsonify({"success": False, "error": "Invalid sensors mapping path"}), 400

    safe_groups = {}
    for key, value in mappings_by_group.items():
        group_name = str(key or "").strip()
        if not group_name:
            continue
        if isinstance(value, list):
            sanitized_group = []
            for item in value:
                record = item if isinstance(item, dict) else {}
                sanitized_record = dict(record)
                sanitized_record["mountingMethod"] = _normalize_mounting_label(record.get("mountingMethod"))
                sanitized_record["triggerMethod"] = _normalize_trigger_method_label(record.get("triggerMethod"))
                sanitized_group.append(sanitized_record)
            safe_groups[group_name] = sanitized_group
        else:
            safe_groups[group_name] = []

    safe_notes = {}
    for key, value in group_notes.items():
        group_name = str(key or "").strip()
        if not group_name:
            continue
        safe_notes[group_name] = str(value or "")

    total_sensors = sum(len(items) for items in safe_groups.values() if isinstance(items, list))
    try:
        data = {
            "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "selectedGroup": selected_group,
            "groupNotes": safe_notes,
            "mappingsByGroup": safe_groups,
        }
        with open(file_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
        return jsonify({
            "success": True,
            "path": file_path,
            "groupCount": len(safe_groups),
            "sensorCount": total_sensors,
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/get_sensors_mapping', methods=['GET'])
def get_sensors_mapping():
    """Load sensors mapping metadata for a project."""
    project_path = request.args.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_path = os.path.join(project_root, "Reports", SENSORS_MAPPING_FILENAME)
    file_path = _resolve_existing_metadata_file(project_root, SENSORS_MAPPING_FILENAME)

    if not os.path.exists(file_path):
        return jsonify({
            "success": True,
            "path": reports_path,
            "selectedGroup": "",
            "groupNotes": {},
            "mappingsByGroup": {},
        })

    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            payload = {}
        mappings_by_group = payload.get("mappingsByGroup") if isinstance(payload.get("mappingsByGroup"), dict) else {}
        group_notes = payload.get("groupNotes") if isinstance(payload.get("groupNotes"), dict) else {}
        selected_group = str(payload.get("selectedGroup") or "").strip()
        return jsonify({
            "success": True,
            "path": file_path,
            "selectedGroup": selected_group,
            "groupNotes": group_notes,
            "mappingsByGroup": mappings_by_group,
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/save_cameras_mapping', methods=['POST'])
def save_cameras_mapping():
    """Persist cameras mapping metadata in Reports/cameras_mapping.json."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    mappings_by_group = payload.get("mappingsByGroup")
    group_notes = payload.get("groupNotes") if isinstance(payload.get("groupNotes"), dict) else {}
    selected_group = str(payload.get("selectedGroup") or "").strip()

    if not isinstance(mappings_by_group, dict):
        return jsonify({"success": False, "error": "mappingsByGroup must be an object"}), 400

    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)
    file_path = os.path.join(reports_dir, CAMERAS_MAPPING_FILENAME)
    if not project_manager.is_path_within(reports_dir, file_path):
        return jsonify({"success": False, "error": "Invalid cameras mapping path"}), 400

    safe_groups = {}
    for key, value in mappings_by_group.items():
        group_name = str(key or "").strip()
        if not group_name:
            continue
        if isinstance(value, list):
            safe_groups[group_name] = [dict(item) if isinstance(item, dict) else {} for item in value]
        else:
            safe_groups[group_name] = []

    safe_notes = {}
    for key, value in group_notes.items():
        group_name = str(key or "").strip()
        if not group_name:
            continue
        safe_notes[group_name] = str(value or "")

    total_cameras = sum(len(items) for items in safe_groups.values() if isinstance(items, list))
    try:
        data = {
            "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "selectedGroup": selected_group,
            "groupNotes": safe_notes,
            "mappingsByGroup": safe_groups,
        }
        with open(file_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
        return jsonify({
            "success": True,
            "path": file_path,
            "groupCount": len(safe_groups),
            "cameraCount": total_cameras,
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/get_cameras_mapping', methods=['GET'])
def get_cameras_mapping():
    """Load cameras mapping metadata for a project."""
    project_path = request.args.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_path = os.path.join(project_root, "Reports", CAMERAS_MAPPING_FILENAME)
    file_path = _resolve_existing_metadata_file(project_root, CAMERAS_MAPPING_FILENAME)

    if not os.path.exists(file_path):
        return jsonify({
            "success": True,
            "path": reports_path,
            "selectedGroup": "",
            "groupNotes": {},
            "mappingsByGroup": {},
        })

    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            payload = {}
        mappings_by_group = payload.get("mappingsByGroup") if isinstance(payload.get("mappingsByGroup"), dict) else {}
        group_notes = payload.get("groupNotes") if isinstance(payload.get("groupNotes"), dict) else {}
        selected_group = str(payload.get("selectedGroup") or "").strip()
        return jsonify({
            "success": True,
            "path": file_path,
            "selectedGroup": selected_group,
            "groupNotes": group_notes,
            "mappingsByGroup": mappings_by_group,
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/get_gas_mixing', methods=['GET'])
def get_gas_mixing():
    """Load gas mixing metadata for a project."""
    project_path = request.args.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_path = os.path.join(project_root, "Reports", GAS_MIXING_FILENAME)
    plan_path = os.path.join(project_root, "Plan", GAS_MIXING_FILENAME)
    file_path = _resolve_existing_metadata_file(project_root, GAS_MIXING_FILENAME)

    if not os.path.exists(file_path):
        return jsonify({
            "success": True,
            "path": reports_path,
            "verificationMeta": _normalize_gas_verification_meta({}),
            "dosageModel": _normalize_gas_dosage_model({}),
            "selectedGroup": "",
            "selectedRunName": "",
            "records": [],
        })

    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        records = payload.get("records") if isinstance(payload, dict) else []
        if not isinstance(records, list):
            records = []
        verification_meta = _normalize_gas_verification_meta((payload or {}).get("verificationMeta"))
        dosage_model = _normalize_gas_dosage_model((payload or {}).get("dosageModel"))
        selected_group = str((payload or {}).get("selectedGroup") or "").strip() if isinstance(payload, dict) else ""
        selected_run_name = str((payload or {}).get("selectedRunName") or "").strip() if isinstance(payload, dict) else ""

        migrated = False
        if os.path.exists(plan_path) and file_path == plan_path and not os.path.exists(reports_path):
            try:
                os.makedirs(os.path.dirname(reports_path), exist_ok=True)
                with open(reports_path, "w", encoding="utf-8") as out_handle:
                    json.dump({
                        "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "verificationMeta": verification_meta,
                        "dosageModel": dosage_model,
                        "selectedGroup": selected_group,
                        "selectedRunName": selected_run_name,
                        "records": records,
                    }, out_handle, indent=2)
                file_path = reports_path
                migrated = True
            except Exception:
                migrated = False

        return jsonify({
            "success": True,
            "path": file_path,
            "verificationMeta": verification_meta,
            "dosageModel": dosage_model,
            "selectedGroup": selected_group,
            "selectedRunName": selected_run_name,
            "records": records,
            "migratedToReports": migrated,
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/save_gas_mixing', methods=['POST'])
def save_gas_mixing():
    """Persist gas mixing metadata in Reports/gas_mixing.json."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    selected_group = str(payload.get("selectedGroup") or "").strip()
    selected_run_name = str(payload.get("selectedRunName") or "").strip()
    records = payload.get("records")
    if not isinstance(records, list):
        return jsonify({"success": False, "error": "records must be a list"}), 400

    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)
    file_path = os.path.join(reports_dir, GAS_MIXING_FILENAME)
    if not project_manager.is_path_within(reports_dir, file_path):
        return jsonify({"success": False, "error": "Invalid gas mixing path"}), 400

    raw_verification_meta = payload.get("verificationMeta", None)
    if raw_verification_meta is not None:
        verification_meta = _normalize_gas_verification_meta(raw_verification_meta)
    else:
        # Backward-compatible safeguard:
        # if caller omits verificationMeta, keep what is already saved.
        existing_meta = {}
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as existing_handle:
                    existing_payload = json.load(existing_handle)
                if isinstance(existing_payload, dict):
                    existing_meta = existing_payload.get("verificationMeta") or {}
            except Exception:
                existing_meta = {}
        verification_meta = _normalize_gas_verification_meta(existing_meta)

    raw_dosage_model = payload.get("dosageModel", None)
    if raw_dosage_model is not None:
        dosage_model = _normalize_gas_dosage_model(raw_dosage_model)
    else:
        existing_model = {}
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as existing_handle:
                    existing_payload = json.load(existing_handle)
                if isinstance(existing_payload, dict):
                    existing_model = existing_payload.get("dosageModel") or {}
            except Exception:
                existing_model = {}
        dosage_model = _normalize_gas_dosage_model(existing_model)

    safe_records = []
    for item in records:
        if not isinstance(item, dict):
            continue
        item_results = item.get("results") if isinstance(item.get("results"), dict) else None
        item_calibration_applied = str(item.get("calibrationApplied") or "").strip().lower() in {"yes", "true", "1", "y"}
        item_estimated_h2 = (
            item.get("mH2EstimatedG")
            or (item_results or {}).get("m_H2_injected_g")
            or ((item.get("mH2InjectedG") or item.get("h2MassG")) if not item_calibration_applied else "")
            or ""
        )
        safe_records.append({
            "group": str(item.get("group") or "").strip(),
            "runName": str(item.get("runName") or "").strip(),
            "targetVol": str(item.get("targetVol") or "").strip(),
            "relativeHumidityPct": str(item.get("relativeHumidityPct") or "").strip(),
            "pChamberPa": str(item.get("pChamberPa") or item.get("P_chamber_Pa") or item.get("ambPressure") or "").strip(),
            "tChamberC": str(item.get("tChamberC") or "").strip(),
            "tChamberK": str(item.get("tChamberK") or "").strip(),
            "mfcFlowSlpm": str(item.get("mfcFlowSlpm") or "").strip(),
            "lM": str(item.get("lM") or "").strip(),
            "wM": str(item.get("wM") or "").strip(),
            "hM": str(item.get("hM") or "").strip(),
            "volPipesM3": str(item.get("volPipesM3") or "").strip(),
            "hotwireAssemblyM3": str(item.get("hotwireAssemblyM3") or "").strip(),
            "weldedPartsM3": str(item.get("weldedPartsM3") or "").strip(),
            "boltsM3": str(item.get("boltsM3") or "").strip(),
            "tStdC": str(item.get("tStdC") or "").strip(),
            "tStdK": str(item.get("tStdK") or "").strip(),
            "pStdPa": str(item.get("pStdPa") or "").strip(),
            "ru": str(item.get("ru") or "").strip(),
            "mH2": str(item.get("mH2") or "").strip(),
            "mH2EstimatedG": str(item_estimated_h2).strip(),
            "mH2CorrectedG": str(item.get("mH2CorrectedG") or "").strip(),
            "mH2InjectedG": str(item.get("mH2InjectedG") or item.get("h2MassG") or "").strip(),
            "vH2StdL": str(item.get("vH2StdL") or "").strip(),
            "vChamberCorrectedM3": str(item.get("vChamberCorrectedM3") or "").strip(),
            "injectionTimeS": str(item.get("injectionTimeS") or "").strip(),
            "injectionTimeMin": str(item.get("injectionTimeMin") or "").strip(),
            "calibrationModelType": str(item.get("calibrationModelType") or "").strip(),
            "calibrationTargetBasis": str(item.get("calibrationTargetBasis") or "").strip(),
            "calibrationEnabled": str(item.get("calibrationEnabled") or "").strip(),
            "calibrationApplied": str(item.get("calibrationApplied") or "").strip(),
            "calibrationA": str(item.get("calibrationA") or "").strip(),
            "calibrationB": str(item.get("calibrationB") or "").strip(),
            "calibrationNotes": str(item.get("calibrationNotes") or "").strip(),
            "results": item_results,
            "notes": str(item.get("notes") or "").strip(),
            "updatedAt": str(item.get("updatedAt") or "").strip(),
        })

    try:
        data = {
            "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "verificationMeta": verification_meta,
            "dosageModel": dosage_model,
            "selectedGroup": selected_group,
            "selectedRunName": selected_run_name,
            "records": safe_records,
        }
        with open(file_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
        return jsonify({
            "success": True,
            "path": file_path,
            "count": len(safe_records),
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/save_checklist_state', methods=['POST'])
def save_checklist_state():
    """Persist checklist state in Reports/checklist_state.json."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    checklist_state = payload.get("checklistState")
    if not isinstance(checklist_state, dict):
        return jsonify({"success": False, "error": "checklistState must be an object"}), 400

    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)
    file_path = os.path.join(reports_dir, CHECKLIST_STATE_FILENAME)
    if not project_manager.is_path_within(reports_dir, file_path):
        return jsonify({"success": False, "error": "Invalid checklist state path"}), 400

    safe_state = {}
    for key, value in checklist_state.items():
        safe_key = str(key or "").strip()
        if not safe_key:
            continue
        if isinstance(value, (bool, int, float)):
            safe_state[safe_key] = value
        elif value is None:
            safe_state[safe_key] = ""
        else:
            safe_state[safe_key] = str(value)

    try:
        data = {
            "updatedAt": _now_display_str(include_seconds=True),
            "checklistState": safe_state,
        }
        with open(file_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
        return jsonify({
            "success": True,
            "path": file_path,
            "count": len(safe_state),
        })
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


def _load_latest_plan_payload(project_root):
    plan_dir = os.path.join(project_root, "Plan")
    default_payload = {"planName": "Experiment_Plan", "meta": {}, "experiments": []}
    if not os.path.isdir(plan_dir):
        return default_payload

    plan_candidates = [
        os.path.join(plan_dir, name)
        for name in os.listdir(plan_dir)
        if name.lower().endswith(".json") and name != project_manager.STATUS_FILENAME and not name.startswith(".")
    ]
    valid = []
    for candidate in plan_candidates:
        try:
            with open(candidate, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if isinstance(payload, dict) and isinstance(payload.get("experiments"), list):
                valid.append((candidate, payload))
        except Exception:
            continue
    if not valid:
        return default_payload

    latest_path, latest_payload = max(valid, key=lambda pair: os.path.getmtime(pair[0]))
    return {
        "path": latest_path,
        "planName": latest_payload.get("planName") or "Experiment_Plan",
        "meta": latest_payload.get("meta") if isinstance(latest_payload.get("meta"), dict) else {},
        "experiments": latest_payload.get("experiments") if isinstance(latest_payload.get("experiments"), list) else [],
    }


def _load_daq_systems_payload(project_root):
    file_path = _resolve_existing_metadata_file(project_root, DAQ_SYSTEMS_FILENAME)
    if not os.path.exists(file_path):
        return {"path": file_path, "daqSystems": []}
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        systems = payload.get("daqSystems") if isinstance(payload, dict) else payload
        if not isinstance(systems, list):
            systems = []
        return {"path": file_path, "daqSystems": systems}
    except Exception:
        return {"path": file_path, "daqSystems": []}


def _load_sensors_mapping_payload(project_root):
    file_path = _resolve_existing_metadata_file(project_root, SENSORS_MAPPING_FILENAME)
    if not os.path.exists(file_path):
        return {"path": file_path, "mappingsByGroup": {}, "groupNotes": {}, "groupNames": []}
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        mappings_by_group = payload.get("mappingsByGroup") if isinstance(payload, dict) and isinstance(payload.get("mappingsByGroup"), dict) else {}
        group_notes = payload.get("groupNotes") if isinstance(payload, dict) and isinstance(payload.get("groupNotes"), dict) else {}
        groups = sorted(
            set(list(mappings_by_group.keys()) + list(group_notes.keys())),
            key=lambda value: str(value).lower(),
        )
        return {
            "path": file_path,
            "mappingsByGroup": mappings_by_group,
            "groupNotes": group_notes,
            "groupNames": groups,
        }
    except Exception:
        return {"path": file_path, "mappingsByGroup": {}, "groupNotes": {}, "groupNames": []}


def _load_cameras_mapping_payload(project_root):
    file_path = _resolve_existing_metadata_file(project_root, CAMERAS_MAPPING_FILENAME)
    if not os.path.exists(file_path):
        return {"path": file_path, "mappingsByGroup": {}, "groupNotes": {}, "groupNames": []}
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        mappings_by_group = payload.get("mappingsByGroup") if isinstance(payload, dict) and isinstance(payload.get("mappingsByGroup"), dict) else {}
        group_notes = payload.get("groupNotes") if isinstance(payload, dict) and isinstance(payload.get("groupNotes"), dict) else {}
        groups = sorted(
            set(list(mappings_by_group.keys()) + list(group_notes.keys())),
            key=lambda value: str(value).lower(),
        )
        return {
            "path": file_path,
            "mappingsByGroup": mappings_by_group,
            "groupNotes": group_notes,
            "groupNames": groups,
        }
    except Exception:
        return {"path": file_path, "mappingsByGroup": {}, "groupNotes": {}, "groupNames": []}


def _load_gas_mixing_payload(project_root):
    file_path = _resolve_existing_metadata_file(project_root, GAS_MIXING_FILENAME)
    if not os.path.exists(file_path):
        return {"path": file_path, "records": [], "verificationMeta": _normalize_gas_verification_meta({})}
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        records = payload.get("records") if isinstance(payload, dict) and isinstance(payload.get("records"), list) else []
        verification_meta = _normalize_gas_verification_meta(payload.get("verificationMeta") if isinstance(payload, dict) else {})
        return {"path": file_path, "records": records, "verificationMeta": verification_meta}
    except Exception:
        return {"path": file_path, "records": [], "verificationMeta": _normalize_gas_verification_meta({})}


def _write_metadata_sections_csv(target_path, project_name, plan_payload, daq_payload, sensors_payload, cameras_payload, gas_payload):
    plan_rows = _build_plan_export_rows(plan_payload.get("experiments"), plan_payload.get("meta"))
    plan_meta = plan_payload.get("meta") if isinstance(plan_payload.get("meta"), dict) else {}
    group_objectives = plan_meta.get("groupObjectives") if isinstance(plan_meta.get("groupObjectives"), dict) else {}
    daq_rows = _build_daq_export_rows(daq_payload.get("daqSystems"))
    sensor_rows = _build_sensors_export_rows(
        sensors_payload.get("mappingsByGroup"),
        group_notes=sensors_payload.get("groupNotes"),
        group_names=sensors_payload.get("groupNames"),
    )
    camera_rows = _build_cameras_export_rows(
        cameras_payload.get("mappingsByGroup"),
        group_notes=cameras_payload.get("groupNotes"),
        group_names=cameras_payload.get("groupNames"),
    )
    gas_rows = _build_gas_mixing_export_rows(gas_payload.get("records"))

    with open(target_path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Export Type", "Metadata Report"])
        writer.writerow(["Project", str(project_name or "-")])
        writer.writerow(["Responsible Researcher", "PhD Student Javier I. Camacho"])
        writer.writerow(["Generated At", _now_display_str(include_seconds=True)])
        writer.writerow(["Sections", "Plan, DAQ Systems, Sensors Mapping, Cameras Mapping, Gas Mixing"])
        writer.writerow([])

        writer.writerow(["[TAB] Plan"])
        writer.writerow([
            "Run Name",
            "Group",
            "Group Description",
            "Status",
            "Done",
            "Preparation",
            "Schedule",
            "Planned Date",
            "Planned Day",
            "H2 (%)",
            "H2 Injected (g)",
            "MFC Flow (SLPM)",
            "Ignition",
            "Vent",
            "P0 (Pa)",
            "T0 (K)",
            "Recirc Stop To Ignition (s)",
            "Case ID / CFD Hash",
            "Data Files Count",
            "File Path (Raw_Data Folder)",
            "Short Description",
            "Run Notes",
            "Error",
            "Error Note",
            "Canceled",
            "Canceled Note",
        ])
        for row in plan_rows:
            writer.writerow([
                row.get("run_name", ""),
                row.get("group", ""),
                row.get("group_description", ""),
                row.get("run_status", ""),
                row.get("done", ""),
                row.get("preparation", ""),
                row.get("schedule", ""),
                row.get("planned_date", ""),
                row.get("planned_day", ""),
                row.get("h2", ""),
                row.get("h2_injected_grams", ""),
                row.get("mfc_flow_slpm", ""),
                row.get("ignition", ""),
                row.get("vent", ""),
                row.get("p0", ""),
                row.get("t0", ""),
                row.get("recirc_stop_to_ignition_sec", ""),
                row.get("cfd_hash", ""),
                row.get("data_files_count", ""),
                row.get("data_files", ""),
                row.get("short_description", ""),
                row.get("notes", ""),
                row.get("error", ""),
                row.get("error_note", ""),
                row.get("canceled", ""),
                row.get("canceled_note", ""),
            ])
        writer.writerow([])

        writer.writerow(["[TAB] Plan Group Objectives"])
        writer.writerow(["Group", "Objective"])
        if group_objectives:
            for group_name in sorted(group_objectives.keys(), key=lambda v: str(v or "").lower()):
                writer.writerow([
                    str(group_name or ""),
                    str(group_objectives.get(group_name) or ""),
                ])
        else:
            writer.writerow(["-", "-"])
        writer.writerow([])

        writer.writerow(["[TAB] DAQ Systems"])
        writer.writerow(["DAQ System Name", "Measured Quantity", "Vendor", "Model", "Serial Number", "Sampling Rate (Hz)", "Channel Count", "Owner", "Last Calibration Date", "Calibration Certificate ID", "Active", "Notes"])
        for row in daq_rows:
            writer.writerow([
                row.get("name", ""),
                row.get("measured_quantity", ""),
                row.get("vendor", ""),
                row.get("model", ""),
                row.get("serial", ""),
                row.get("sampling_rate_hz", ""),
                row.get("channel_count", ""),
                row.get("owner", ""),
                row.get("last_calibration_date", ""),
                row.get("calibration_certificate_id", ""),
                row.get("active", ""),
                row.get("notes", ""),
            ])
        writer.writerow([])

        writer.writerow(["[TAB] Sensors Mapping"])
        sensors_headers = ["Group", "Sensor ID", "Measured Quantity", "DAQ System", "DAQ Channel", "Serial Number", "Sensitivity", "Location", "Coord.(x,y,z)m", "Mounting", "Active", "Blind", "Trigger Method", "Status", "Notes"]
        previous_group = None
        previous_group_note = ""
        for row in sensor_rows:
            current_group = str(row.get("group") or "").strip()
            current_group_note = str(row.get("group_note") or "").strip()
            if current_group != previous_group:
                if previous_group is not None:
                    if previous_group_note:
                        writer.writerow([f"Group Reference Note ({previous_group})", previous_group_note])
                    writer.writerow([])
                writer.writerow(sensors_headers)
            writer.writerow([
                row.get("group", ""),
                row.get("sensor_id", ""),
                row.get("quantity", ""),
                row.get("daq_system", ""),
                row.get("daq_channel", ""),
                row.get("serial", ""),
                row.get("sensitivity", ""),
                row.get("location", ""),
                row.get("coordinates", ""),
                row.get("mounting", ""),
                row.get("active", ""),
                row.get("blind", ""),
                row.get("trigger_method", ""),
                row.get("status", ""),
                row.get("notes", ""),
            ])
            previous_group = current_group
            previous_group_note = current_group_note
        if previous_group and previous_group_note:
            writer.writerow([f"Group Reference Note ({previous_group})", previous_group_note])
        writer.writerow([])

        writer.writerow(["[TAB] Cameras Mapping"])
        cameras_headers = [
            "Group",
            "Camera ID",
            "Camera Type",
            "Model",
            "Serial Number",
            "Frame Rate",
            "Resolution",
            "Lens / Focal Length",
            "Position Coordinates",
            "Coordinate Unit",
            "Coordinate Origin",
            "Mounting Description",
            "Field of View / Target Region",
            "Trigger Source",
            "Synchronization Notes",
            "Active",
            "Calibration / Reference Image",
            "Emissivity",
            "Temperature Range",
            "Status",
            "Notes",
        ]
        previous_group = None
        previous_group_note = ""
        for row in camera_rows:
            current_group = str(row.get("group") or "").strip()
            current_group_note = str(row.get("group_note") or "").strip()
            if current_group != previous_group:
                if previous_group is not None:
                    if previous_group_note:
                        writer.writerow([f"Group Reference Note ({previous_group})", previous_group_note])
                    writer.writerow([])
                writer.writerow(cameras_headers)
            writer.writerow([
                row.get("group", ""),
                row.get("camera_id", ""),
                row.get("camera_type", ""),
                row.get("model", ""),
                row.get("serial", ""),
                row.get("frame_rate", ""),
                row.get("resolution", ""),
                row.get("lens_focal_length", ""),
                row.get("coordinates", ""),
                row.get("coordinate_unit", ""),
                row.get("coordinate_origin", ""),
                row.get("mounting_location", ""),
                row.get("field_of_view", ""),
                row.get("trigger_source", ""),
                row.get("synchronization_notes", ""),
                row.get("active", ""),
                row.get("calibration_reference", ""),
                row.get("emissivity", ""),
                row.get("temperature_range", ""),
                row.get("status", ""),
                row.get("notes", ""),
            ])
            previous_group = current_group
            previous_group_note = current_group_note
        if previous_group and previous_group_note:
            writer.writerow([f"Group Reference Note ({previous_group})", previous_group_note])
        writer.writerow([])

        writer.writerow(["[TAB] Gas Mixing"])
        writer.writerow(["Group", "Run/Test", "Target H2 (%vol)", "Relative Humidity (%RH)", "Pchamber (Pa)", "Tchamber (°C)", "Tchamber (K)", "H2 Injected Estimated (g)", "H2 Injected Corrected (g)", "H2 Injected Volume (L)", "MFC Flow (SLPM)", "Fill Time (s)", "Fill Time (min)", "Calibration Model Type", "Calibration Target Basis", "Calibration Enabled", "Calibration Applied", "Calibration a", "Calibration b", "Calibration Notes", "Notes", "Updated At"])
        for row in gas_rows:
            writer.writerow([
                row.get("group", ""),
                row.get("run_short", "") or row.get("run_name", ""),
                row.get("target_vol", ""),
                row.get("relative_humidity_pct", ""),
                row.get("p_chamber_pa", ""),
                row.get("t_chamber_c", ""),
                row.get("t_chamber_k", ""),
                row.get("h2_mass_est_g", ""),
                row.get("h2_mass_corr_display", ""),
                row.get("v_h2_inj_l", ""),
                row.get("mfc_flow_slpm", ""),
                row.get("injection_time_s", ""),
                row.get("injection_time_min", ""),
                row.get("calibration_model_type", ""),
                row.get("calibration_target_basis", ""),
                row.get("calibration_enabled", ""),
                row.get("calibration_applied", ""),
                row.get("calibration_a", ""),
                row.get("calibration_b", ""),
                row.get("calibration_notes", ""),
                row.get("notes", ""),
                row.get("updated_at", ""),
            ])


@state_bp.route('/export_metadata_report_artifact', methods=['POST'])
def export_metadata_report_artifact():
    """Export consolidated metadata report artifact (CSV or merged PDF) into Reports folder."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    export_format = str(payload.get("format") or "").strip().lower()
    if export_format not in {"csv", "pdf"}:
        return jsonify({"success": False, "error": "format must be 'csv' or 'pdf'"}), 400

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)
    if not project_manager.is_path_within(project_root, reports_dir):
        return jsonify({"success": False, "error": "Invalid reports path"}), 400

    project_name = os.path.basename(project_root.rstrip(os.sep)) or "Project"
    date_stamp = datetime.now().strftime("%Y-%m-%d")
    stem = _sanitize_export_stem(f"{project_name}_Metadata_Report", "Metadata_Report")
    target_name = f"{stem}_{date_stamp}.{export_format}"
    target_path = os.path.join(reports_dir, target_name)
    if not project_manager.is_path_within(reports_dir, target_path):
        return jsonify({"success": False, "error": "Invalid export filename"}), 400

    plan_payload = _load_latest_plan_payload(project_root)
    daq_payload = _load_daq_systems_payload(project_root)
    sensors_payload = _load_sensors_mapping_payload(project_root)
    cameras_payload = _load_cameras_mapping_payload(project_root)
    gas_payload = _load_gas_mixing_payload(project_root)

    try:
        if export_format == "csv":
            _write_metadata_sections_csv(
                target_path=target_path,
                project_name=project_name,
                plan_payload=plan_payload,
                daq_payload=daq_payload,
                sensors_payload=sensors_payload,
                cameras_payload=cameras_payload,
                gas_payload=gas_payload,
            )
            return jsonify({"success": True, "path": target_path, "format": "csv"})

        try:
            import fitz  # PyMuPDF
        except Exception as exc:
            return jsonify({"success": False, "error": f"PyMuPDF unavailable: {exc}"}), 500

        plan_rows = _build_plan_export_rows(plan_payload.get("experiments"), plan_payload.get("meta"))
        daq_rows = _build_daq_export_rows(daq_payload.get("daqSystems"))
        sensors_rows = _build_sensors_export_rows(
            sensors_payload.get("mappingsByGroup"),
            group_notes=sensors_payload.get("groupNotes"),
            group_names=sensors_payload.get("groupNames"),
        )
        cameras_rows = _build_cameras_export_rows(
            cameras_payload.get("mappingsByGroup"),
            group_notes=cameras_payload.get("groupNotes"),
            group_names=cameras_payload.get("groupNames"),
        )
        gas_rows = _build_gas_mixing_export_rows(gas_payload.get("records"))
        plan_meta = plan_payload.get("meta") if isinstance(plan_payload.get("meta"), dict) else {}
        project_objective = str(plan_meta.get("objective") or "").strip() or "-"
        project_description = str(plan_meta.get("description") or "").strip() or "-"

        with tempfile.TemporaryDirectory(prefix="exda-meta-") as tmp_dir:
            plan_pdf = os.path.join(tmp_dir, "plan.pdf")
            daq_pdf = os.path.join(tmp_dir, "daq.pdf")
            sensors_pdf = os.path.join(tmp_dir, "sensors.pdf")
            cameras_pdf = os.path.join(tmp_dir, "cameras.pdf")
            gas_pdf = os.path.join(tmp_dir, "gas.pdf")

            ok, result = _write_plan_pdf(
                plan_payload.get("planName") or "Experiment_Plan",
                plan_payload.get("meta") if isinstance(plan_payload.get("meta"), dict) else {},
                plan_rows,
                plan_pdf,
            )
            if not ok:
                return jsonify({"success": False, "error": result}), 500

            ok, result = _write_daq_pdf(project_name, daq_rows, daq_pdf)
            if not ok:
                return jsonify({"success": False, "error": result}), 500

            ok, result = _write_sensors_pdf(project_name, sensors_rows, sensors_pdf)
            if not ok:
                return jsonify({"success": False, "error": result}), 500

            ok, result = _write_cameras_pdf(project_name, cameras_rows, cameras_pdf)
            if not ok:
                return jsonify({"success": False, "error": result}), 500

            ok, result = _write_gas_mixing_pdf(project_name, gas_rows, gas_pdf, gas_payload.get("verificationMeta"))
            if not ok:
                return jsonify({"success": False, "error": result}), 500

            merged = fitz.open()
            cover = merged.new_page(width=842, height=595)
            # Keep metadata cover page consistent with the other report headers.
            logo_paths = _resolve_pdf_logos()
            try:
                university_logo = logo_paths.get("university")
                if university_logo:
                    cover.insert_image(
                        fitz.Rect(500, 16, 660, 76),
                        filename=university_logo,
                        keep_proportion=True,
                        overlay=True,
                    )
                institute_logo = logo_paths.get("institute")
                if institute_logo:
                    cover.insert_image(
                        fitz.Rect(668, 16, 818, 76),
                        filename=institute_logo,
                        keep_proportion=True,
                        overlay=True,
                    )
            except Exception:
                pass
            cover.insert_text((36, 54), "EXDA Metadata Report", fontname="courier-bold", fontsize=18, color=(0, 0, 0))
            cover.insert_text((36, 84), f"Project: {project_name}", fontname="courier", fontsize=10, color=(0, 0, 0))
            cover.insert_text((36, 100), f"Generated: {_now_display_str(include_seconds=True)}", fontname="courier", fontsize=10, color=(0, 0, 0))
            cover.insert_text((36, 130), "Includes: Plan, DAQ Systems, Sensors Mapping, Cameras Mapping, Gas Mixing", fontname="courier", fontsize=10, color=(0, 0, 0))
            cover.insert_text((36, 146), "Responsible Researcher: PhD Student Javier I. Camacho", fontname="courier", fontsize=10, color=(0, 0, 0))

            objective_y = 176
            cover.insert_text((36, objective_y), "Project Objective:", fontname="courier-bold", fontsize=10, color=(0, 0, 0))
            objective_y += 14
            objective_lines = textwrap.wrap(project_objective, width=100, break_long_words=False, break_on_hyphens=False) or ["-"]
            for line in objective_lines:
                cover.insert_text((36, objective_y), line, fontname="courier", fontsize=9.5, color=(0, 0, 0))
                objective_y += 12

            objective_y += 6
            cover.insert_text((36, objective_y), "Project Description:", fontname="courier-bold", fontsize=10, color=(0, 0, 0))
            objective_y += 14
            for paragraph in [part.strip() for part in project_description.splitlines()] or ["-"]:
                if not paragraph:
                    objective_y += 6
                    continue
                wrapped = textwrap.wrap(paragraph, width=100, break_long_words=False, break_on_hyphens=False) or ["-"]
                for line in wrapped:
                    cover.insert_text((36, objective_y), line, fontname="courier", fontsize=9.5, color=(0, 0, 0))
                    objective_y += 12

            for section_path in [plan_pdf, daq_pdf, sensors_pdf, cameras_pdf, gas_pdf]:
                if not os.path.exists(section_path):
                    continue
                section_doc = fitz.open(section_path)
                try:
                    merged.insert_pdf(section_doc)
                finally:
                    section_doc.close()

            total_pages = len(merged)
            for page_index, page_obj in enumerate(merged, start=1):
                footer_text = f"Page {page_index}/{total_pages}"
                # Clear any pre-existing footer marks in the bottom-right corner before writing unified numbering.
                page_obj.draw_rect(
                    fitz.Rect(720, 572, 838, 592),
                    color=None,
                    fill=(1, 1, 1),
                    overlay=True,
                )
                page_obj.insert_text((770, 582), footer_text, fontname="courier", fontsize=8, color=(0.25, 0.25, 0.25))

            merged.save(target_path, deflate=True, garbage=4)
            merged.close()

        return jsonify({"success": True, "path": target_path, "format": "pdf"})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/export_daq_artifact', methods=['POST'])
def export_daq_artifact():
    """Export DAQ systems artifact (CSV or PDF) into the project's Reports folder."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    daq_systems = payload.get("daqSystems") if isinstance(payload.get("daqSystems"), list) else []
    export_format = str(payload.get("format") or "").strip().lower()

    if export_format not in {"csv", "pdf"}:
        return jsonify({"success": False, "error": "format must be 'csv' or 'pdf'"}), 400

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)

    project_name = os.path.basename(project_root.rstrip(os.sep)) or "Project"
    date_stamp = datetime.now().strftime("%Y-%m-%d")
    stem = _sanitize_export_stem(f"{project_name}_DAQ_Systems", "DAQ_Systems")
    target_name = f"{stem}_{date_stamp}.{export_format}"
    target_path = os.path.join(reports_dir, target_name)
    if not project_manager.is_path_within(reports_dir, target_path):
        return jsonify({"success": False, "error": "Invalid export filename"}), 400

    rows = _build_daq_export_rows(daq_systems)
    try:
        if export_format == "csv":
            _write_daq_csv(rows, target_path, project_name=project_name)
            return jsonify({"success": True, "path": target_path, "format": "csv", "rows": len(rows)})

        ok, result = _write_daq_pdf(project_name, rows, target_path)
        if not ok:
            return jsonify({"success": False, "error": result}), 500
        return jsonify({"success": True, "path": result, "format": "pdf", "rows": len(rows)})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/export_sensors_mapping_artifact', methods=['POST'])
def export_sensors_mapping_artifact():
    """Export sensors mapping artifact (CSV or PDF) into the project's Reports folder."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    mappings_by_group = payload.get("mappingsByGroup") if isinstance(payload.get("mappingsByGroup"), dict) else {}
    group_notes = payload.get("groupNotes") if isinstance(payload.get("groupNotes"), dict) else {}
    group_names = payload.get("groupNames") if isinstance(payload.get("groupNames"), list) else []
    export_format = str(payload.get("format") or "").strip().lower()

    if export_format not in {"csv", "pdf"}:
        return jsonify({"success": False, "error": "format must be 'csv' or 'pdf'"}), 400

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)

    project_name = os.path.basename(project_root.rstrip(os.sep)) or "Project"
    date_stamp = datetime.now().strftime("%Y-%m-%d")
    stem = _sanitize_export_stem(f"{project_name}_Sensors_Mapping", "Sensors_Mapping")
    target_name = f"{stem}_{date_stamp}.{export_format}"
    target_path = os.path.join(reports_dir, target_name)
    if not project_manager.is_path_within(reports_dir, target_path):
        return jsonify({"success": False, "error": "Invalid export filename"}), 400

    rows = _build_sensors_export_rows(
        mappings_by_group,
        group_notes=group_notes,
        group_names=group_names,
    )
    try:
        if export_format == "csv":
            _write_sensors_csv(rows, target_path, project_name=project_name)
            return jsonify({"success": True, "path": target_path, "format": "csv", "rows": len(rows)})

        ok, result = _write_sensors_pdf(project_name, rows, target_path)
        if not ok:
            return jsonify({"success": False, "error": result}), 500
        return jsonify({"success": True, "path": result, "format": "pdf", "rows": len(rows)})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/export_cameras_mapping_artifact', methods=['POST'])
def export_cameras_mapping_artifact():
    """Export cameras mapping artifact (CSV or PDF) into the project's Reports folder."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    mappings_by_group = payload.get("mappingsByGroup") if isinstance(payload.get("mappingsByGroup"), dict) else {}
    group_notes = payload.get("groupNotes") if isinstance(payload.get("groupNotes"), dict) else {}
    group_names = payload.get("groupNames") if isinstance(payload.get("groupNames"), list) else []
    export_format = str(payload.get("format") or "").strip().lower()

    if export_format not in {"csv", "pdf"}:
        return jsonify({"success": False, "error": "format must be 'csv' or 'pdf'"}), 400

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)

    project_name = os.path.basename(project_root.rstrip(os.sep)) or "Project"
    date_stamp = datetime.now().strftime("%Y-%m-%d")
    stem = _sanitize_export_stem(f"{project_name}_Cameras_Mapping", "Cameras_Mapping")
    target_name = f"{stem}_{date_stamp}.{export_format}"
    target_path = os.path.join(reports_dir, target_name)
    if not project_manager.is_path_within(reports_dir, target_path):
        return jsonify({"success": False, "error": "Invalid export filename"}), 400

    rows = _build_cameras_export_rows(
        mappings_by_group,
        group_notes=group_notes,
        group_names=group_names,
    )
    try:
        if export_format == "csv":
            _write_cameras_csv(rows, target_path, project_name=project_name)
            return jsonify({"success": True, "path": target_path, "format": "csv", "rows": len(rows)})

        ok, result = _write_cameras_pdf(project_name, rows, target_path)
        if not ok:
            return jsonify({"success": False, "error": result}), 500
        return jsonify({"success": True, "path": result, "format": "pdf", "rows": len(rows)})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/export_gas_mixing_artifact', methods=['POST'])
def export_gas_mixing_artifact():
    """Export gas mixing artifact (CSV or PDF) into the project's Reports folder."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    records = payload.get("records") if isinstance(payload.get("records"), list) else []
    verification_meta = _normalize_gas_verification_meta(payload.get("verificationMeta"))
    export_format = str(payload.get("format") or "").strip().lower()

    if export_format not in {"csv", "pdf"}:
        return jsonify({"success": False, "error": "format must be 'csv' or 'pdf'"}), 400

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)

    project_name = os.path.basename(project_root.rstrip(os.sep)) or "Project"
    date_stamp = datetime.now().strftime("%Y-%m-%d")
    stem = _sanitize_export_stem(f"{project_name}_Gas_Mixing", "Gas_Mixing")
    target_name = f"{stem}_{date_stamp}.{export_format}"
    target_path = os.path.join(reports_dir, target_name)
    if not project_manager.is_path_within(reports_dir, target_path):
        return jsonify({"success": False, "error": "Invalid export filename"}), 400

    rows = _build_gas_mixing_export_rows(records)
    try:
        if export_format == "csv":
            _write_gas_mixing_csv(rows, target_path, project_name=project_name, verification_meta=verification_meta)
            return jsonify({"success": True, "path": target_path, "format": "csv", "rows": len(rows)})

        ok, result = _write_gas_mixing_pdf(project_name, rows, target_path, verification_meta=verification_meta)
        if not ok:
            return jsonify({"success": False, "error": result}), 500
        return jsonify({"success": True, "path": result, "format": "pdf", "rows": len(rows)})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/export_plan_artifact', methods=['POST'])
def export_plan_artifact():
    """Export plan artifact (CSV or PDF) into the project's Plan folder."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    plan_name = payload.get("planName") or "Experiment_Plan"
    plan_meta = payload.get("planMeta") if isinstance(payload.get("planMeta"), dict) else {}
    experiments = payload.get("experiments") if isinstance(payload.get("experiments"), list) else []
    export_format = str(payload.get("format") or "").strip().lower()

    if export_format not in {"csv", "pdf"}:
        return jsonify({"success": False, "error": "format must be 'csv' or 'pdf'"}), 400

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400

    plan_dir = os.path.join(project_root, "Plan")
    os.makedirs(plan_dir, exist_ok=True)

    date_stamp = datetime.now().strftime("%Y-%m-%d")
    stem = _sanitize_export_stem(plan_name, "Experiment_Plan")
    target_name = f"{stem}_{date_stamp}.{export_format}"
    target_path = os.path.join(plan_dir, target_name)
    if not project_manager.is_path_within(plan_dir, target_path):
        return jsonify({"success": False, "error": "Invalid export filename"}), 400

    rows = _build_plan_export_rows(experiments, plan_meta)
    try:
        if export_format == "csv":
            _write_plan_csv(rows, target_path, plan_name=plan_name, plan_meta=plan_meta)
            return jsonify({"success": True, "path": target_path, "format": "csv", "rows": len(rows)})

        ok, result = _write_plan_pdf(plan_name, plan_meta, rows, target_path)
        if not ok:
            return jsonify({"success": False, "error": result}), 500
        return jsonify({"success": True, "path": result, "format": "pdf", "rows": len(rows)})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/sync_run_data_folders', methods=['POST'])
def sync_run_data_folders():
    """Ensure Raw_Data/<run> and Clean_Data/<run> folders exist for each run name."""
    data = request.json or {}
    project_path = data.get('projectPath')
    run_names = data.get('runNames') or []

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400
    if not isinstance(run_names, list):
        return jsonify({"success": False, "error": "runNames must be a list"}), 400

    raw_root = os.path.join(project_root, "Raw_Data")
    clean_root = os.path.join(project_root, "Clean_Data")
    cfd_root = os.path.join(project_root, "CFD_Data")
    os.makedirs(raw_root, exist_ok=True)
    os.makedirs(clean_root, exist_ok=True)
    os.makedirs(cfd_root, exist_ok=True)

    ensured = []
    skipped = []

    for run_name in run_names:
        original = str(run_name or "").strip()
        if not original:
            skipped.append({"run": original, "reason": "empty"})
            continue

        # Keep names readable while preventing path traversal and separators.
        safe_name = original.replace("/", "-").replace("\\", "-").strip().strip(".")
        if not safe_name:
            skipped.append({"run": original, "reason": "invalid"})
            continue

        raw_target = os.path.realpath(os.path.join(raw_root, safe_name))
        clean_target = os.path.realpath(os.path.join(clean_root, safe_name))
        if not project_manager.is_path_within(project_root, raw_target) or not project_manager.is_path_within(project_root, clean_target):
            skipped.append({"run": original, "reason": "unsafe"})
            continue

        os.makedirs(raw_target, exist_ok=True)
        os.makedirs(clean_target, exist_ok=True)
        ensured.append(safe_name)

    return jsonify({
        "success": True,
        "ensured": ensured,
        "count": len(ensured),
        "skipped": skipped
    })


@state_bp.route('/rename_run_data_folders', methods=['POST'])
def rename_run_data_folders():
    """Rename existing run folders across Raw_Data/Clean_Data/CFD_Data from old->new names."""
    data = request.json or {}
    project_path = data.get('projectPath')
    rename_pairs = data.get('renamePairs') or []

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400
    if not isinstance(rename_pairs, list):
        return jsonify({"success": False, "error": "renamePairs must be a list"}), 400

    roots = {
        "Raw_Data": os.path.join(project_root, "Raw_Data"),
        "Clean_Data": os.path.join(project_root, "Clean_Data"),
        "CFD_Data": os.path.join(project_root, "CFD_Data"),
    }
    for root_path in roots.values():
        os.makedirs(root_path, exist_ok=True)

    moved = []
    created = []
    conflicts = []
    skipped = []

    def _sanitize_run_name(value):
        raw = str(value or "").strip()
        if not raw:
            return ""
        return raw.replace("/", "-").replace("\\", "-").strip().strip(".")

    for pair in rename_pairs:
        if not isinstance(pair, dict):
            skipped.append({"pair": pair, "reason": "invalid_pair"})
            continue

        old_original = str(pair.get("oldName") or "").strip()
        new_original = str(pair.get("newName") or "").strip()
        old_name = _sanitize_run_name(old_original)
        new_name = _sanitize_run_name(new_original)

        if not old_name or not new_name:
            skipped.append({"oldName": old_original, "newName": new_original, "reason": "invalid_name"})
            continue
        if old_name == new_name:
            skipped.append({"oldName": old_name, "newName": new_name, "reason": "same_name"})
            continue

        run_conflict = False
        for root_key, root_path in roots.items():
            old_path = os.path.realpath(os.path.join(root_path, old_name))
            new_path = os.path.realpath(os.path.join(root_path, new_name))
            if (
                not project_manager.is_path_within(project_root, old_path)
                or not project_manager.is_path_within(project_root, new_path)
            ):
                skipped.append({
                    "oldName": old_name,
                    "newName": new_name,
                    "root": root_key,
                    "reason": "unsafe_path",
                })
                run_conflict = True
                continue

            old_exists = os.path.exists(old_path)
            new_exists = os.path.exists(new_path)

            if old_exists and new_exists and old_path != new_path:
                conflicts.append({
                    "oldName": old_name,
                    "newName": new_name,
                    "root": root_key,
                    "reason": "target_exists",
                })
                run_conflict = True
                continue

            if old_exists and not new_exists:
                try:
                    shutil.move(old_path, new_path)
                    moved.append({"root": root_key, "from": old_name, "to": new_name})
                except Exception as exc:
                    conflicts.append({
                        "oldName": old_name,
                        "newName": new_name,
                        "root": root_key,
                        "reason": f"move_failed: {exc}",
                    })
                    run_conflict = True
                continue

            if (not old_exists) and (not new_exists):
                # Keep workflow resilient: create destination folder if source did not exist yet.
                try:
                    os.makedirs(new_path, exist_ok=True)
                    created.append({"root": root_key, "run": new_name})
                except Exception as exc:
                    conflicts.append({
                        "oldName": old_name,
                        "newName": new_name,
                        "root": root_key,
                        "reason": f"create_failed: {exc}",
                    })
                    run_conflict = True
                continue

        if run_conflict:
            # Keep per-root detail in conflicts/skipped; no extra action needed here.
            pass

    return jsonify({
        "success": True,
        "moved": moved,
        "created": created,
        "conflicts": conflicts,
        "skipped": skipped,
    })


@state_bp.route('/rename_run_metadata_references', methods=['POST'])
def rename_run_metadata_references():
    """Rename run/group references inside metadata artifacts (gas mixing + sensors mapping)."""
    data = request.json or {}
    project_path = data.get('projectPath')
    rename_pairs = data.get('renamePairs') or []
    old_group = str(data.get('oldGroup') or '').strip()
    new_group = str(data.get('newGroup') or '').strip()

    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err}), 400
    if not isinstance(rename_pairs, list):
        return jsonify({"success": False, "error": "renamePairs must be a list"}), 400

    reports_dir = os.path.join(project_root, "Reports")
    os.makedirs(reports_dir, exist_ok=True)

    def _clean(value):
        return str(value or "").strip()

    def _fold(value):
        return _clean(value).casefold()

    # Lower-cased lookup for case-insensitive renames.
    run_rename_lookup = {}
    for pair in rename_pairs:
        if not isinstance(pair, dict):
            continue
        old_name = _clean(pair.get("oldName"))
        new_name = _clean(pair.get("newName"))
        if not old_name or not new_name:
            continue
        if old_name == new_name:
            continue
        run_rename_lookup[_fold(old_name)] = new_name

    def _find_case_key(mapping_obj, wanted_key):
        if not isinstance(mapping_obj, dict) or not wanted_key:
            return None
        target = _fold(wanted_key)
        for key in mapping_obj.keys():
            if _fold(key) == target:
                return key
        return None

    def _load_json_dict(path):
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            return payload if isinstance(payload, dict) else {}
        except Exception:
            return {}

    def _write_json(path, payload):
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)

    result = {
        "success": True,
        "gasMixingUpdated": False,
        "gasMixingRecordsRenamed": 0,
        "gasMixingGroupRenamed": False,
        "sensorsMappingUpdated": False,
        "sensorsGroupsRenamed": 0,
        "camerasMappingUpdated": False,
        "camerasGroupsRenamed": 0,
    }

    # --- Gas Mixing remap (group + runName + selected pointers) ---
    gas_path = os.path.join(reports_dir, GAS_MIXING_FILENAME)
    gas_payload = _load_json_dict(gas_path)
    if gas_payload is not None:
        records = gas_payload.get("records")
        if not isinstance(records, list):
            records = []
        touched = False
        renamed_records_count = 0
        old_group_fold = _fold(old_group) if old_group and new_group else ""

        for item in records:
            if not isinstance(item, dict):
                continue
            run_name = _clean(item.get("runName"))
            mapped_name = run_rename_lookup.get(_fold(run_name), run_name)
            if mapped_name != run_name:
                item["runName"] = mapped_name
                touched = True
                renamed_records_count += 1

            if old_group_fold:
                group_name = _clean(item.get("group"))
                if _fold(group_name) == old_group_fold:
                    item["group"] = new_group
                    touched = True

        selected_group = _clean(gas_payload.get("selectedGroup"))
        if old_group_fold and _fold(selected_group) == old_group_fold:
            gas_payload["selectedGroup"] = new_group
            touched = True
            result["gasMixingGroupRenamed"] = True

        selected_run = _clean(gas_payload.get("selectedRunName"))
        mapped_selected_run = run_rename_lookup.get(_fold(selected_run), selected_run)
        if mapped_selected_run != selected_run:
            gas_payload["selectedRunName"] = mapped_selected_run
            touched = True

        if touched:
            gas_payload["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            gas_payload["records"] = records
            _write_json(gas_path, gas_payload)
            result["gasMixingUpdated"] = True
            result["gasMixingRecordsRenamed"] = renamed_records_count

    # --- Sensors Mapping remap (group keys + selectedGroup + notes keys) ---
    sensors_path = os.path.join(reports_dir, SENSORS_MAPPING_FILENAME)
    sensors_payload = _load_json_dict(sensors_path)
    if sensors_payload is not None and old_group and new_group and _fold(old_group) != _fold(new_group):
        mappings_by_group = sensors_payload.get("mappingsByGroup")
        group_notes = sensors_payload.get("groupNotes")
        if not isinstance(mappings_by_group, dict):
            mappings_by_group = {}
        if not isinstance(group_notes, dict):
            group_notes = {}

        touched = False
        renamed_group_count = 0

        old_key = _find_case_key(mappings_by_group, old_group)
        if old_key is not None:
            source_sensors = mappings_by_group.pop(old_key)
            target_key = _find_case_key(mappings_by_group, new_group) or new_group
            target_sensors = mappings_by_group.get(target_key)
            if not isinstance(target_sensors, list):
                target_sensors = []
            if not isinstance(source_sensors, list):
                source_sensors = []
            merged = []
            seen = set()
            for sensor in target_sensors + source_sensors:
                if not isinstance(sensor, dict):
                    continue
                fingerprint = json.dumps(sensor, sort_keys=True, ensure_ascii=False)
                if fingerprint in seen:
                    continue
                seen.add(fingerprint)
                merged.append(sensor)
            mappings_by_group[target_key] = merged
            touched = True
            renamed_group_count += 1

        old_note_key = _find_case_key(group_notes, old_group)
        if old_note_key is not None:
            source_note = _clean(group_notes.pop(old_note_key))
            target_note_key = _find_case_key(group_notes, new_group) or new_group
            existing_note = _clean(group_notes.get(target_note_key))
            if source_note and existing_note and source_note != existing_note:
                group_notes[target_note_key] = f"{existing_note}\n\n{source_note}"
            elif source_note and not existing_note:
                group_notes[target_note_key] = source_note
            elif existing_note:
                group_notes[target_note_key] = existing_note
            touched = True

        selected_group = _clean(sensors_payload.get("selectedGroup"))
        if _fold(selected_group) == _fold(old_group):
            sensors_payload["selectedGroup"] = new_group
            touched = True

        if touched:
            sensors_payload["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            sensors_payload["mappingsByGroup"] = mappings_by_group
            sensors_payload["groupNotes"] = group_notes
            _write_json(sensors_path, sensors_payload)
            result["sensorsMappingUpdated"] = True
            result["sensorsGroupsRenamed"] = renamed_group_count

    # --- Cameras Mapping remap (group keys + selectedGroup + notes keys) ---
    cameras_path = os.path.join(reports_dir, CAMERAS_MAPPING_FILENAME)
    cameras_payload = _load_json_dict(cameras_path)
    if cameras_payload is not None and old_group and new_group and _fold(old_group) != _fold(new_group):
        mappings_by_group = cameras_payload.get("mappingsByGroup")
        group_notes = cameras_payload.get("groupNotes")
        if not isinstance(mappings_by_group, dict):
            mappings_by_group = {}
        if not isinstance(group_notes, dict):
            group_notes = {}

        touched = False
        renamed_group_count = 0

        old_key = _find_case_key(mappings_by_group, old_group)
        if old_key is not None:
            source_cameras = mappings_by_group.pop(old_key)
            target_key = _find_case_key(mappings_by_group, new_group) or new_group
            target_cameras = mappings_by_group.get(target_key)
            if not isinstance(target_cameras, list):
                target_cameras = []
            if not isinstance(source_cameras, list):
                source_cameras = []
            merged = []
            seen = set()
            for camera in target_cameras + source_cameras:
                if not isinstance(camera, dict):
                    continue
                fingerprint = json.dumps(camera, sort_keys=True, ensure_ascii=False)
                if fingerprint in seen:
                    continue
                seen.add(fingerprint)
                merged.append(camera)
            mappings_by_group[target_key] = merged
            touched = True
            renamed_group_count += 1

        old_note_key = _find_case_key(group_notes, old_group)
        if old_note_key is not None:
            source_note = _clean(group_notes.pop(old_note_key))
            target_note_key = _find_case_key(group_notes, new_group) or new_group
            existing_note = _clean(group_notes.get(target_note_key))
            if source_note and existing_note and source_note != existing_note:
                group_notes[target_note_key] = f"{existing_note}\n\n{source_note}"
            elif source_note and not existing_note:
                group_notes[target_note_key] = source_note
            elif existing_note:
                group_notes[target_note_key] = existing_note
            touched = True

        selected_group = _clean(cameras_payload.get("selectedGroup"))
        if _fold(selected_group) == _fold(old_group):
            cameras_payload["selectedGroup"] = new_group
            touched = True

        if touched:
            cameras_payload["updatedAt"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            cameras_payload["mappingsByGroup"] = mappings_by_group
            cameras_payload["groupNotes"] = group_notes
            _write_json(cameras_path, cameras_payload)
            result["camerasMappingUpdated"] = True
            result["camerasGroupsRenamed"] = renamed_group_count

    return jsonify(result)
