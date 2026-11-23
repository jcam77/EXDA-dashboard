"""Signal parsing, filtering, and pressure/vent metric calculations.

EXDA-Check B1-B5: every processing step is explicit and recorded.

- Analysis runs on the samples it is given; nothing here decimates. The
  file-based entry point (``analyze_pressure_signal`` via
  ``/analyze_pressure_file``) is fed full-resolution data. Decimation is only
  used to build the plot series, with a min/max envelope so peaks stay visible.
- Units come from the file header when present. A channel in V is never
  converted to pressure. No magnitude-based unit guessing.
- Absolute -> gauge conversion uses the run's measured P0, never a constant.
- Baseline (zero-offset) correction is opt-in and recorded.
- Invalid filter settings are errors, not silent replacements. A filter that
  cannot be applied is an error, not an unfiltered result. Resampling onto a
  uniform grid is recorded.
"""

import re

import numpy as np
from modules.data_parser import parse_time_signal_content
try:
    from scipy import signal
except Exception:
    signal = None


class PressureAnalysisError(ValueError):
    """Raised for analysis settings or data that cannot be processed as asked."""


# Relative tolerance on the sample interval before a series counts as non-uniform.
UNIFORM_DT_TOLERANCE = 1e-3
PLOT_ENVELOPE_BINS = 2000

PRESSURE_UNIT_TO_KPA = {
    "pa": 1e-3,
    "hpa": 0.1,
    "mbar": 0.1,
    "kpa": 1.0,
    "bar": 100.0,
    "mpa": 1000.0,
    "psi": 6.894757293168361,
}
VOLTAGE_UNITS = {"v", "mv"}
UNIT_DISPLAY = {
    "pa": "Pa", "hpa": "hPa", "mbar": "mbar", "kpa": "kPa", "bar": "bar",
    "mpa": "MPa", "psi": "psi", "v": "V", "mv": "mV",
}
SUPPORTED_UNITS_TEXT = "bar, mbar, Pa, hPa, kPa, MPa, psi, V"


def normalize_unit(value):
    """Map a unit label to a canonical token, or '' when blank/unknown."""
    text = str(value or "").strip().lower()
    if not text or text in ("auto", "raw", "file", "from_file"):
        return ""
    compact = re.sub(r"[\s\[\]\(\)_\-]+", "", text)
    aliases = {
        "pa": "pa", "pascal": "pa", "pascals": "pa",
        "hpa": "hpa", "mbar": "mbar", "mbarg": "mbar",
        "kpa": "kpa", "kpag": "kpa", "kpaa": "kpa",
        "bar": "bar", "barg": "bar", "bara": "bar",
        "mpa": "mpa", "psi": "psi", "psig": "psi", "psia": "psi",
        "v": "v", "volt": "v", "volts": "v", "mv": "mv",
    }
    return aliases.get(compact, "unknown:" + text)


def unit_from_channel_label(label):
    """Extract a unit from a header label such as 'A1 (0.A1) [bar]' or 'p (Pa)'."""
    text = str(label or "").strip()
    if not text:
        return ""
    match = re.search(r"\[([^\[\]]+)\]\s*$", text)
    if not match:
        match = re.search(r"\(([^()]+)\)\s*$", text)
    if not match:
        return ""
    token = normalize_unit(match.group(1))
    return token if token and not token.startswith("unknown:") else ""


def parse_data_content(content, channel_index=0):
    """Parse time/value columns from delimited text content."""
    t, y, err = parse_time_signal_content(content, channel_index=channel_index)
    if err:
        print(f"Parser Error: {err}")
        return None, None
    return t, y


def _sample_interval_info(t):
    t = np.asarray(t, dtype=float)
    if t.size < 2:
        return None, True
    dt = np.diff(t)
    positive = dt[dt > 0]
    if positive.size == 0:
        return None, False
    dt_ref = float(np.median(positive))
    deviation = float(np.max(np.abs(dt - dt_ref))) / dt_ref
    return dt_ref, deviation <= UNIFORM_DT_TOLERANCE


def resample_uniform(t, y):
    """Resample a signal onto a uniform time grid (linear interpolation)."""
    t, y = np.asarray(t), np.asarray(y)
    if t.size < 2:
        return t, y, 1.0
    dt_raw = np.diff(t)
    dt_ref = np.median(dt_raw[dt_raw > 0]) if np.any(dt_raw > 0) else 1.0
    fs_ref = 1.0 / dt_ref
    n = int(np.round((t[-1] - t[0]) * fs_ref)) + 1
    t_uni = np.linspace(t[0], t[-1], n)
    return t_uni, np.interp(t_uni, t, y), fs_ref


