"""State routes for loading project files, plan data, and raw-data inventory."""

from flask import Blueprint, jsonify, request, send_file
import json
from datetime import datetime, timezone
import os
import re
import csv
import textwrap
import tempfile
import mimetypes
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
    sample_count = int(len(ref.get("values") or []))
    sample_idx = np.arange(sample_count, dtype=np.int64)
    t_ref = (
        sample_idx.astype(float) - float(ref.get("trigger_sample") or 0.0)
    ) / float(ref.get("sample_rate") or 1.0) + float(ref.get("trigger_time") or 0.0)

    channel_summaries = []
    for idx, channel in enumerate(channels):
        values = np.asarray(channel.get("values") or [], dtype=float).reshape(-1)
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

    return {
        "parser": "tpc5 parser",
        "timeSummary": _time_summary(t_ref),
        "channelCount": int(len(channel_summaries)),
        "channels": channel_summaries,
        "notes": [
            "TPC5 may contain channels with different per-channel timing metadata.",
            "Parsing for screening uses per-series native time vectors.",
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

    channel_summaries = []
    for idx, col_name in enumerate(numeric_df.columns):
        values = numeric_df.iloc[:, idx].to_numpy(dtype=float, copy=False)
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
        "notes": [
            "MF4 channels are represented with a numeric dataframe time index.",
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
            "preparation": "Yes" if bool(meta.get("isPreparation")) else "No",
            "schedule": _row_schedule(meta),
            "h2": str(meta.get("h2") or ""),
            "ignition": str(meta.get("ignition") or ""),
            "vent": str(meta.get("vent") or ""),
            "p0": str(meta.get("p0") or ""),
            "t0": str(meta.get("t0") or ""),
            "data_files_count": str(len(data_files)),
            "data_files": " | ".join(str(item) for item in data_files),
            "short_description": str(meta.get("shortDescription") or ""),
        })
    return rows


def _write_plan_csv(rows, target_path, plan_name=None, plan_meta=None):
    headers = [
        "Run Name", "Group", "Group Description", "Done", "Schedule",
        "H2 (%)", "Ignition", "Vent", "Pressure P0 (Pa)", "Temperature T0 (K)",
        "Data Files Count", "File Path (Raw_Data Folder)",
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
                row["run_name"], row["group"], row["group_description"], row["done"], row["schedule"],
                row["h2"], row["ignition"], row["vent"], row["p0"], row["t0"],
                row["data_files_count"], row["data_files"],
            ])


