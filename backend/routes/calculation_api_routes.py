"""Calculation API routes for pressure, vent, flame, EWT, and plot interpolation."""

import csv
from pathlib import Path

import numpy as np
from flask import Blueprint, jsonify, request

from modules import data_parser, ewt_analysis, flame_analysis, plot_interpolation, pressure_analysis

calculation_api_bp = Blueprint("calculation_api", __name__)
TESTS_DIR = Path(__file__).resolve().parents[1] / "tests"
REFERENCE_DATA_DIR = TESTS_DIR / "reference_data"
RESULTS_DIR = TESTS_DIR / "results"
LEGACY_FIXTURES_DIR = TESTS_DIR / "fixtures"
PRESSURE_METRICS_CANDIDATES = (
    RESULTS_DIR / "pressure_metrics_octave.csv",
    LEGACY_FIXTURES_DIR / "pressure_metrics_octave.csv",
    LEGACY_FIXTURES_DIR / "matlab_pressure_metrics.csv",
)
EWT_REFERENCE_CANDIDATES = (
    RESULTS_DIR / "ewt_peak_metrics_octave.csv",
    LEGACY_FIXTURES_DIR / "ewt_peak_metrics_octave.csv",
    LEGACY_FIXTURES_DIR / "octave_ewt_peak_reference.csv",
)
VERIFICATION_CLEAN_CANDIDATES = (
    REFERENCE_DATA_DIR / "experimental_data_001_clean.csv",
    LEGACY_FIXTURES_DIR / "experimental_data_001_clean.csv",
)
VERIFICATION_NOISY_CANDIDATES = (
    REFERENCE_DATA_DIR / "experimental_data_001_noisy.csv",
    LEGACY_FIXTURES_DIR / "experimental_data_001_noisy.csv",
)


def _first_existing_path(paths):
    """Return the first existing path from a candidate list, else the first path."""
    for path in paths:
        if path.exists():
            return path
    return paths[0]


def _read_fixture_signal(csv_path: Path):
    """Read a two-column fixture CSV as sorted time and pressure arrays."""
    data = np.loadtxt(csv_path, delimiter=",")
    if data.ndim != 2 or data.shape[1] < 2:
        raise ValueError(f"Expected at least two columns in {csv_path.name}")
    t = data[:, 0]
    p = data[:, 1]
    idx = np.argsort(t)
    return t[idx], p[idx]


def _normalize_pressure_units(values):
    """Apply the same Pa->kPa normalization rule used by pressure analysis."""
    arr = np.asarray(values, dtype=float)
    if arr.size and float(np.max(np.abs(arr))) > 1000.0:
        return (arr - 101325.0) / 1000.0
    return arr


def _series_to_content(t, p):
    """Render numeric arrays to the parser format expected by calculation modules."""
    return "\n".join(f"{float(ti):.12g} {float(pi):.12g}" for ti, pi in zip(t, p))


def _safe_float(value, default):
    """Parse float with fallback."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if not np.isfinite(parsed):
        return default
    return parsed


def _safe_int(value, default):
    """Parse int with fallback."""
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return default
    return parsed


def _safe_bool(value, default):
    """Parse bool with fallback."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        token = value.strip().lower()
        if token in ("1", "true", "yes", "on"):
            return True
        if token in ("0", "false", "no", "off"):
            return False
    return default


def _load_matlab_metrics():
    """Load optional MATLAB/Octave-exported metrics keyed by series name."""
    metrics_path = _first_existing_path(PRESSURE_METRICS_CANDIDATES)
    if not metrics_path.exists():
        return {}
    metrics = {}
    with metrics_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            series = (row.get("series") or row.get("dataset") or "").strip().lower()
            if not series:
                continue
            metrics[series] = {
                "pMax": row.get("pMax", "").strip(),
                "tMax": row.get("tMax", "").strip(),
                "impulse": row.get("impulse", "").strip(),
                "status": row.get("status", "").strip(),
            }
    return metrics


def _load_octave_ewt_reference():
    """Load optional Octave EWT mode peak/fraction rows."""
    reference_path = _first_existing_path(EWT_REFERENCE_CANDIDATES)
    if not reference_path.exists():
        return []
    rows = []
    with reference_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            try:
                rows.append(
                    {
                        "mode": int(float(row.get("mode", 0))),
                        "octavePeakHz": float(row.get("peak_hz", 0.0)),
                        "octaveEnergyPct": float(row.get("energy_pct", 0.0)),
                    }
                )
            except (TypeError, ValueError):
                continue
    return rows


