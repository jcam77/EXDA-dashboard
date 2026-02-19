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
    """Parse numeric table with optional header; return one selected signal."""
    header, numeric_lines = _extract_header_row(lines)
    data, err = _parse_numeric_table(numeric_lines)
    if err is not None and header is not None:
        # Fallback if first line looked like header but was actually numeric.
        data, err = _parse_numeric_table(lines)
        if err is not None:
            return None, None, err
        header = None
    elif err is not None:
        return None, None, err

    if data.shape[1] < 2:
        return None, None, "Expected at least 2 numeric columns (time + signal)"

    time_col = _select_time_column(header, data.shape[1])
    signal_cols = _select_signal_columns(header, data.shape[1], time_col)
    if not signal_cols:
        return None, None, "No signal columns detected"

    t = data[:, time_col]
    y = data[:, signal_cols[0]]
    idx = np.argsort(t)
    return t[idx], y[idx], None


def _split_tokens(line: str) -> list[str]:
    """Split one row into tokens using common separators."""
    if ";" in line:
        return [p.strip() for p in line.split(";") if p.strip() != ""]
    if "," in line:
        return [p.strip() for p in line.split(",") if p.strip() != ""]
    return [p.strip() for p in line.split() if p.strip() != ""]


def _extract_header_row(lines: list[str]):
    """Return (header_tokens_or_None, numeric_lines)."""
    if not lines:
        return None, lines
    first_tokens = _split_tokens(lines[0])
    if len(first_tokens) < 2:
        return None, lines
    has_text = any(_safe_float(tok) is None for tok in first_tokens)
    if has_text:
        return first_tokens, lines[1:]
    return None, lines


def _parse_numeric_table(lines: list[str]):
    """Parse a numeric table with 2+ columns from cleaned lines."""
    rows: list[list[float]] = []
    for line in lines:
        tokens = _split_tokens(line)
        if len(tokens) < 2:
            continue
        values: list[float] = []
        valid = True
        for token in tokens:
            value = _safe_float(token)
            if value is None:
                valid = False
                break
            values.append(float(value))
        if valid:
            rows.append(values)

    if not rows:
        return None, "No numeric rows found"

    min_cols = min(len(row) for row in rows)
    if min_cols < 2:
        return None, "Expected at least 2 numeric columns"
    table = np.asarray([row[:min_cols] for row in rows], dtype=float)
    return table, None


def _select_time_column(header_tokens, ncols: int) -> int:
    """Pick the most likely time column index."""
    if header_tokens:
        for idx, token in enumerate(header_tokens[:ncols]):
            low = token.strip().lower()
            if "time" in low or low in ("t", "t(s)", "time_s", "times"):
                return idx
    return 0


def _select_signal_columns(header_tokens, ncols: int, time_col: int) -> list[int]:
    """Pick likely signal columns excluding time/index metadata."""
    if header_tokens and len(header_tokens) >= ncols:
        cols = []
        for idx, token in enumerate(header_tokens[:ncols]):
            if idx == time_col:
                continue
            low = token.strip().lower()
            if "index" in low or low in ("idx", "sample", "sample_index"):
                continue
            cols.append(idx)
        if cols:
            return cols
    return [idx for idx in range(ncols) if idx != time_col]


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
        header, numeric_lines = _extract_header_row(lines)
        data, err = _parse_numeric_table(numeric_lines)
        if err is not None and header is not None:
            data, err = _parse_numeric_table(lines)
            header = None
        if err is not None:
            return None, None, err

        ncols = data.shape[1]
        if ncols < 2:
            return None, None, "Expected at least 2 numeric columns"

        time_col = _select_time_column(header, ncols)
        signal_cols = _select_signal_columns(header, ncols, time_col)
        if not signal_cols:
            return None, None, "No signal columns detected"

        chosen_idx = min(max(0, int(channel_index)), len(signal_cols) - 1)
        signal_col = signal_cols[chosen_idx]

        t = data[:, time_col]
        y = data[:, signal_col]
        idx = np.argsort(t)
        return t[idx], y[idx], None
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

    header, numeric_lines = _extract_header_row(lines)
    data, err = _parse_numeric_table(numeric_lines)
    if err is not None and header is not None:
        data, err = _parse_numeric_table(lines)
        header = None
    if err is not None:
        return None, None, None, err

    ncols = data.shape[1]
    if ncols < 2:
        return None, None, None, "Expected at least 2 numeric columns"

    time_col = _select_time_column(header, ncols)
    signal_cols = _select_signal_columns(header, ncols, time_col)
    if not signal_cols:
        return None, None, None, "No signal columns detected"

    t = data[:, time_col]
    y = data[:, signal_cols]
    idx = np.argsort(t)
    t = t[idx]
    y = y[idx, :]

    if header and len(header) >= ncols:
        names = []
        for col_idx, sig_col in enumerate(signal_cols):
            token = (header[sig_col] or "").strip()
            names.append(token if token else f"Signal {col_idx + 1}")
    else:
        names = [f"Signal {idx + 1}" for idx in range(len(signal_cols))]

    return t, y, names, None


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
