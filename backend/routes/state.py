from flask import Blueprint, jsonify, request
import json
from datetime import datetime
import os

from modules import project_manager

state_bp = Blueprint("state", __name__)


@state_bp.route('/get_project_state', methods=['GET'])
def get_project_state():
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
            for f in files:
                if f.startswith('.'):
                    continue
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, data_dir)

                file_info = {"name": f, "path": full_path, "rel": rel_path}

                if f.lower().endswith(('.csv', '.txt', '.dat')):
                    data_files.append(file_info)
                if f in ['p', 'p_rgh'] or 'vol' in f:
                    sim_files.append(file_info)

    return jsonify({
        "success": True,
        "plan": plan_data,
        "data_files": data_files,
        "sim_files": sim_files
    })


@state_bp.route('/read_project_file', methods=['GET'])
def read_project_file():
    project_path = request.args.get('projectPath')
    file_path = request.args.get('path')
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
        with open(target, 'r', encoding='utf-8') as f:
            return jsonify({"success": True, "content": f.read()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@state_bp.route('/select_data_folder', methods=['POST'])
def select_data_folder():
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
    project_path = request.args.get('projectPath')
    project_root, err = project_manager.resolve_project_path(project_path)
    if err:
        return jsonify({"success": False, "error": err})
    data_dir = os.path.join(project_root, "Raw_Data")
    if not os.path.exists(data_dir):
        return jsonify({"success": True, "files": []})
    files_found = []
    for root, dirs, files in os.walk(data_dir):
        for f in files:
            if not f.startswith('.'):
                rel_path = os.path.relpath(os.path.join(root, f), data_dir)
                files_found.append(rel_path)
    return jsonify({"success": True, "files": sorted(files_found)})


@state_bp.route('/list_plan_files', methods=['GET'])
def list_plan_files():
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
    data = request.json
    success, result = project_manager.save_plan_to_project(
        data.get('projectPath'), data.get('filename'), data.get('content')
    )
    return jsonify({"success": success, "path": result})