@calculation_api_bp.route('/analyze', methods=['POST'])
def analyze():
    """Analyze payload content using the requested data type."""
    try:
        req = request.json or {}
        content = req.get('content', '')
        data_type = req.get('dataType', 'pressure')
        channel_index = max(0, _safe_int(req.get('channelIndex', 0), 0))
        pressure_unit = str(req.get('pressureUnit', 'auto') or 'auto')
        convert_to_kpa = _safe_bool(req.get('convertToKpa', True), True)
        if data_type == 'flame_speed':
            x, v = flame_analysis.calculate_flame_speed(content)
            return jsonify({"plot_data": [{'x': px, 'v': pv} for px, pv in zip(x, v)]})
        if data_type == 'vent':
            result = pressure_analysis.analyze_vent_content(content)
            if result.get("error"):
                return jsonify({"error": result["error"]}), 400
            return jsonify(result)
        result = pressure_analysis.analyze_pressure_content(
            content,
            cutoff=req.get('cutoff', 100),
            order=req.get('order', 4),
            impulse_drop=req.get('impulseDrop', 0.05),
            use_raw=bool(req.get('useRaw', False)),
            channel_index=channel_index,
            input_unit=pressure_unit,
            convert_to_kpa=convert_to_kpa,
        )
        if result.get("error"):
            return jsonify({"error": result["error"]}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@calculation_api_bp.route('/analyze_pressure', methods=['POST'])
def analyze_pressure():
    """Analyze pressure content and return metrics plus downsampled series."""
    try:
        req = request.json or {}
        content = req.get('content', '')
        if not content:
            return jsonify({"error": "Missing content"}), 400
        channel_index = max(0, _safe_int(req.get('channelIndex', 0), 0))
        pressure_unit = str(req.get('pressureUnit', 'auto') or 'auto')
        convert_to_kpa = _safe_bool(req.get('convertToKpa', True), True)
        result = pressure_analysis.analyze_pressure_content(
            content,
            cutoff=req.get('cutoff', 100),
            order=req.get('order', 4),
            impulse_drop=req.get('impulseDrop', 0.05),
            use_raw=bool(req.get('useRaw', False)),
            channel_index=channel_index,
            input_unit=pressure_unit,
            convert_to_kpa=convert_to_kpa,
        )
        if result.get("error"):
            return jsonify({"error": result["error"]}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@calculation_api_bp.route('/analyze_vent', methods=['POST'])
def analyze_vent():
    """Analyze vent trace and extract vent opening timing."""
    try:
        req = request.json or {}
        content = req.get('content', '')
        if not content:
            return jsonify({"error": "Missing content"}), 400
        result = pressure_analysis.analyze_vent_content(content)
        if result.get("error"):
            return jsonify({"error": result["error"]}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@calculation_api_bp.route('/aggregate_plot', methods=['POST'])
def aggregate_plot():
    """Interpolate and merge multiple analyzed series to a common plot grid."""
    try:
        req = request.json or {}
        plot_data = plot_interpolation.aggregate_plot_data(req)
        return jsonify({"plotData": plot_data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@calculation_api_bp.route('/analyze_ewt', methods=['POST'])
def analyze_ewt():
    """Run Empirical Wavelet Transform analysis for a pressure signal."""
    try:
        req = request.json or {}
        content = req.get('content', '')
        if not content:
            return jsonify({"error": "Missing content"}), 400
        num_modes = int(req.get('numModes', 5))
        max_points = int(req.get('maxPoints', 2000))
        num_modes = max(1, min(10, num_modes))
        channel_index = max(0, _safe_int(req.get('channelIndex', 0), 0))
        pressure_unit = str(req.get('pressureUnit', 'auto') or 'auto')
        convert_to_kpa = _safe_bool(req.get('convertToKpa', True), True)
        result = ewt_analysis.analyze_ewt_content(
            content,
            num_modes=num_modes,
            max_points=max_points,
            channel_index=channel_index,
            input_unit=pressure_unit,
            convert_to_kpa=convert_to_kpa,
        )
        if result.get("error"):
            return jsonify({"error": result["error"]}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@calculation_api_bp.route('/preview_multichannel', methods=['POST'])
def preview_multichannel():
    """Parse and downsample a multichannel text signal for Clean Data plotting."""
    try:
        req = request.json or {}
        content = req.get('content', '')
        if not content:
            return jsonify({"error": "Missing content"}), 400

        full_resolution = _safe_bool(req.get('fullResolution', False), False)
        max_points = _safe_int(req.get('maxPoints', 1500), 1500)
        max_points = max(100, min(2_000_000, max_points))

        t, y, channel_names, err = data_parser.parse_multichannel_content(content)
        if err:
            return jsonify({"error": err}), 400

        if t is None or y is None or y.size == 0:
            return jsonify({"error": "No numeric data parsed"}), 400

        sample_count = int(t.shape[0])
        channel_count = int(y.shape[1])
        plotted_count = sample_count

        if (not full_resolution) and sample_count > max_points:
            idx = np.linspace(0, sample_count - 1, max_points, dtype=int)
            idx = np.unique(idx)
            t_plot = t[idx]
            y_plot = y[idx, :]
            plotted_count = int(len(idx))
        else:
            t_plot = t
            y_plot = y

        plot_data = []
        for row_idx in range(plotted_count):
            row = {"t": float(t_plot[row_idx])}
            for col_idx in range(channel_count):
                key = f"ch_{col_idx}"
                row[key] = float(y_plot[row_idx, col_idx])
            plot_data.append(row)

        sampling_rate_hz = None
        if sample_count > 1:
            dt = np.diff(t)
            dt = dt[np.isfinite(dt) & (dt > 0)]
            if dt.size > 0:
                sampling_rate_hz = float(1.0 / np.median(dt))

        channels = []
        inferred_units = ["raw"] * channel_count
        inferred_roles = ["signal"] * channel_count
        labels = channel_names or [f"Channel {idx + 1}" for idx in range(channel_count)]
        labels_lower = [str(label).strip().lower() for label in labels]
        is_waveform = data_parser.is_multichannel_waveform_content(content)

        # 1) Direct name-based hints.
        trigger_keywords = ("trigger", "trig", "ign", "ttl", "volt", "voltage")
        for idx, label in enumerate(labels_lower):
            if any(token in label for token in trigger_keywords):
                inferred_units[idx] = "V"
                inferred_roles[idx] = "trigger"

        # 1b) Common acquisition convention:
        # waveform exports with generic Y[n] labels often use the last channel as trigger voltage.
        generic_y_labels = all(label.startswith("y[") and label.endswith("]") for label in labels_lower)
        if is_waveform and generic_y_labels and channel_count >= 4:
            last_idx = channel_count - 1
            if inferred_units[last_idx] == "raw":
                inferred_units[last_idx] = "V"
                inferred_roles[last_idx] = "trigger"

        # 2) Acquisition-layout heuristic: last channel is often trigger voltage.
        if channel_count >= 4 and all(unit == "raw" for unit in inferred_units):
            max_abs = np.max(np.abs(y), axis=0)
            last_idx = channel_count - 1
            median_other = float(np.median(max_abs[:-1])) if channel_count > 1 else 0.0
            if median_other > 0.0 and float(max_abs[last_idx]) >= 10.0 * median_other:
                inferred_units[last_idx] = "V"
                inferred_roles[last_idx] = "trigger"

        # 3) Pressure channels default to bar for waveform exports when not trigger-like.
        if is_waveform:
            for idx in range(channel_count):
                if inferred_units[idx] == "raw":
                    inferred_units[idx] = "bar"
                    inferred_roles[idx] = "pressure"

        for idx, label in enumerate(labels):
            channels.append(
                {
                    "index": idx,
                    "key": f"ch_{idx}",
                    "label": label,
                    "unit": inferred_units[idx],
                    "role": inferred_roles[idx],
                }
            )

        return jsonify(
            {
                "plotData": plot_data,
                "channels": channels,
                "summary": {
                    "sampleCount": sample_count,
                    "plottedCount": plotted_count,
                    "channelCount": channel_count,
                    "samplingRateHz": sampling_rate_hz,
                    "downsampleApplied": plotted_count < sample_count,
                    "fullResolution": full_resolution,
                    "hasMixedUnits": len(set(inferred_units)) > 1,
                },
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@calculation_api_bp.route('/calculation_verification', methods=['GET'])
def calculation_verification():
    """Return clean/noisy verification series and Python-vs-MATLAB/Octave metrics."""
    try:
        decay_percent = _safe_float(request.args.get("decayPercent", 95.0), 95.0)
        decay_percent = float(np.clip(decay_percent, 0.0, 99.9))
        impulse_drop = float(np.clip((100.0 - decay_percent) / 100.0, 0.001, 1.0))

        cutoff_hz = _safe_float(request.args.get("cutoffHz", 20.0), 20.0)
        cutoff_hz = max(1e-6, cutoff_hz)

        order = int(round(_safe_float(request.args.get("order", 4), 4.0)))
        order = max(1, min(10, order))
        ewt_num_modes = int(round(_safe_float(request.args.get("ewtNumModes", 5), 5.0)))
        ewt_num_modes = max(1, min(10, ewt_num_modes))
        ewt_max_points = int(round(_safe_float(request.args.get("ewtMaxPoints", 1200), 1200.0)))
        ewt_max_points = max(200, min(5000, ewt_max_points))

        clean_path = _first_existing_path(VERIFICATION_CLEAN_CANDIDATES)
        noisy_path = _first_existing_path(VERIFICATION_NOISY_CANDIDATES)
        missing = [path.name for path in (clean_path, noisy_path) if not path.exists()]
        if missing:
            return jsonify({"error": f"Missing verification reference data: {', '.join(missing)}"}), 404

        t_clean, p_clean = _read_fixture_signal(clean_path)
        t_noisy, p_noisy = _read_fixture_signal(noisy_path)

        p_clean_norm = _normalize_pressure_units(p_clean)
        p_noisy_norm = _normalize_pressure_units(p_noisy)
        t_filtered, p_filtered_norm = pressure_analysis.apply_butterworth(
            t_noisy, p_noisy_norm, cutoff_hz=cutoff_hz, order=order
        )

        clean_content = _series_to_content(t_clean, p_clean)
        noisy_content = _series_to_content(t_noisy, p_noisy)

        python_metrics = {
            "clean_raw": pressure_analysis.analyze_pressure_content(
                clean_content, cutoff=cutoff_hz, order=order, impulse_drop=impulse_drop, use_raw=True
            ).get("metrics", {}),
            "noisy_raw": pressure_analysis.analyze_pressure_content(
                noisy_content, cutoff=cutoff_hz, order=order, impulse_drop=impulse_drop, use_raw=True
            ).get("metrics", {}),
            "noisy_filtered": pressure_analysis.analyze_pressure_content(
                noisy_content, cutoff=cutoff_hz, order=order, impulse_drop=impulse_drop, use_raw=False
            ).get("metrics", {}),
        }

        ewt_raw = ewt_analysis.analyze_ewt_content(
            noisy_content,
            num_modes=ewt_num_modes,
            max_points=ewt_max_points,
        )
        if ewt_raw.get("error"):
            ewt_data = None
            ewt_error = ewt_raw.get("error")
        else:
            ewt_data = ewt_raw
            ewt_error = None

        plot_data = plot_interpolation.aggregate_plot_data(
            {
                "activeTab": "pressure_analysis",
                "series": [
                    {
                        "displayName": "Clean (reference)",
                        "plotData": [{"t": float(t), "p": float(p)} for t, p in zip(t_clean, p_clean_norm)],
                    },
                    {
                        "displayName": "Noisy (input)",
                        "plotData": [{"t": float(t), "p": float(p)} for t, p in zip(t_noisy, p_noisy_norm)],
                    },
                    {
                        "displayName": "Noisy filtered",
                        "plotData": [{"t": float(t), "p": float(p)} for t, p in zip(t_filtered, p_filtered_norm)],
                    },
                ],
            }
        )

        matlab_metrics = _load_matlab_metrics()
        octave_ewt_reference = _load_octave_ewt_reference()
        python_ewt_peaks = {}
        if ewt_data and isinstance(ewt_data.get("energy"), list):
            for row in ewt_data["energy"]:
                try:
                    python_ewt_peaks[int(row.get("mode", 0))] = float(row.get("peakHz", 0.0))
                except (TypeError, ValueError):
                    continue
        ewt_alignment = []
        for row in octave_ewt_reference:
            mode = row.get("mode")
            octave_peak = row.get("octavePeakHz")
            python_peak = python_ewt_peaks.get(mode)
            if python_peak is None or not np.isfinite(python_peak):
                abs_delta = None
            elif octave_peak is None or not np.isfinite(octave_peak):
                abs_delta = None
            else:
                abs_delta = float(abs(float(python_peak) - float(octave_peak)))
            ewt_alignment.append(
                {
                    "mode": mode,
                    "pythonPeakHz": python_peak,
                    "octavePeakHz": octave_peak,
                    "octaveEnergyPct": row.get("octaveEnergyPct"),
                    "absDeltaHz": abs_delta,
                }
            )
        pressure_metrics_path = _first_existing_path(PRESSURE_METRICS_CANDIDATES)
        try:
            matlab_metrics_file = str(pressure_metrics_path.relative_to(Path.cwd()))
        except ValueError:
            matlab_metrics_file = str(pressure_metrics_path)
        return jsonify(
            {
                "success": True,
                "settings": {
                    "decayPercent": decay_percent,
                    "endThresholdPercent": impulse_drop * 100.0,
                    "cutoffHz": cutoff_hz,
                    "order": order,
                },
                "ewtSettings": {
                    "numModes": ewt_num_modes,
                    "maxPoints": ewt_max_points,
                },
                "plotData": plot_data,
                "pythonMetrics": python_metrics,
                "matlabMetrics": matlab_metrics,
                "matlabMetricsAvailable": bool(matlab_metrics),
                "matlabMetricsFile": matlab_metrics_file,
                "ewtData": ewt_data,
                "ewtError": ewt_error,
                "ewtPeakAlignment": ewt_alignment,
                "ewtAlignmentAvailable": bool(ewt_alignment),
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500
