"""Empirical Wavelet Transform analysis pipeline for pressure signals."""

import numpy as np
from scipy import signal
from modules.data_parser import normalize_pressure_to_kpa, parse_time_signal_content

try:
    import ewtpy
    HAS_EWT = True
except Exception:
    HAS_EWT = False

try:
    import pywt
    HAS_PYWT = True
except Exception:
    HAS_PYWT = False


def parse_data_content(content, channel_index=0):
    """Parse time/signal columns from raw text content."""
    return parse_time_signal_content(content, channel_index=channel_index)


def resample_uniform(t, y):
    """Resample irregular samples onto a uniform time basis."""
    t = np.asarray(t)
    y = np.asarray(y)
    if t.size < 2:
        return t, y, 1.0
    dt_raw = np.diff(t)
    dt_raw = dt_raw[dt_raw > 0]
    if dt_raw.size == 0:
        return t, y, 1.0
    dt_ref = np.median(dt_raw)
    fs_ref = 1.0 / dt_ref
    duration = t[-1] - t[0]
    n = int(np.round(duration * fs_ref)) + 1
    t_uni = np.linspace(t[0], t[-1], n)
    y_uni = np.interp(t_uni, t, y)
    return t_uni, y_uni, fs_ref


def perform_dwt_analysis(y, level=4):
    """Compute SWT/DWT modes as a fallback spectral decomposition."""
    if not HAS_PYWT:
        return np.array([y])
    if level <= 0:
        return np.array([y])

    original_len = len(y)
    # SWT needs length to be a multiple of 2**level. Pad if needed.
    use_level = int(level)
    min_len = 2 ** use_level
    if original_len < min_len:
        use_level = int(np.floor(np.log2(max(original_len, 1))))
        if use_level <= 0:
            return np.array([y])

    block = 2 ** use_level
    target_len = int(np.ceil(original_len / block) * block)
    if target_len != original_len:
        y = np.pad(y, (0, target_len - original_len), mode='edge')

    coeffs = pywt.swt(y, "db4", level=use_level)
    modes = [coeffs[-1][0]] + [c[1] for c in reversed(coeffs)]
    modes_arr = np.array(modes)
    if modes_arr.shape[1] > original_len:
        modes_arr = modes_arr[:, :original_len]
    return modes_arr


def perform_ewt_analysis(y, fs, max_num_peaks=5):
    """Run EWT decomposition and return modes or an error message."""
    if not HAS_EWT:
        return None, "EWT library unavailable"
    try:
        ewt, _, _ = ewtpy.EWT1D(y, N=max_num_peaks)
        return ewt.T, None
    except Exception as e:
        return None, f"EWT failed ({e})"


def calculate_energy(modes):
    """Compute absolute and relative mode energies."""
    energies = [float(np.sum(m ** 2)) for m in modes]
    total = sum(energies) if sum(energies) > 0 else 1.0
    pcts = [float((e / total) * 100.0) for e in energies]
    return energies, pcts


def downsample_plot_data(t, raw, modes, max_points=2000):
    """Prepare downsampled raw/mode data for frontend plotting."""
    if len(t) == 0:
        return []
    safe_max_points = int(max_points) if max_points and int(max_points) > 0 else 2000
    # Use ceil so returned points are truly bounded by max_points.
    step = max(1, int(np.ceil(len(t) / safe_max_points)))
    plot = []
    for i in range(0, len(t), step):
        row = {"time": float(t[i]), "raw": float(raw[i])}
        for m_idx, m in enumerate(modes):
            row[f"mode_{m_idx}"] = float(m[i])
        plot.append(row)
    return plot


def _resolve_knee_modes(max_num_peaks, knee_modes=None):
    """Resolve internal mode count used for knee estimation."""
    if knee_modes is None:
        return max(2, min(10, max(int(max_num_peaks), 8)))
    try:
        candidate = int(knee_modes)
    except (TypeError, ValueError):
        return max(2, min(10, max(int(max_num_peaks), 8)))
    return max(2, min(10, max(int(max_num_peaks), candidate)))


