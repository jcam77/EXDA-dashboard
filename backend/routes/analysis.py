from flask import Blueprint, jsonify, request
from functools import lru_cache

analysis_bp = Blueprint("analysis", __name__)


@lru_cache(maxsize=1)
def _pressure_analysis():
    from modules import pressure_analysis
    return pressure_analysis


@lru_cache(maxsize=1)
def _flame_analysis():
    from modules import flame_analysis
    return flame_analysis


@lru_cache(maxsize=1)
def _ewt_analysis():
    from modules import ewt_analysis
    return ewt_analysis


@lru_cache(maxsize=1)
def _plot_aggregation():
    from modules import plot_aggregation
    return plot_aggregation


@analysis_bp.route('/analyze', methods=['POST'])
def analyze():
    try:
        req = request.json or {}
        content = req.get('content', '')
        data_type = req.get('dataType', 'pressure')
        if data_type == 'flame_speed':
            flame_analysis = _flame_analysis()
            x, v = flame_analysis.calculate_flame_speed(content)
            return jsonify({"plot_data": [{'x': px, 'v': pv} for px, pv in zip(x, v)]})
        if data_type == 'vent':
            pressure_analysis = _pressure_analysis()
            result = pressure_analysis.analyze_vent_content(content)
            if result.get("error"):
                return jsonify({"error": result["error"]}), 400
            return jsonify(result)
        pressure_analysis = _pressure_analysis()
        result = pressure_analysis.analyze_pressure_content(
            content,
            cutoff=req.get('cutoff', 100),
            order=req.get('order', 4),
            impulse_drop=req.get('impulseDrop', 1.0),
            use_raw=bool(req.get('useRaw', False)),
        )
        if result.get("error"):
            return jsonify({"error": result["error"]}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@analysis_bp.route('/analyze_pressure', methods=['POST'])
def analyze_pressure():
    try:
        pressure_analysis = _pressure_analysis()
        req = request.json or {}
        content = req.get('content', '')
        if not content:
            return jsonify({"error": "Missing content"}), 400
        result = pressure_analysis.analyze_pressure_content(
            content,
            cutoff=req.get('cutoff', 100),
            order=req.get('order', 4),
            impulse_drop=req.get('impulseDrop', 1.0),
            use_raw=bool(req.get('useRaw', False)),
        )
        if result.get("error"):
            return jsonify({"error": result["error"]}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@analysis_bp.route('/analyze_vent', methods=['POST'])
def analyze_vent():
    try:
        pressure_analysis = _pressure_analysis()
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


@analysis_bp.route('/aggregate_plot', methods=['POST'])
def aggregate_plot():
    try:
        plot_aggregation = _plot_aggregation()
        req = request.json or {}
        plot_data = plot_aggregation.aggregate_plot_data(req)
        return jsonify({"plotData": plot_data})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@analysis_bp.route('/analyze_ewt', methods=['POST'])
def analyze_ewt():
    try:
        ewt_analysis = _ewt_analysis()
        req = request.json or {}
        content = req.get('content', '')
        if not content:
            return jsonify({"error": "Missing content"}), 400
        num_modes = int(req.get('numModes', 5))
        max_points = int(req.get('maxPoints', 2000))
        knee_modes = int(req.get('kneeModes', 10))
        result = ewt_analysis.analyze_ewt_content(
            content,
            num_modes=num_modes,
            max_points=max_points,
            knee_modes=knee_modes
        )
        if result.get("error"):
            return jsonify({"error": result["error"]}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
