"""Project description routes (Plan/project_description.json), see modules/project_description.py."""

import os
from collections import Counter

from flask import Blueprint, jsonify, request

from modules import project_description as pd
from modules import project_manager, project_store
from routes.projects import _projects_root_default, find_projects
from routes.state import _base_version, _now_display_str, _store_error_response

project_description_bp = Blueprint("project_description", __name__)

MAX_SUGGESTIONS_PER_FIELD = 200


def _plan_text(project_root):
    plan = project_manager.get_project_plan_summary(project_root) or {}
    return {"objective": plan.get("objective") or "", "description": plan.get("description") or ""}


@project_description_bp.route('/get_project_description', methods=['GET'])
def get_project_description():
    """The project's description, the standard fields, and the plan's objective/description."""
    project_root, err = project_manager.resolve_project_path(request.args.get("projectPath"), require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400
    try:
        loaded = pd.load(project_root)
    except pd.DescriptionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 422
    return jsonify({
        "success": True,
        "description": loaded["description"],
        "source": loaded["source"],
        "updatedAt": loaded.get("updatedAt", ""),
        "version": project_store.file_version(pd.description_path(project_root)),
        "fields": list(pd.STANDARD_FIELDS),
        "plan": _plan_text(project_root),
    })


@project_description_bp.route('/save_project_description', methods=['POST'])
def save_project_description():
    """Save Plan/project_description.json (version-checked, history kept)."""
    payload = request.json or {}
    project_root, err = project_manager.resolve_project_path(payload.get("projectPath"), require_project_folder=True)
    if err:
        return jsonify({"success": False, "error": err}), 400
    try:
        clean = pd.validate(payload.get("description"))
    except pd.DescriptionError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    path = pd.description_path(project_root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    updated_at = _now_display_str(include_seconds=True)
    try:
        saved = project_store.save_json_tracked(project_root, path, {**clean, "updatedAt": updated_at},
                                                action="save_project_description",
                                                expected_version=_base_version(payload))
    except project_store.StoreConflict as exc:
        return _store_error_response(exc)
    except Exception as exc:
        return jsonify({"success": False, "error": f"Could not save the project description: {exc}"}), 500
    return jsonify({"success": True, "description": clean, "source": "project",
                    "updatedAt": updated_at, "version": saved["version"]})


@project_description_bp.route('/project_description_suggestions', methods=['GET'])
def project_description_suggestions():
    """Terms already used in the tag fields of other projects, most used first.

    Searches the default projects folder, the folders given as ?root=..., and
    the folder that holds the current project. The current project is skipped.
    """
    current = os.path.realpath(request.args.get("projectPath") or "") if request.args.get("projectPath") else ""
    roots = [path for path in request.args.getlist("root") if path]
    roots.append(_projects_root_default())
    if current:
        roots.append(os.path.dirname(current))
    counters = {field_id: Counter() for field_id in pd.TAG_FIELD_IDS}
    spelling = {field_id: {} for field_id in pd.TAG_FIELD_IDS}
    seen = set()
    for root in roots:
        if not os.path.isdir(root):
            continue
        for project_path, _group in find_projects(root):
            real = os.path.realpath(project_path)
            if real in seen or real == current:
                continue
            seen.add(real)
            description = pd.load_quietly(project_path)
            if not description:
                continue
            for field_id in pd.TAG_FIELD_IDS:
                for tag in description["standard"].get(field_id) or []:
                    key = tag.lower()
                    counters[field_id][key] += 1
                    spelling[field_id].setdefault(key, tag)  # first spelling seen is kept
    suggestions = {
        field_id: [
            {"value": spelling[field_id][key], "count": count}
            for key, count in sorted(counter.items(), key=lambda item: (-item[1], item[0]))[:MAX_SUGGESTIONS_PER_FIELD]
        ]
        for field_id, counter in counters.items()
    }
    return jsonify({"success": True, "suggestions": suggestions, "projectsSearched": len(seen)})
