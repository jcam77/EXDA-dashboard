import io
import numpy as np
from scipy import signal


def parse_data_content(content):
    try:
        f = io.StringIO(content)
        lines = [line.strip() for line in f if not line.strip().startswith("#")]
        if not lines:
            return None, None
        data = np.loadtxt(io.StringIO("\n".join(lines).replace(",", " ")))
        if data.ndim == 1:
            data = data.reshape(1, -1)
        t, y = data[:, 0], data[:, 1]
        idx = np.argsort(t)
        return t[idx], y[idx]
    except Exception as e:
        print(f"Parser Error: {e}")
        return None, None


def resample_uniform(t, y):
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
    if len(t) < 10:
        return t, y
    t_uni, y_uni, fs = resample_uniform(t, y)
    if cutoff_hz >= 0.5 * fs:
        return t_uni, y_uni
    try:
        sos = signal.butter(order, cutoff_hz, fs=fs, btype="low", output="sos")
        return t_uni, signal.sosfiltfilt(sos, y_uni)
    except Exception as e:
        print(f"Butterworth Error: {e}")
        return t_uni, y_uni


def calculate_metrics(t, y, user_setting=1.0):
    if len(y) == 0:
        return 0.0, 0.0, 0.0, "No Data"
    idx_max = np.argmax(y)
    p_max, t_max = y[idx_max], t[idx_max]
    if p_max <= 0:
        return p_max, t_max, 0.0, "Peak <= 0"

    cutoff_fraction = 0.05 if user_setting >= 0.99 else (1.0 if user_setting <= 0.01 else user_setting)
    status = "Full Pulse" if user_setting >= 0.99 else f"Decay {int(cutoff_fraction * 100)}%"

    if cutoff_fraction >= 0.99:
        idx_cutoff = idx_max
    else:
        below = np.where(y[idx_max:] < cutoff_fraction * p_max)[0]
        idx_cutoff = idx_max + below[0] if len(below) > 0 else len(y) - 1

    impulse = np.trapz(y[: idx_cutoff + 1], t[: idx_cutoff + 1])
    return p_max, t_max, impulse, status


def calculate_vent_time(t, b, threshold=0.5):
    if len(b) < 2:
        return None
    crossings = np.where((b[:-1] >= threshold) & (b[1:] < threshold))[0]
    if len(crossings) > 0:
        idx = crossings[0]
        return t[idx] + (t[idx + 1] - t[idx]) * (threshold - b[idx]) / (b[idx + 1] - b[idx])
    return None


def analyze_pressure_content(content, cutoff=100.0, order=4, impulse_drop=1.0, use_raw=False):
    t, val = parse_data_content(content)
    if t is None:
        return {"error": "Parse Error"}

    if np.max(np.abs(val)) > 1000:
        val = (val - 101325.0) / 1000.0

    if use_raw:
        t_proc, p_proc = t, val
    else:
        t_proc, p_proc = apply_butterworth(t, val, float(cutoff), int(order))

    p_max, t_max, impulse, status = calculate_metrics(t_proc, p_proc, float(impulse_drop))
    step = max(1, len(t_proc) // 2000)
    return {
        "metrics": {
            "pMax": f"{p_max:.4f}",
            "tMax": f"{t_max:.4f}",
            "impulse": f"{impulse:.4f}",
            "status": status,
        },
        "plot_data": [
            {"t": float(t_proc[i]), "p": float(p_proc[i])} for i in range(0, len(t_proc), step)
        ],
    }


def analyze_vent_content(content):
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
