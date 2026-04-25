"""State routes for loading project files, plan data, and raw-data inventory."""

from flask import Blueprint, jsonify, request
import json
from datetime import datetime
import os

from modules import data_parser, mf4_parser, project_manager, tpc5_parser

state_bp = Blueprint("state", __name__)
ALLOWED_DATA_EXTENSIONS = (".csv", ".txt", ".dat", ".asc", ".ascii", ".mf4", ".tpc5")


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
        plans = [f for f in os.listdir(plan_dir) if f.endswith('.json')]
        if plans:
            latest_plan_path = max([os.path.join(plan_dir, f) for f in plans], key=os.path.getmtime)
            try:
                with open(latest_plan_path, 'r') as f:
                    plan_data = json.load(f)
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
                if f.lower().endswith(".json") and not f.startswith(".")
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
