"""State routes for loading project files, plan data, and raw-data inventory."""

from flask import Blueprint, jsonify, request
import json
from datetime import datetime
import os
import re
import csv
import textwrap

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

    _write_line(f"EXDA Plan Export - {plan_name or 'Experiment Plan'}", bold=True)
    _write_line("Responsible Researcher: PhD Student Javier I. Camacho")
    _write_line(f"Objective: {str((plan_meta or {}).get('objective') or '-')}")
    _write_line(f"Start: {str((plan_meta or {}).get('startDate') or '-')} | Deadline: {str((plan_meta or {}).get('deadline') or '-')}")
    _write_line(f"Total Experiments: {len(rows)}")
    _write_line(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    _write_line("")

    file_path_width = 45
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

    doc.save(target_path)
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

    _write_line("EXDA DAQ Systems Export", bold=True)
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
        channel_counts = {}
        for item in safe_sensors:
            record = item if isinstance(item, dict) else {}
            sensor_id = str(record.get("sensorId") or "").strip().lower()
            if sensor_id:
                sensor_id_counts[sensor_id] = sensor_id_counts.get(sensor_id, 0) + 1
            if bool(record.get("isActive")):
                daq_system = str(record.get("daqSystem") or "").strip().lower()
                daq_channel = str(record.get("daqChannel") or "").strip().lower()
                if daq_system and daq_channel:
                    key = f"{daq_system}::{daq_channel}"
                    channel_counts[key] = channel_counts.get(key, 0) + 1

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
                "status": "Reference only (no sensor changes)",
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
            mounting = str(record.get("mountingMethod") or "").strip()
            manufacturer = str(record.get("manufacturer") or "").strip()
            model = str(record.get("model") or "").strip()
            notes = str(record.get("notes") or "").strip()
            is_active = bool(record.get("isActive"))
            is_blind = bool(record.get("isBlindSensor"))

            status_errors = []
            if not sensor_id:
                status_errors.append("missing sensor id")
            elif sensor_id_counts.get(sensor_id.lower(), 0) > 1:
                status_errors.append("duplicate sensor id")
            if is_active and not daq_system:
                status_errors.append("missing DAQ system")
            if is_active and not daq_channel:
                status_errors.append("missing DAQ channel")
            if is_active and daq_system and daq_channel:
                key = f"{daq_system.lower()}::{daq_channel.lower()}"
                if channel_counts.get(key, 0) > 1:
                    status_errors.append("duplicate active DAQ channel")
            if not serial:
                status_errors.append("missing serial")
            if _to_float(sensitivity) is None or (_to_float(sensitivity) is not None and _to_float(sensitivity) <= 0):
                status_errors.append("invalid sensitivity")
            if not sensitivity_unit:
                status_errors.append("missing sensitivity unit")
            if _to_float(x) is None or _to_float(y) is None or _to_float(z) is None:
                status_errors.append("invalid coordinates")
            if not coordinate_origin:
                status_errors.append("missing coordinate origin")
            if not mounting:
                status_errors.append("missing mounting")

            status = "Complete" if not status_errors else f"Missing/Invalid ({'; '.join(status_errors[:2])})"
            coordinates = f"x={x or '-'}, y={y or '-'}, z={z or '-'} {coordinate_unit}".strip()
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
                "status": status,
                "notes": notes,
                "is_reference_only": False,
            })
    return rows


def _write_sensors_csv(rows, target_path, project_name=None):
    headers = [
        "Group",
        "Group Reference Note",
        "Sensor ID",
        "Measured Quantity",
        "DAQ System",
        "DAQ Channel",
        "Serial Number",
        "Manufacturer",
        "Model",
        "Sensitivity",
        "Location Label",
        "Coordinates",
        "Coordinate Origin",
        "Mounting Method",
        "Active",
        "Blind/Control",
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
        writer.writerow(headers)
        for row in rows:
            writer.writerow([
                row["group"],
                row["group_note"],
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
                row["status"],
                row["notes"],
            ])


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

    _write_line("EXDA Sensors Mapping Export", bold=True)
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
        ("Group", 8),
        ("Group Note", 16),
        ("Sensor", 9),
        ("Qty", 7),
        ("DAQ", 8),
        ("Ch", 5),
        ("Serial", 9),
        ("Sensitivity", 10),
        ("Location", 8),
        ("Coordinates", 13),
        ("Mount", 7),
        ("Active", 6),
        ("Blind", 5),
        ("Status", 10),
    ]
    divider = "-+-".join("-" * width for _, width in columns)
    header = " | ".join(_clip(name, width) for name, width in columns)
    _write_line(header, bold=True)
    _write_line(divider)

    previous_group = None
    for row in rows:
        current_group = str(row.get("group") or "")
        if previous_group is None:
            _write_line("")
            _write_line(f"Group: {current_group or '-'}", bold=True)
        elif current_group != previous_group:
            _write_line("")
            _write_line("=" * len(divider), bold=False)
            _write_line(f"Group: {current_group or '-'}", bold=True)
        previous_group = current_group

        row_values = [
            row.get("group"),
            row.get("group_note"),
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

    return jsonify({
        "success": True,
        "plan": plan_data,
        "project_status": project_status,
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

    plan_dir = os.path.join(project_root, "Plan")
    file_path = os.path.join(plan_dir, DAQ_SYSTEMS_FILENAME)

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
        return jsonify({"success": True, "daqSystems": daq_systems, "path": file_path})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@state_bp.route('/save_daq_systems', methods=['POST'])
def save_daq_systems():
    """Persist DAQ systems metadata in Plan/daq_systems.json."""
    payload = request.json or {}
    project_path = payload.get("projectPath")
    daq_systems = payload.get("daqSystems")
    if not isinstance(daq_systems, list):
        return jsonify({"success": False, "error": "daqSystems must be a list"}), 400

    project_root, err = project_manager.resolve_project_path(project_path, require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400

    plan_dir = os.path.join(project_root, "Plan")
    os.makedirs(plan_dir, exist_ok=True)
    file_path = os.path.join(plan_dir, DAQ_SYSTEMS_FILENAME)
    if not project_manager.is_path_within(plan_dir, file_path):
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
    """Persist sensors mapping metadata in Plan/sensors_mapping.json."""
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

    plan_dir = os.path.join(project_root, "Plan")
    os.makedirs(plan_dir, exist_ok=True)
    file_path = os.path.join(plan_dir, SENSORS_MAPPING_FILENAME)
    if not project_manager.is_path_within(plan_dir, file_path):
        return jsonify({"success": False, "error": "Invalid sensors mapping path"}), 400

    safe_groups = {}
    for key, value in mappings_by_group.items():
        group_name = str(key or "").strip()
        if not group_name:
            continue
        safe_groups[group_name] = value if isinstance(value, list) else []

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
