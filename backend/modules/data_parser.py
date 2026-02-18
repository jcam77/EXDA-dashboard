"""Common parsing helpers for raw time-series text content."""

from __future__ import annotations

import io
from datetime import datetime

import numpy as np


def _clean_lines(content: str) -> list[str]:
    """Return non-empty, non-comment lines from text content."""
    lines: list[str] = []
    for raw in io.StringIO(content):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        lines.append(line)
    return lines


def _safe_float(value: str):
    """Parse float and return None on failure."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(parsed):
        return None
    return parsed


def _parse_datetime(value: str):
    """Parse known acquisition datetime formats."""
    token = " ".join(str(value).strip().split())
    if not token:
        return None
    formats = (
        "%m/%d/%Y %H:%M:%S.%f",
        "%d/%m/%Y %H:%M:%S.%f",
    )
    for fmt in formats:
        try:
            return datetime.strptime(token, fmt)
        except ValueError:
            continue
    return None


def _looks_like_multichannel_waveform(lines: list[str]) -> bool:
    """Detect semicolon waveform exports with metadata/header rows."""
    if not lines:
        return False
    first = lines[0].lower()
    if first.startswith("waveform;"):
        return True
    for line in lines[:8]:
        low = line.lower()
        if low.startswith("time;") and ("y[" in low or ";[" in low):
            return True
    return False


def _parse_numeric_two_column(lines: list[str]):
    """Parse standard numeric files with at least two columns."""
    data = np.loadtxt(io.StringIO("\n".join(lines).replace(",", " ")))
    if data.ndim == 1:
        data = data.reshape(1, -1)
    if data.shape[1] < 2:
        return None, None, "Expected at least 2 columns (time + signal)"
    t = data[:, 0]
    y = data[:, 1]
    idx = np.argsort(t)
    return t[idx], y[idx], None


def _parse_semicolon_multichannel(lines: list[str], channel_index: int = 0):
    """Parse acquisition exports: metadata + time;Y[0];Y[1]... rows."""
    header_idx = None
    header_parts = None
    delta_t = None

    for idx, line in enumerate(lines):
        low = line.lower()
        if low.startswith("delta t;"):
            parts = [p.strip() for p in line.split(";")]
            for token in parts[1:]:
                candidate = _safe_float(token)
                if candidate is not None and candidate > 0:
                    delta_t = candidate
                    break
        if low.startswith("time;"):
            header_idx = idx
            header_parts = [p.strip() for p in line.split(";")]
            break

    if header_idx is None or not header_parts:
        return None, None, "Missing 'time;...' header row"

    preferred_col = 1 + max(0, int(channel_index))
    if preferred_col < len(header_parts):
        value_col = preferred_col
    else:
        value_col = 1 if len(header_parts) > 1 else None
    if value_col is None:
        return None, None, "Missing channel columns"

    time_tokens: list[str] = []
    y_values: list[float] = []
    for line in lines[header_idx + 1 :]:
        parts = [p.strip() for p in line.split(";")]
        if len(parts) <= value_col:
            continue
        y_val = _safe_float(parts[value_col])
        if y_val is None:
            continue
        y_values.append(float(y_val))
        time_tokens.append(parts[0])

    if not y_values:
        return None, None, "No numeric waveform rows found"

    y = np.asarray(y_values, dtype=float)

    if delta_t is not None and delta_t > 0:
        t = np.arange(len(y), dtype=float) * float(delta_t)
        return t, y, None

    t_numeric = []
    numeric_ok = True
    for token in time_tokens:
        parsed = _safe_float(token)
        if parsed is None:
            numeric_ok = False
            break
        t_numeric.append(float(parsed))
    if numeric_ok and len(t_numeric) == len(y):
        t = np.asarray(t_numeric, dtype=float)
        idx = np.argsort(t)
        return t[idx], y[idx], None

    if len(time_tokens) >= 2:
        t0 = _parse_datetime(time_tokens[0])
        t1 = _parse_datetime(time_tokens[1])
        if t0 is not None and t1 is not None:
            dt = (t1 - t0).total_seconds()
            if np.isfinite(dt) and dt > 0:
                t = np.arange(len(y), dtype=float) * float(dt)
                return t, y, None

    return None, None, "Could not infer time axis for multichannel waveform file"


def _parse_semicolon_multichannel_all(lines: list[str]):
    """Parse acquisition exports and return time + all numeric channels."""
    header_idx = None
    header_parts = None
    delta_t = None

    for idx, line in enumerate(lines):
        low = line.lower()
        if low.startswith("delta t;"):
            parts = [p.strip() for p in line.split(";")]
            for token in parts[1:]:
                candidate = _safe_float(token)
                if candidate is not None and candidate > 0:
                    delta_t = candidate
                    break
        if low.startswith("time;"):
            header_idx = idx
            header_parts = [p.strip() for p in line.split(";")]
            break

    if header_idx is None or not header_parts or len(header_parts) < 2:
        return None, None, None, "Missing 'time;...' header row"

    channel_names = [name or f"Y[{i}]" for i, name in enumerate(header_parts[1:])]
    value_cols = list(range(1, len(header_parts)))
    y_rows: list[list[float]] = []
    time_tokens: list[str] = []

    for line in lines[header_idx + 1 :]:
        parts = [p.strip() for p in line.split(";")]
        if len(parts) < len(header_parts):
            continue
        row: list[float] = []
        valid = True
        for col in value_cols:
            val = _safe_float(parts[col])
            if val is None:
                valid = False
                break
            row.append(float(val))
        if not valid:
            continue
        y_rows.append(row)
        time_tokens.append(parts[0])

    if not y_rows:
        return None, None, None, "No numeric waveform rows found"

    y = np.asarray(y_rows, dtype=float)

    if delta_t is not None and delta_t > 0:
        t = np.arange(y.shape[0], dtype=float) * float(delta_t)
        return t, y, channel_names, None

    t_numeric = []
    numeric_ok = True
    for token in time_tokens:
        parsed = _safe_float(token)
        if parsed is None:
            numeric_ok = False
            break
        t_numeric.append(float(parsed))
    if numeric_ok and len(t_numeric) == y.shape[0]:
        t = np.asarray(t_numeric, dtype=float)
        idx = np.argsort(t)
        return t[idx], y[idx, :], channel_names, None

    if len(time_tokens) >= 2:
        t0 = _parse_datetime(time_tokens[0])
        t1 = _parse_datetime(time_tokens[1])
        if t0 is not None and t1 is not None:
            dt = (t1 - t0).total_seconds()
            if np.isfinite(dt) and dt > 0:
                t = np.arange(y.shape[0], dtype=float) * float(dt)
                return t, y, channel_names, None

    return None, None, None, "Could not infer time axis for multichannel waveform file"


def parse_time_signal_content(content: str, channel_index: int = 0):
    """Parse raw text content into time and one selected signal channel."""
    lines = _clean_lines(content)
    if not lines:
        return None, None, "No data rows found"

    if _looks_like_multichannel_waveform(lines):
        t, y, err = _parse_semicolon_multichannel(lines, channel_index=channel_index)
        if err is None:
            return t, y, None

    try:
        return _parse_numeric_two_column(lines)
    except Exception as exc:
        return None, None, str(exc)


def parse_multichannel_content(content: str):
    """Parse raw text into time axis + all channels when available."""
    lines = _clean_lines(content)
    if not lines:
        return None, None, None, "No data rows found"

    if _looks_like_multichannel_waveform(lines):
        t, y, names, err = _parse_semicolon_multichannel_all(lines)
        if err is None:
            return t, y, names, None

    t, y, err = _parse_numeric_two_column(lines)
    if err is not None:
        return None, None, None, err
    return t, y.reshape(-1, 1), ["Signal"], None


def is_multichannel_waveform_content(content: str) -> bool:
    """Return True if content matches the semicolon waveform export layout."""
    lines = _clean_lines(content)
    return _looks_like_multichannel_waveform(lines)


def normalize_pressure_to_kpa(values, content: str = "", input_unit: str = "auto", convert_to_kpa: bool = True):
    """Normalize pressure samples and return (values, note, output_unit)."""
    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return arr, None, "raw"

    unit = str(input_unit or "auto").strip().lower()

    def _output_unit_from_input(input_name: str):
        mapping = {
            "bar": "bar",
            "barg": "bar",
            "kpa": "kPa",
            "kpag": "kPa",
            "pa": "Pa",
            "pascal": "Pa",
            "pascals": "Pa",
            "v": "V",
            "volt": "V",
            "volts": "V",
        }
        return mapping.get(input_name, "raw")

    if not convert_to_kpa:
        if unit == "auto":
            return arr, "Raw units retained (no conversion applied).", "raw"
        return arr, f"Raw units retained as {_output_unit_from_input(unit)} (no conversion applied).", _output_unit_from_input(unit)

    if unit in ("bar", "barg"):
        return arr * 100.0, "Pressure converted from bar to kPa (x100).", "kPa"
    if unit in ("pa", "pascal", "pascals"):
        return (arr - 101325.0) / 1000.0, "Pressure converted from Pa to kPa ((p-101325)/1000).", "kPa"
    if unit in ("kpa", "kpag"):
        return arr, None, "kPa"
    if unit in ("v", "volt", "volts"):
        return arr, "Voltage channel kept in raw volts (no pressure conversion).", "V"

    max_abs = float(np.max(np.abs(arr)))
    if max_abs > 1000.0:
        return (arr - 101325.0) / 1000.0, "Pressure converted from Pa to kPa ((p-101325)/1000).", "kPa"

    # Acquisition waveform exports are typically in bar gauge; treat moderate values as bar.
    if is_multichannel_waveform_content(content) and max_abs <= 50.0:
        return arr * 100.0, "Pressure converted from bar to kPa (x100).", "kPa"

    return arr, "Auto unit detection kept raw values (no conversion).", "raw"
