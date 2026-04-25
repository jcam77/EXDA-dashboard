"""Signal parsing, filtering, and pressure/vent metric calculations."""

import numpy as np
from modules.data_parser import normalize_pressure_to_kpa, parse_time_signal_content
try:
    from scipy import signal
except Exception:
    signal = None


def parse_data_content(content, channel_index=0):
    """Parse time/value columns from delimited text content."""
    t, y, err = parse_time_signal_content(content, channel_index=channel_index)
    if err:
        print(f"Parser Error: {err}")
        return None, None
    return t, y


def resample_uniform(t, y):
    """Resample a signal onto a uniform time grid."""
    t, y = np.asarray(t), np.asarray(y)
    if t.size < 2:
        return t, y, 1.0
    dt_raw = np.diff(t)
    dt_ref = np.median(dt_raw[dt_raw > 0]) if np.any(dt_raw > 0) else 1.0
    fs_ref = 1.0 / dt_ref
    n = int(np.round((t[-1] - t[0]) * fs_ref)) + 1
    t_uni = np.linspace(t[0], t[-1], n)
    return t_uni, np.interp(t_uni, t, y), fs_ref


def apply_butterworth(t, y, cutoff_hz, order):
    """Apply low-pass Butterworth filtering with safe fallbacks."""
    if len(t) < 10:
        return t, y
    t_uni, y_uni, fs = resample_uniform(t, y)
    if signal is None:
        # Fallback when scipy is unavailable in packaged environments.
        return t_uni, y_uni
    if cutoff_hz >= 0.5 * fs:
        return t_uni, y_uni
    try:
        sos = signal.butter(order, cutoff_hz, fs=fs, btype="low", output="sos")
        return t_uni, signal.sosfiltfilt(sos, y_uni)
    except Exception as e:
        print(f"Butterworth Error: {e}")
        return t_uni, y_uni


def _normalize_impulse_drop(user_setting):
    """Normalize impulse cutoff setting into a [0, 1] decay fraction."""
    # Expected as a fraction in [0, 1].
    # Backward compatibility: values > 1 are interpreted as percentages (e.g., 5 -> 5%).
    try:
        value = float(user_setting)
    except (TypeError, ValueError):
        return 0.05
    if not np.isfinite(value) or value <= 0:
        return 0.05
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

    # Use `trapezoid` to avoid NumPy deprecation warnings; fall back for older NumPy.
    integrate = getattr(np, "trapezoid", np.trapz)
    impulse = integrate(y[: idx_cutoff + 1], t[: idx_cutoff + 1])
    return p_max, t_max, impulse, status


def calculate_vent_time(t, b, threshold=0.5):
    """Estimate vent opening time from a threshold crossing trace."""
    if len(b) < 2:
        return None
    crossings = np.where((b[:-1] >= threshold) & (b[1:] < threshold))[0]
    if len(crossings) > 0:
        idx = crossings[0]
        return t[idx] + (t[idx + 1] - t[idx]) * (threshold - b[idx]) / (b[idx + 1] - b[idx])
    return None


def analyze_pressure_content(
    content,
    cutoff=100.0,
    order=4,
    impulse_drop=0.05,
    use_raw=False,
    channel_index=0,
    input_unit="auto",
    convert_to_kpa=True,
):
    """Analyze pressure trace content and return metrics with plot-ready data."""
    t, val = parse_data_content(content, channel_index=channel_index)
    if t is None:
        return {"error": "Parse Error"}

    try:
        cutoff = float(cutoff)
    except (TypeError, ValueError):
        cutoff = 100.0
    if not np.isfinite(cutoff) or cutoff <= 0:
        cutoff = 100.0

    try:
        order = int(float(order))
    except (TypeError, ValueError):
        order = 4
    if order < 1:
        order = 1

    try:
        impulse_drop = float(impulse_drop)
    except (TypeError, ValueError):
        impulse_drop = 0.05
    if not np.isfinite(impulse_drop):
        impulse_drop = 0.05

    val, unit_note, pressure_unit = normalize_pressure_to_kpa(
        val,
        content=content,
        input_unit=input_unit,
        convert_to_kpa=bool(convert_to_kpa),
    )

    if use_raw:
        t_proc, p_proc = t, val
    else:
        t_proc, p_proc = apply_butterworth(t, val, cutoff, order)

    p_max, t_max, impulse, status = calculate_metrics(t_proc, p_proc, impulse_drop)
    step = max(1, len(t_proc) // 2000)
    return {
        "metrics": {
            "pMax": f"{p_max:.4f}",
            "tMax": f"{t_max:.4f}",
            "impulse": f"{impulse:.4f}",
            "status": status,
            "pressureUnit": pressure_unit,
            "unitNote": unit_note,
        },
        "plot_data": [
            {"t": float(t_proc[i]), "p": float(p_proc[i])} for i in range(0, len(t_proc), step)
        ],
    }


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