def analyze_ewt_content(
    content,
    max_num_peaks=5,
    num_modes=None,
    max_points=2000,
    knee_modes=None,
    channel_index=0,
    input_unit="auto",
    convert_to_kpa=True,
):
    """Run full EWT workflow and return summary, modes, and recommendations."""
    # Backward compatibility: accept legacy num_modes if provided by older callers.
    if num_modes is not None:
        max_num_peaks = num_modes
    max_num_peaks = max(1, min(10, int(max_num_peaks)))

    t, y, err = parse_data_content(content, channel_index=channel_index)
    if err:
        return {"error": err}
    y, unit_note, pressure_unit = normalize_pressure_to_kpa(
        y,
        content=content,
        input_unit=input_unit,
        convert_to_kpa=bool(convert_to_kpa),
    )

    t_uni, y_uni, fs = resample_uniform(t, y)
    modes, warning = perform_ewt_analysis(y_uni, fs, max_num_peaks=max_num_peaks)
    if modes is None:
        return {"error": warning or "EWT failed"}
    energies, pcts = calculate_energy(modes)
    plot_data = downsample_plot_data(t_uni, y_uni, modes, max_points=max_points)
    energy_table = []
    for i in range(len(energies)):
        mode = modes[i]
        f, pxx = signal.periodogram(mode, fs)
        if len(f) > 1:
            valid = f > 0
            if np.any(valid):
                peak_f = float(f[valid][np.argmax(pxx[valid])])
            else:
                peak_f = float(f[np.argmax(pxx)])
        else:
            peak_f = 0.0
        guess = "Acoustic Oscillations"
        if peak_f < 30:
            guess = "Flame Propagation + Hydrodynamic/Diffusion Instabilities"
        elif peak_f < 100:
            guess = "External Explosion + Helmholtz Oscillations"
        elif peak_f > 350:
            guess = "High Frequency Oscillations"
        energy_table.append({
            "mode": i,
            "energy": energies[i],
            "pct": pcts[i],
            "peakHz": peak_f,
            "guess": guess
        })

    def knee_from_curve(freqs, cum_pct):
        if len(freqs) < 2:
            return None, None, None
        f_norm = (freqs - freqs[0]) / (freqs[-1] - freqs[0]) if freqs[-1] != freqs[0] else np.zeros_like(freqs)
        c_norm = (cum_pct - cum_pct[0]) / (cum_pct[-1] - cum_pct[0]) if cum_pct[-1] != cum_pct[0] else np.zeros_like(cum_pct)
        distances = np.abs(c_norm - f_norm) / np.sqrt(2)
        knee_idx = int(np.argmax(distances))
        return knee_idx, float(freqs[knee_idx]), float(cum_pct[knee_idx])

    suggestion = None
    cumulative = []
    ewt_cumulative = []
    mode_spectrum = []
    knee_modes = _resolve_knee_modes(max_num_peaks=max_num_peaks, knee_modes=knee_modes)

    knee_modes_data, knee_warning = perform_ewt_analysis(y_uni, fs, max_num_peaks=knee_modes)
    knee_energies, knee_pcts = calculate_energy(knee_modes_data)
    knee_energy_table = []
    for i in range(len(knee_energies)):
        mode = knee_modes_data[i]
        f, pxx = signal.periodogram(mode, fs)
        if len(f) > 1:
            valid = f > 0
            if np.any(valid):
                peak_f = float(f[valid][np.argmax(pxx[valid])])
            else:
                peak_f = float(f[np.argmax(pxx)])
        else:
            peak_f = 0.0
        knee_energy_table.append({
            "mode": i,
            "pct": knee_pcts[i],
            "peakHz": peak_f
        })

    mode_spectrum = [
        {
            "mode": row["mode"],
            "freq": float(row["peakHz"]),
            "energyPct": float(row["pct"])
        }
        for row in knee_energy_table
        if row["peakHz"] and row["peakHz"] > 0
    ]

    if knee_warning and warning:
        warning = f"{warning}; {knee_warning}"
    elif knee_warning and not warning:
        warning = knee_warning

    freq_energy = [
        (row["peakHz"], row["pct"])
        for row in knee_energy_table
        if row["peakHz"] and row["peakHz"] > 0
    ]
    if len(freq_energy) >= 2:
        freq_energy.sort(key=lambda x: x[0])
        freqs = np.array([x[0] for x in freq_energy], dtype=float)
        cum = np.cumsum([x[1] for x in freq_energy])
        total = cum[-1] if cum[-1] > 0 else 1.0
        cum_pct = (cum / total) * 100.0

        ewt_cumulative = [
            {"freq": float(freqs[i]), "energyPct": float(cum_pct[i])}
            for i in range(len(freqs))
        ]
        cumulative = ewt_cumulative

        target_pct = 95.0
        idx_target = int(np.argmax(cum_pct >= target_pct)) if np.any(cum_pct >= target_pct) else len(cum_pct) - 1
        cutoff_target = float(freqs[idx_target])
        suggestion = {
            "cutoffHz": float(np.round(cutoff_target, 1)),
            "basis": "Energy-retention target",
            "note": f"Cutoff chosen as the lowest mode-peak frequency where cumulative energy reaches {target_pct:.0f}% (estimated using {knee_modes} EWT MRA components)."
        }
    if suggestion is None:
        warning = warning or "Insufficient EWT mode peaks to estimate cutoff; try increasing modes or checking input data."

    return {
        "summary": {
            "samples": int(len(t_uni)),
            "fs": float(fs),
            "maxNumPeaks": int(modes.shape[0]),
            "numModes": int(modes.shape[0]),
            "usesEWT": bool(HAS_EWT),
            "usesPyWT": bool(HAS_PYWT),
            "kneeModesUsed": int(knee_modes),
            "pressureUnit": pressure_unit,
            "unitNote": unit_note,
            "suggestedFilter": suggestion
        },
        "energy": energy_table,
        "modeSpectrum": mode_spectrum,
        "ewtCumulative": ewt_cumulative,
        "cumulative": cumulative,
        "plot_data": plot_data,
        "warning": warning
    }