def butterworth_filter(t, y, cutoff_hz, order):
    """Zero-phase low-pass Butterworth filter. Returns (t, y, info).

    Raises PressureAnalysisError instead of silently returning the unfiltered
    signal. Resamples onto a uniform grid only when the input is not uniform,
    and records that it did.
    """
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    cutoff_hz = validate_cutoff(cutoff_hz)
    order = validate_order(order)
    if signal is None:
        raise PressureAnalysisError("Filtering requires scipy, which is not installed.")
    if t.size < 10:
        raise PressureAnalysisError(f"Too few samples to filter ({t.size}).")

    dt_ref, uniform = _sample_interval_info(t)
    if dt_ref is None:
        raise PressureAnalysisError("Time axis has no increasing samples; cannot filter.")
    resampled = False
    if uniform:
        t_work, y_work, fs = t, y, 1.0 / dt_ref
    else:
        t_work, y_work, fs = resample_uniform(t, y)
        resampled = True
    nyquist = 0.5 * fs
    if cutoff_hz >= nyquist:
        raise PressureAnalysisError(
            f"Filter cutoff {cutoff_hz:g} Hz is at or above the Nyquist frequency "
            f"{nyquist:g} Hz (fs = {fs:g} Hz). Lower the cutoff or analyse unfiltered."
        )
    try:
        sos = signal.butter(order, cutoff_hz, fs=fs, btype="low", output="sos")
        y_out = signal.sosfiltfilt(sos, y_work)
    except Exception as exc:
        raise PressureAnalysisError(f"Butterworth filter failed: {exc}") from exc
    info = {
        "applied": True,
        "type": "Butterworth low-pass, zero-phase (sosfiltfilt)",
        "order": order,
        "cutoffHz": cutoff_hz,
        "fsHz": fs,
        "resampled": resampled,
        "resamplingNote": (
            "Non-uniform time axis linearly interpolated onto a uniform grid before filtering."
            if resampled else "Uniform time axis; no resampling."
        ),
    }
    return t_work, y_out, info


def apply_butterworth(t, y, cutoff_hz, order):
    """Apply low-pass Butterworth filtering. Raises if it cannot be applied."""
    t_out, y_out, _ = butterworth_filter(t, y, cutoff_hz, order)
    return t_out, y_out


def validate_cutoff(value):
    try:
        cutoff = float(value)
    except (TypeError, ValueError):
        raise PressureAnalysisError(f"Invalid filter cutoff: {value!r}.") from None
    if not np.isfinite(cutoff) or cutoff <= 0:
        raise PressureAnalysisError(f"Filter cutoff must be a positive number of Hz (got {value!r}).")
    return cutoff


