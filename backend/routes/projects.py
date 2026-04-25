"""Project management routes for creating, listing, opening, and status updates."""

from flask import Blueprint, jsonify, request
import os

from modules import project_manager

projects_bp = Blueprint("projects", __name__)

def _app_root():
    """Return the repository root for the running backend."""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def _projects_root_default():
    """Return the configured projects root path or the repo-local Projects folder."""
    configured = os.environ.get("EXDA_PROJECTS_ROOT")
    if configured:
        return configured
    return os.path.join(_app_root(), "Projects")


@projects_bp.route('/select_project_folder', methods=['POST'])
def select_project_folder():
    """Open a folder picker and initialize the selected project structure."""
    path = project_manager.select_folder_dialog()
    if path:
        success, msg = project_manager.initialize_project_structure(path)
        if success:
            return jsonify({"path": path, "message": "Project Loaded", "success": True})
        return jsonify({"success": False, "error": msg})
    return jsonify({"success": False, "message": "No folder selected"})


@projects_bp.route('/open_project_path', methods=['POST'])
def open_project_path():
    """Open an existing project path and ensure required folders exist."""
    data = request.json or {}
    project_path = (data.get('projectPath') or '').strip()
    if not project_path or not os.path.exists(project_path):
        return jsonify({"success": False, "error": "Invalid project path"}), 400

    success, msg = project_manager.initialize_project_structure(project_path)
    if success:
        return jsonify({"success": True, "path": project_path, "message": msg})
    return jsonify({"success": False, "error": msg})


@projects_bp.route('/reveal_project_path', methods=['POST'])
def reveal_project_path():
    """Open the current project directory in the OS file explorer."""
    data = request.json or {}
    project_path = (data.get('projectPath') or '').strip()
    if not project_path or not os.path.exists(project_path):
        return jsonify({"success": False, "error": "Invalid project path"}), 400

    success, msg = project_manager.open_folder(project_path)
    if success:
        return jsonify({"success": True, "message": msg})
    return jsonify({"success": False, "error": msg}), 500


@projects_bp.route('/create_project', methods=['POST'])
def create_project():
    """Create a new project under a user-selected parent directory."""
    data = request.json or {}
    project_name = (data.get('projectName') or '').strip()
    if not project_name:
        return jsonify({"success": False, "error": "Project name is required"}), 400

    parent_path = project_manager.select_folder_dialog()
    if not parent_path:
        return jsonify({"success": False, "message": "No folder selected"})

    success, msg, project_path = project_manager.create_project_structure(parent_path, project_name)
    if success:
        return jsonify({"success": True, "path": project_path, "message": msg})
    return jsonify({"success": False, "error": msg})


@projects_bp.route('/create_project_at_path', methods=['POST'])
def create_project_at_path():
    """Create a new project in a provided parent path."""
    data = request.json or {}
    parent_path = (data.get('parentPath') or '').strip()
    project_name = (data.get('projectName') or '').strip()
    if not parent_path or not os.path.exists(parent_path):
        return jsonify({"success": False, "error": "Invalid parent path"}), 400
    if not project_name:
        return jsonify({"success": False, "error": "Project name is required"}), 400

    success, msg, project_path = project_manager.create_project_structure(parent_path, project_name)
    if success:
        return jsonify({"success": True, "path": project_path, "message": msg})
    return jsonify({"success": False, "error": msg})


@projects_bp.route('/delete_project', methods=['POST'])
def delete_project():
    """Archive (soft-delete) a project into the local trash folder."""
    data = request.json or {}
    project_path = (data.get('projectPath') or '').strip()
    if not project_path:
        return jsonify({"success": False, "error": "Project path is required"}), 400

    success, result = project_manager.archive_project(project_path)
    if success:
        return jsonify({"success": True, "archivedPath": result})
    return jsonify({"success": False, "error": result}), 500


@projects_bp.route('/update_project_status', methods=['POST'])
def update_project_status():
    """Update persisted project lifecycle status."""
    data = request.json or {}
    project_path = (data.get('projectPath') or '').strip()
    status_value = (data.get('status') or '').strip().lower()
    if not project_path:
        return jsonify({"success": False, "error": "Project path is required"}), 400
    success, result = project_manager.update_project_status(project_path, status_value)
    if success:
        return jsonify({"success": True, "status": result})
    return jsonify({"success": False, "error": result}), 500


@projects_bp.route('/list_directories', methods=['GET'])
def list_directories():
    """List child directories for navigation and project selection."""
    path = request.args.get('path') or _projects_root_default()
    include_status = (request.args.get('includeStatus') or '').lower() in ['1', 'true', 'yes']
    if not os.path.exists(path):
        return jsonify({"success": False, "error": "Path not found"}), 404
    if not os.path.isdir(path):
        return jsonify({"success": False, "error": "Not a directory"}), 400

    try:
        entries = []
        for name in os.listdir(path):
            if name.startswith('.'):
                continue
            full = os.path.join(path, name)
            if os.path.isdir(full):
                entry = {"name": name, "path": full}
                if include_status:
                    status = project_manager.read_project_status(full)
                    if not status and project_manager.is_project_folder(full):
                        status = project_manager.ensure_project_status(full)
                    entry["status"] = status
                    entry["plan"] = project_manager.get_project_plan_summary(full)
                entries.append(entry)
        entries.sort(key=lambda x: x["name"].lower())

        parent = os.path.dirname(path.rstrip(os.sep))
        if parent == path:
            parent = None

        return jsonify({
            "success": True,
            "path": path,
            "parent": parent,
            "directories": entries
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@projects_bp.route('/projects_overview', methods=['GET'])
def projects_overview():
    """Return a text summary for all projects under the projects root."""
    projects_root = _projects_root_default()
    if not os.path.exists(projects_root):
        return jsonify({"success": True, "overview": "No Projects folder found."})
    if not os.path.isdir(projects_root):
        return jsonify({"success": False, "error": "Projects path is not a directory"}), 400

    try:
        lines = []
        for name in sorted(os.listdir(projects_root)):
            if name.startswith('.'):
                continue
            full = os.path.join(projects_root, name)
            if not os.path.isdir(full):
                continue
            plan = project_manager.get_project_plan_summary(full) or {}
            status = plan.get('status') or 'planning'
            objective = (plan.get('objective') or '').strip()
            total = plan.get('experiments_total') or 0
            done = plan.get('experiments_done') or 0
            summary = f"- {name} | status: {status} | experiments: {done}/{total}"
            if objective:
                summary += f" | objective: {objective}"
            lines.append(summary)

        overview = "Projects overview:\n" + ("\n".join(lines) if lines else "- No projects found")
        return jsonify({"success": True, "overview": overview})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@projects_bp.route('/project_plan_summary', methods=['GET'])
def project_plan_summary():
    """Return parsed plan summary metadata for one project."""
    project_path = request.args.get('path')
    if not project_path or not os.path.exists(project_path):
        return jsonify({"success": False, "error": "Invalid project path"}), 400
    summary = project_manager.get_project_plan_summary(project_path)
    if summary is None:
        return jsonify({"success": False, "error": "Plan summary not found"}), 404
    return jsonify({"success": True, "plan": summary})