def _write_plan_pdf(plan_name, plan_meta, rows, target_path):
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
            # Keep export robust even if image parsing fails.
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

    page.insert_text((x0, y), f"EXDA Plan Export - {plan_name or 'Experiment Plan'}", fontname="courier-bold", fontsize=18, color=(0, 0, 0))
    y += 22
    _write_line("Responsible Researcher: PhD Student Javier I. Camacho")
    _write_line(f"Objective: {str((plan_meta or {}).get('objective') or '-')}")
    _write_line(f"Start: {str((plan_meta or {}).get('startDate') or '-')} | Deadline: {str((plan_meta or {}).get('deadline') or '-')}")
    _write_line(f"Total Experiments: {len(rows)}")
    _write_line(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    _write_line("")

    file_path_width = 50
    columns = [
        ("Run", 16), ("Done", 4), ("Schedule", 10),
        ("H2 (%)", 6), ("Ignition", 10), ("Vent", 10), ("P0 (Pa)", 8), ("T0 (K)", 6), ("Files", 5), ("File Path (Raw_Data Folder)", file_path_width),
    ]
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
        divider = "-+-".join("-" * width for _, width in columns)
        header = " | ".join(_clip(name, width) for name, width in columns)
        _write_line(header, bold=True)
        _write_line(divider)

        for row in entries:
            data_files_raw = str(row.get("data_files") or "").strip()
            file_chunks = [chunk.strip() for chunk in data_files_raw.split("|") if chunk.strip()]
            if not file_chunks:
                file_chunks = ["-"]
            wrapped_file_paths = []
            for file_path in file_chunks:
                wraps = textwrap.wrap(
                    file_path,
                    width=file_path_width,
                    break_long_words=True,
                    break_on_hyphens=False,
                ) or ["-"]
                wrapped_file_paths.extend(wraps)

            first_line = " | ".join([
                _clip(row["run_name"], 16),
                _clip(row["done"], 4),
                _clip(row["schedule"], 10),
                _clip(row["h2"], 6),
                _clip(row["ignition"], 10),
                _clip(row["vent"], 10),
                _clip(row["p0"], 8),
                _clip(row["t0"], 6),
                _clip(row["data_files_count"], 5),
                _clip(wrapped_file_paths[0], file_path_width),
            ])
            _write_line(first_line)

            for extra_path in wrapped_file_paths[1:]:
                continuation_line = " | ".join([
                    _clip("", 16),
                    _clip("", 4),
                    _clip("", 10),
                    _clip("", 6),
                    _clip("", 10),
                    _clip("", 10),
                    _clip("", 8),
                    _clip("", 6),
                    _clip("", 5),
                    _clip(extra_path, file_path_width),
                ])
                _write_line(continuation_line)

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

    safe_records = records if isinstance(records, list) else []
    rows = []
    for item in safe_records:
        if not isinstance(item, dict):
            continue
        group = str(item.get("group") or "").strip()
        run_name = str(item.get("runName") or "").strip()
        raw_updated = str(item.get("updatedAt") or "").strip()
        updated_short = _iso_to_display_str(raw_updated, include_seconds=True)
        rows.append({
            "group": group,
            "run_name": run_name,
            "run_short": _short_run_name(group, run_name),
            "target_vol": _fmt(item.get("targetVol"), 2),
            "p_chamber_pa": _fmt(item.get("pChamberPa") or item.get("P_chamber_Pa") or item.get("ambPressure"), 0),
            "t_chamber_k": _fmt(item.get("tChamberK"), 2),
            "l_m": _fmt(item.get("lM"), 3),
            "w_m": _fmt(item.get("wM"), 3),
            "h_m": _fmt(item.get("hM"), 3),
            "vol_pipes_m3": _fmt(item.get("volPipesM3"), 3),
            "hotwire_assembly_m3": _fmt(item.get("hotwireAssemblyM3"), 3),
            "welded_parts_m3": _fmt(item.get("weldedPartsM3"), 3),
            "bolts_m3": _fmt(item.get("boltsM3"), 3),
            "v_chamber_corr_l": _fmt(_chamber_l(item), 2),
            "h2_mass_g": _fmt(item.get("mH2InjectedG") or item.get("h2MassG"), 3),
            "v_h2_inj_l": _fmt(_h2_inj_l(item), 2),
            "mfc_flow_slpm": _fmt(item.get("mfcFlowSlpm"), 2),
            "injection_time_s": _fmt(item.get("injectionTimeS"), 1),
            "injection_time_min": _fmt(item.get("injectionTimeMin"), 1),
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
        "Pchamber (Pa)",
        "Tchamber (K)",
        "H2 Injected (g)",
        "H2 Injected Volume (L)",
        "MFC Flow (SLPM)",
        "Fill Time (s)",
        "Fill Time (min)",
        "Notes",
        "Updated At",
    ]
    if shared_varies:
        headers = [
            "Group",
            "Run/Test",
            "Target H2 (%vol)",
            "Pchamber (Pa)",
            "Tchamber (K)",
            "L (m)",
            "W (m)",
            "H (m)",
            "Pipes + (m^3)",
            "Hotwire + (m^3)",
            "Welded - (m^3)",
            "Bolts - (m^3)",
            "Vchamber Corrected (L)",
            "H2 Injected (g)",
            "H2 Injected Volume (L)",
            "MFC Flow (SLPM)",
            "Fill Time (s)",
            "Fill Time (min)",
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
                    row["p_chamber_pa"],
                    row["t_chamber_k"],
                    row["l_m"],
                    row["w_m"],
                    row["h_m"],
                    row["vol_pipes_m3"],
                    row["hotwire_assembly_m3"],
                    row["welded_parts_m3"],
                    row["bolts_m3"],
                    row["v_chamber_corr_l"],
                    row["h2_mass_g"],
                    row["v_h2_inj_l"],
                    row["mfc_flow_slpm"],
                    row["injection_time_s"],
                    row["injection_time_min"],
                    row["notes"],
                    row["updated_at"],
                ])
            else:
                writer.writerow([
                    row["group"],
                    row["run_short"] or row["run_name"],
                    row["target_vol"],
                    row["p_chamber_pa"],
                    row["t_chamber_k"],
                    row["h2_mass_g"],
                    row["v_h2_inj_l"],
                    row["mfc_flow_slpm"],
                    row["injection_time_s"],
                    row["injection_time_min"],
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
    _write_line("Shared Chamber Setup (applies to all runs unless noted otherwise):", bold=True)
    _write_line(
        "L={L} m, W={W} m, H={H} m, Pipes+={P} m^3, Hotwire+={HW} m^3, Welded-={WD} m^3, Bolts-={B} m^3, Vcorr={VC} L".format(
            L=shared_setup.get("L (m)", "-"),
            W=shared_setup.get("W (m)", "-"),
            H=shared_setup.get("H (m)", "-"),
            P=shared_setup.get("Pipes + (m^3)", "-"),
            HW=shared_setup.get("Hotwire + (m^3)", "-"),
            WD=shared_setup.get("Welded - (m^3)", "-"),
            B=shared_setup.get("Bolts - (m^3)", "-"),
            VC=shared_setup.get("Vchamber Corrected (L)", "-"),
        )
    )
    if shared_varies:
        _write_line("Note: setup values vary across runs; detailed per-run setup table is included below.")
    _write_line("")

    core_columns = [
        ("Group", 14),
        ("Run/Test", 18),
        ("H2%", 5),
        ("Pch(Pa)", 8),
        ("Tch(K)", 7),
        ("H2(g)", 7),
        ("H2inj(L)", 8),
        ("MFC", 6),
        ("t(s)", 6),
        ("t(min)", 6),
        ("Updated", 19),
    ]
    setup_columns = [
        ("Group", 10),
        ("Run/Test", 14),
        ("L (m)", 5),
        ("W (m)", 5),
        ("H (m)", 5),
        ("Pipes+ (m3)", 11),
        ("Hotwire+ (m3)", 13),
        ("Welded- (m3)", 12),
        ("Bolts- (m3)", 11),
        ("Vcorr(L)", 8),
        ("Notes", 28),
    ]

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
            row.get("p_chamber_pa"),
            row.get("t_chamber_k"),
            row.get("h2_mass_g"),
            row.get("v_h2_inj_l"),
            row.get("mfc_flow_slpm"),
            row.get("injection_time_s"),
            row.get("injection_time_min"),
            row.get("updated_at"),
        ],
    )

    if shared_varies:
        _write_table(
            "Per-Run Chamber Setup (because values vary)",
            setup_columns,
            lambda row: [
                row.get("group"),
                row.get("run_name"),
                row.get("l_m"),
                row.get("w_m"),
                row.get("h_m"),
                row.get("vol_pipes_m3"),
                row.get("hotwire_assembly_m3"),
                row.get("welded_parts_m3"),
                row.get("bolts_m3"),
                row.get("v_chamber_corr_l"),
                row.get("notes"),
            ],
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
    window_start = _to_float(request.args.get('windowStart'))
    window_end = _to_float(request.args.get('windowEnd'))
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
            max_samples = 0 if full_resolution else 200000
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
            max_samples = 0 if full_resolution else 200000
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
        max_samples = 0 if full_resolution else 200000
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

    safe_records = []
    for item in records:
        if not isinstance(item, dict):
            continue
        safe_records.append({
            "group": str(item.get("group") or "").strip(),
            "runName": str(item.get("runName") or "").strip(),
            "targetVol": str(item.get("targetVol") or "").strip(),
            "pChamberPa": str(item.get("pChamberPa") or item.get("P_chamber_Pa") or item.get("ambPressure") or "").strip(),
            "tChamberK": str(item.get("tChamberK") or "").strip(),
            "mfcFlowSlpm": str(item.get("mfcFlowSlpm") or "").strip(),
            "lM": str(item.get("lM") or "").strip(),
            "wM": str(item.get("wM") or "").strip(),
            "hM": str(item.get("hM") or "").strip(),
            "volPipesM3": str(item.get("volPipesM3") or "").strip(),
            "hotwireAssemblyM3": str(item.get("hotwireAssemblyM3") or "").strip(),
            "weldedPartsM3": str(item.get("weldedPartsM3") or "").strip(),
            "boltsM3": str(item.get("boltsM3") or "").strip(),
            "tStdK": str(item.get("tStdK") or "").strip(),
            "pStdPa": str(item.get("pStdPa") or "").strip(),
            "ru": str(item.get("ru") or "").strip(),
            "mH2": str(item.get("mH2") or "").strip(),
            "mH2InjectedG": str(item.get("mH2InjectedG") or item.get("h2MassG") or "").strip(),
            "vH2StdL": str(item.get("vH2StdL") or "").strip(),
            "vChamberCorrectedM3": str(item.get("vChamberCorrectedM3") or "").strip(),
            "injectionTimeS": str(item.get("injectionTimeS") or "").strip(),
            "injectionTimeMin": str(item.get("injectionTimeMin") or "").strip(),
            "results": item.get("results") if isinstance(item.get("results"), dict) else None,
            "notes": str(item.get("notes") or "").strip(),
            "updatedAt": str(item.get("updatedAt") or "").strip(),
        })

    try:
        data = {
            "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "verificationMeta": verification_meta,
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


def _write_metadata_sections_csv(target_path, project_name, plan_payload, daq_payload, sensors_payload, gas_payload):
    plan_rows = _build_plan_export_rows(plan_payload.get("experiments"), plan_payload.get("meta"))
    daq_rows = _build_daq_export_rows(daq_payload.get("daqSystems"))
    sensor_rows = _build_sensors_export_rows(
        sensors_payload.get("mappingsByGroup"),
        group_notes=sensors_payload.get("groupNotes"),
        group_names=sensors_payload.get("groupNames"),
    )
    gas_rows = _build_gas_mixing_export_rows(gas_payload.get("records"))

    with open(target_path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Export Type", "Metadata Report"])
        writer.writerow(["Project", str(project_name or "-")])
        writer.writerow(["Responsible Researcher", "PhD Student Javier I. Camacho"])
        writer.writerow(["Generated At", _now_display_str(include_seconds=True)])
        writer.writerow(["Sections", "Plan, DAQ Systems, Sensors Mapping, Gas Mixing"])
        writer.writerow([])

        writer.writerow(["[TAB] Plan"])
        writer.writerow(["Run Name", "Group", "Group Description", "Done", "Schedule", "H2 (%)", "Ignition", "Vent", "P0 (Pa)", "T0 (K)", "Data Files Count", "File Path (Raw_Data Folder)"])
        for row in plan_rows:
            writer.writerow([
                row.get("run_name", ""),
                row.get("group", ""),
                row.get("group_description", ""),
                row.get("done", ""),
                row.get("schedule", ""),
                row.get("h2", ""),
                row.get("ignition", ""),
                row.get("vent", ""),
                row.get("p0", ""),
                row.get("t0", ""),
                row.get("data_files_count", ""),
                row.get("data_files", ""),
            ])
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

        writer.writerow(["[TAB] Gas Mixing"])
        writer.writerow(["Group", "Run/Test", "Target H2 (%vol)", "Pchamber (Pa)", "Tchamber (K)", "H2 Injected (g)", "H2 Injected Volume (L)", "MFC Flow (SLPM)", "Fill Time (s)", "Fill Time (min)", "Notes", "Updated At"])
        for row in gas_rows:
            writer.writerow([
                row.get("group", ""),
                row.get("run_short", "") or row.get("run_name", ""),
                row.get("target_vol", ""),
                row.get("p_chamber_pa", ""),
                row.get("t_chamber_k", ""),
                row.get("h2_mass_g", ""),
                row.get("v_h2_inj_l", ""),
                row.get("mfc_flow_slpm", ""),
                row.get("injection_time_s", ""),
                row.get("injection_time_min", ""),
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
    gas_payload = _load_gas_mixing_payload(project_root)

    try:
        if export_format == "csv":
            _write_metadata_sections_csv(
                target_path=target_path,
                project_name=project_name,
                plan_payload=plan_payload,
                daq_payload=daq_payload,
                sensors_payload=sensors_payload,
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
        gas_rows = _build_gas_mixing_export_rows(gas_payload.get("records"))
        plan_meta = plan_payload.get("meta") if isinstance(plan_payload.get("meta"), dict) else {}
        project_objective = str(plan_meta.get("objective") or "").strip() or "-"
        project_description = str(plan_meta.get("description") or "").strip() or "-"

        with tempfile.TemporaryDirectory(prefix="exda-meta-") as tmp_dir:
            plan_pdf = os.path.join(tmp_dir, "plan.pdf")
            daq_pdf = os.path.join(tmp_dir, "daq.pdf")
            sensors_pdf = os.path.join(tmp_dir, "sensors.pdf")
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
            cover.insert_text((36, 130), "Includes: Plan, DAQ Systems, Sensors Mapping, Gas Mixing", fontname="courier", fontsize=10, color=(0, 0, 0))
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

            for section_path in [plan_pdf, daq_pdf, sensors_pdf, gas_pdf]:
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