def validate_order(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise PressureAnalysisError(f"Invalid filter order: {value!r}.") from None
    if not np.isfinite(number) or number < 1 or number != int(number):
        raise PressureAnalysisError(f"Filter order must be a whole number >= 1 (got {value!r}).")
    return int(number)


def _normalize_impulse_drop(user_setting):
    """Normalize impulse cutoff setting into a [0, 1] decay fraction."""
    # Expected as a fraction in [0, 1].
    # Backward compatibility: values > 1 are interpreted as percentages (e.g., 5 -> 5%).
    try:
        value = float(user_setting)
    except (TypeError, ValueError):
        raise PressureAnalysisError(f"Invalid impulse end threshold: {user_setting!r}.") from None
    if not np.isfinite(value) or value <= 0:
        raise PressureAnalysisError(f"Impulse end threshold must be > 0 (got {user_setting!r}).")
    if value > 1.0:
        value = value / 100.0
    return float(np.clip(value, 0.001, 1.0))


def calculate_metrics(t, y, user_setting=0.05):
    """Compute pMax, tMax, impulse, and impulse integration status."""
    if len(y) == 0:
        return 0.0, 0.0, 0.0, "No Data"
    idx_max = np.argmax(y)
    p_max, t_max = y[idx_max], t[idx_max]
    if p_max <= 0:
        return p_max, t_max, 0.0, "Peak <= 0"

    cutoff_fraction = _normalize_impulse_drop(user_setting)
    threshold = cutoff_fraction * p_max
    below = np.where(y[idx_max:] <= threshold)[0]
    if len(below) > 0:
        idx_cutoff = idx_max + below[0]
        status = f"End threshold {cutoff_fraction * 100:.1f}% Pmax reached"
    else:
        idx_cutoff = len(y) - 1
        status = f"End threshold {cutoff_fraction * 100:.1f}% Pmax not reached; integrated to end"

    # Prefer `trapezoid`, but keep compatibility with environments that still expose `trapz`.
    integrate = getattr(np, "trapezoid", None)
    if integrate is None:
        integrate = getattr(np, "trapz", None)
    if integrate is None:
        raise AttributeError("NumPy integration helper not available")
    impulse = integrate(y[: idx_cutoff + 1], t[: idx_cutoff + 1])
    return p_max, t_max, impulse, status


def envelope_plot_series(t, y, max_bins=PLOT_ENVELOPE_BINS):
    """Reduce a series for plotting by keeping each bin's min and max sample.

    Unlike index picking, the global peak (and every local extreme at bin
    level) is always kept. For plotting only; metrics never use this.
    """
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    n = t.size
    if n <= 2 * max_bins:
        return [{"t": float(t[i]), "p": float(y[i])} for i in range(n)]
    edges = np.linspace(0, n, max_bins + 1).astype(np.int64)
    points = []
    for start, end in zip(edges[:-1], edges[1:]):
        if end <= start:
            continue
        segment = y[start:end]
        i_min = start + int(np.argmin(segment))
        i_max = start + int(np.argmax(segment))
        for idx in sorted({i_min, i_max}):
            points.append({"t": float(t[idx]), "p": float(y[idx])})
    return points


def _convert_units(y, unit_token, convert_to_kpa):
    """Return (values, output_unit_display, note)."""
    if unit_token in VOLTAGE_UNITS:
        return y, UNIT_DISPLAY[unit_token], "Voltage channel: kept in volts, never converted to pressure."
    if not unit_token:
        return y, "raw", "Unit unknown (no unit in file and none selected): values not converted."
    display = UNIT_DISPLAY[unit_token]
    if not convert_to_kpa or unit_token == "kpa":
        return y, display, f"Values in {display} as recorded (no unit conversion)."
    factor = PRESSURE_UNIT_TO_KPA[unit_token]
    return y * factor, "kPa", f"Converted {display} -> kPa (x{factor:g})."


def _resolve_unit(file_unit, input_unit):
    """Decide the input unit. The file header wins; a conflicting selection is an error."""
    file_token = normalize_unit(file_unit)
    selected = normalize_unit(input_unit)
    for token, origin in ((file_token, "file header"), (selected, "selection")):
        if token.startswith("unknown:"):
            raise PressureAnalysisError(
                f"Unsupported unit {token.split(':', 1)[1]!r} from {origin}. Supported: {SUPPORTED_UNITS_TEXT}."
            )
    if file_token and selected and file_token != selected:
        raise PressureAnalysisError(
            f"Selected unit {UNIT_DISPLAY[selected]} conflicts with the unit in the file header "
            f"({UNIT_DISPLAY[file_token]}). Choose 'From file' or the file's unit."
        )
    if file_token:
        return file_token, "file header"
    if selected:
        return selected, "user selection"
    return "", "unknown"


def _apply_reference(y, unit_token, output_unit, reference, p0_pa, p0_source):
    """Absolute -> gauge using the run's measured P0. Returns (values, info)."""
    ref = str(reference or "gauge").strip().lower()
    if ref not in ("gauge", "absolute"):
        raise PressureAnalysisError(f"Pressure reference must be 'gauge' or 'absolute' (got {reference!r}).")
    info = {"reference": ref, "p0Pa": None, "p0Source": None, "p0Subtracted": None}
    if ref == "gauge":
        info["note"] = "Gauge (overpressure): values used as recorded, no P0 subtraction."
        return y, info
    if unit_token in VOLTAGE_UNITS or not unit_token:
        raise PressureAnalysisError(
            "Absolute -> gauge conversion needs a pressure channel with a known unit."
        )
    try:
        p0 = float(p0_pa)
    except (TypeError, ValueError):
        p0 = None
    if p0 is None or not np.isfinite(p0) or p0 <= 0:
        raise PressureAnalysisError(
            "Absolute pressure selected, but the run's measured P0 is missing or invalid. "
            "Enter P0 for this run in the Plan; no default (101325 Pa) is used."
        )
    if output_unit == "kPa":
        p0_out = p0 / 1000.0
    else:
        p0_out = p0 * 1e-3 / PRESSURE_UNIT_TO_KPA[unit_token]
    info.update({
        "p0Pa": p0,
        "p0Source": p0_source or "request",
        "p0Subtracted": p0_out,
        "note": f"Absolute -> gauge: subtracted P0 = {p0:g} Pa ({p0_source or 'request'}).",
    })
    return y - p0_out, info


def _apply_baseline(t, y, baseline, output_unit):
    cfg = baseline if isinstance(baseline, dict) else {}
    if not cfg.get("enabled"):
        return y, {"applied": False, "note": "Baseline correction not applied (off by default)."}
    method = str(cfg.get("method") or "mean").strip().lower()
    if method not in ("mean", "median"):
        raise PressureAnalysisError(f"Baseline method must be 'mean' or 'median' (got {method!r}).")
    try:
        start = float(cfg.get("start"))
        end = float(cfg.get("end"))
    except (TypeError, ValueError):
        raise PressureAnalysisError("Baseline window start and end (s) are required when baseline is on.") from None
    if not (np.isfinite(start) and np.isfinite(end)) or end <= start:
        raise PressureAnalysisError("Baseline window must have start < end (s).")
    mask = (t >= start) & (t <= end)
    count = int(np.count_nonzero(mask))
    if count == 0:
        raise PressureAnalysisError(f"Baseline window {start:g}..{end:g} s contains no samples.")
    offset = float(np.mean(y[mask]) if method == "mean" else np.median(y[mask]))
    return y - offset, {
        "applied": True,
        "method": method,
        "windowStart": start,
        "windowEnd": end,
        "samples": count,
        "offset": offset,
        "unit": output_unit,
        "note": f"Baseline: subtracted {method} {offset:.6g} {output_unit} from {start:g}..{end:g} s ({count} samples).",
    }


def _crop(t, y, window_start, window_end):
    start = None if window_start is None else float(window_start)
    end = None if window_end is None else float(window_end)
    if start is None and end is None:
        return t, y, None
    if start is not None and end is not None and start > end:
        start, end = end, start
    mask = np.ones(t.shape, dtype=bool)
    if start is not None:
        mask &= t >= start
    if end is not None:
        mask &= t <= end
    if not np.any(mask):
        raise PressureAnalysisError("Selected analysis time window has no samples.")
    return t[mask], y[mask], {"start": start, "end": end}


def analyze_pressure_signal(
    t,
    y,
    *,
    file_unit="",
    input_unit="auto",
    convert_to_kpa=True,
    reference="gauge",
    p0_pa=None,
    p0_source=None,
    baseline=None,
    use_raw=False,
    cutoff=100.0,
    order=4,
    impulse_drop=0.05,
    window_start=None,
    window_end=None,
    source=None,
):
    """Full pressure processing chain with a complete processing record.

    Order: crop window -> unit conversion -> absolute/gauge -> baseline ->
    filter -> metrics. Raises PressureAnalysisError on invalid settings.
    """
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    finite = np.isfinite(t) & np.isfinite(y)
    dropped = int(t.size - np.count_nonzero(finite))
    t, y = t[finite], y[finite]
    if t.size == 0:
        raise PressureAnalysisError("No finite samples to analyse.")
    order_idx = np.argsort(t, kind="stable")
    t, y = t[order_idx], y[order_idx]

    t, y, window = _crop(t, y, window_start, window_end)
    impulse_fraction = _normalize_impulse_drop(impulse_drop)

    unit_token, unit_origin = _resolve_unit(file_unit, input_unit)
    y, output_unit, unit_note = _convert_units(y, unit_token, bool(convert_to_kpa))
    y, reference_info = _apply_reference(y, unit_token, output_unit, reference, p0_pa, p0_source)
    y, baseline_info = _apply_baseline(t, y, baseline, output_unit)

    dt_ref, uniform = _sample_interval_info(t)
    fs_in = (1.0 / dt_ref) if dt_ref else None
    warnings = []
    if dropped:
        warnings.append(f"{dropped} non-finite samples ignored.")
    if not uniform:
        warnings.append("Time axis is not uniform.")
    if not unit_token:
        warnings.append("Unit unknown: values not converted.")

    if use_raw:
        t_proc, p_proc = t, y
        filter_info = {
            "applied": False,
            "type": None,
            "order": None,
            "cutoffHz": None,
            "fsHz": fs_in,
            "resampled": False,
            "note": "Unfiltered (raw) analysis requested.",
        }
    else:
        t_proc, p_proc, filter_info = butterworth_filter(t, y, cutoff, order)

    p_max, t_max, impulse, status = calculate_metrics(t_proc, p_proc, impulse_fraction)
    if warnings:
        status = f"{status}. " + " ".join(warnings)

    processing = {
        "source": source or {},
        "samplesAnalysed": int(t_proc.size),
        "samplesInput": int(t.size),
        "fsHz": fs_in,
        "uniformTimeAxis": bool(uniform),
        "decimation": "none (all samples used for metrics)",
        "window": window,
        "unit": {
            "input": UNIT_DISPLAY.get(unit_token, "unknown"),
            "origin": unit_origin,
            "fileUnit": str(file_unit or ""),
            "output": output_unit,
            "note": unit_note,
        },
        "reference": reference_info,
        "baseline": baseline_info,
        "filter": filter_info,
        "impulseEndFraction": impulse_fraction,
        "plot": f"min/max envelope over {PLOT_ENVELOPE_BINS} bins (display only)",
        "warnings": warnings,
    }
    return {
        "metrics": {
            "pMax": f"{p_max:.4f}",
            "tMax": f"{t_max:.4f}",
            "impulse": f"{impulse:.4f}",
            "status": status,
            "pressureUnit": output_unit,
            "unitNote": unit_note,
            "filterApplied": bool(filter_info.get("applied")),
            "fsHz": filter_info.get("fsHz") or fs_in,
            "samplesAnalysed": int(t_proc.size),
        },
        "processing": processing,
        "plot_data": envelope_plot_series(t_proc, p_proc),
    }


def channel_label_from_content(content, channel_index=0):
    """Return the header label of the selected signal column in text content, if any."""
    from modules import data_parser  # local import to avoid widening the module API

    lines = data_parser._clean_lines(content or "")
    if not lines:
        return ""
    header_tokens = None
    if data_parser._looks_like_multichannel_waveform(lines):
        for line in lines:
            if line.lower().startswith("time;"):
                header_tokens = [p.strip() for p in line.split(";")]
                break
    else:
        header_tokens, _ = data_parser._extract_header_row(lines)
    if not header_tokens:
        return ""
    time_col = data_parser._select_time_column(header_tokens, len(header_tokens))
    signal_cols = data_parser._select_signal_columns(header_tokens, len(header_tokens), time_col)
    if not signal_cols:
        return ""
    chosen = signal_cols[min(max(0, int(channel_index)), len(signal_cols) - 1)]
    return header_tokens[chosen] if chosen < len(header_tokens) else ""


def analyze_pressure_content(
    content,
    cutoff=100.0,
    order=4,
    impulse_drop=0.05,
    use_raw=False,
    channel_index=0,
    input_unit="auto",
    convert_to_kpa=True,
    reference="gauge",
    p0_pa=None,
    p0_source=None,
    baseline=None,
):
    """Analyse pressure text content. Returns {'error': ...} on failure."""
    t, val = parse_data_content(content, channel_index=channel_index)
    if t is None:
        return {"error": "Parse Error"}
    label = channel_label_from_content(content, channel_index)
    try:
        return analyze_pressure_signal(
            t,
            val,
            file_unit=unit_from_channel_label(label),
            input_unit=input_unit,
            convert_to_kpa=convert_to_kpa,
            reference=reference,
            p0_pa=p0_pa,
            p0_source=p0_source,
            baseline=baseline,
            use_raw=use_raw,
            cutoff=cutoff,
            order=order,
            impulse_drop=impulse_drop,
            source={"kind": "content", "channelIndex": int(channel_index), "channelLabel": label},
        )
    except PressureAnalysisError as exc:
        return {"error": str(exc)}


def calculate_vent_time(t, b, threshold=0.5):
    """Estimate vent opening time from a threshold crossing trace."""
    if len(b) < 2:
        return None
    crossings = np.where((b[:-1] >= threshold) & (b[1:] < threshold))[0]
    if len(crossings) > 0:
        idx = crossings[0]
        return t[idx] + (t[idx + 1] - t[idx]) * (threshold - b[idx]) / (b[idx + 1] - b[idx])
    return None


def analyze_vent_content(content):
    """Analyze vent trace content and return tVent with plot-ready data."""
    t, val = parse_data_content(content)
    if t is None:
        return {"error": "Parse Error"}
    t_vent = calculate_vent_time(t, val)
    step = max(1, len(t) // 2000)
    return {
        "metrics": {
            "tVent": f"{t_vent:.4f}" if t_vent is not None else "N/A"
        },
        "plot_data": [
            {"t": float(t[i]), "p": float(val[i])} for i in range(0, len(t), step)
        ],
    }
