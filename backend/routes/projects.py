"""Project management routes for creating, listing, opening, and status updates."""

from flask import Blueprint, jsonify, request
import os
import string
import sys

from modules import project_manager

projects_bp = Blueprint("projects", __name__)

def _app_root():
    """Return the repository root for the running backend."""
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PROJECTS_FOLDER_NAME = "EXDA-Projects"


def _projects_root_default():
    """Return the default projects folder.

    Project data lives outside the app folder, so app updates never touch it:
    1. EXDA_PROJECTS_ROOT, if set;
    2. an 'EXDA-Projects' folder next to the app folder, if it exists;
    3. otherwise the app's own 'Projects' folder (older installations).
    """
    configured = os.environ.get("EXDA_PROJECTS_ROOT")
    if configured:
        return configured
    beside_app = os.path.join(os.path.dirname(_app_root()), PROJECTS_FOLDER_NAME)
    if os.path.isdir(beside_app):
        return beside_app
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
    """Open a project folder and add any missing standard folders.

    A folder that is not an EXDA project yet is never set up silently: the
    response asks for confirmation (needsSetup), and the folders are created
    only when the request is sent again with createStructure=true.
    """
    data = request.json or {}
    project_path = (data.get('projectPath') or '').strip()
    if not project_path or not os.path.isdir(project_path):
        return jsonify({"success": False, "error": "Invalid project path"}), 400

    if not project_manager.is_project_folder(project_path) and not data.get('createStructure'):
        return jsonify({
            "success": False,
            "needsSetup": True,
            "path": project_path,
            "error": "This folder is not an EXDA project yet.",
        }), 409

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


@projects_bp.route('/rename_project', methods=['POST'])
def rename_project():
    """Rename an existing project folder."""
    data = request.json or {}
    project_path = (data.get('projectPath') or '').strip()
    new_name = (data.get('newProjectName') or '').strip()
    if not project_path:
        return jsonify({"success": False, "error": "Project path is required"}), 400
    if not new_name:
        return jsonify({"success": False, "error": "New project name is required"}), 400

    success, msg, new_path = project_manager.rename_project(project_path, new_name)
    if success:
        return jsonify({"success": True, "path": new_path, "message": msg})
    return jsonify({"success": False, "error": msg}), 400


@projects_bp.route('/copy_project', methods=['POST'])
def copy_project():
    """Create a full copy of an existing project folder."""
    data = request.json or {}
    project_path = (data.get('projectPath') or '').strip()
    new_name = (data.get('newProjectName') or '').strip()
    if not project_path:
        return jsonify({"success": False, "error": "Project path is required"}), 400
    if not new_name:
        return jsonify({"success": False, "error": "Copy project name is required"}), 400

    success, msg, new_path = project_manager.copy_project(project_path, new_name)
    if success:
        return jsonify({"success": True, "path": new_path, "message": msg})
    return jsonify({"success": False, "error": msg}), 400


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


def _quick_places():
    """Common starting folders for the folder picker (only those that exist)."""
    places = []
    seen = set()

    def add(label, path, kind="drive"):
        if not path or not os.path.isdir(path):
            return
        key = os.path.normcase(os.path.abspath(path))
        if key in seen:
            return
        seen.add(key)
        places.append({"label": label, "path": os.path.abspath(path), "kind": kind})

    home = os.path.expanduser("~")
    add("EXDA projects", _projects_root_default(), "projects")
    add("Home", home, "home")
    add("Desktop", os.path.join(home, "Desktop"), "desktop")
    add("Desktop", os.path.join(home, "OneDrive", "Desktop"), "desktop")
    add("Documents", os.path.join(home, "Documents"), "documents")
    add("Documents", os.path.join(home, "OneDrive", "Documents"), "documents")
    if os.name == "nt":
        listdrives = getattr(os, "listdrives", None)  # Python 3.12+
        drives = listdrives() if listdrives else [f"{letter}:\\" for letter in string.ascii_uppercase]
        for drive in drives:
            add(drive.rstrip("\\"), drive)
    elif sys.platform == "darwin":
        try:
            for name in sorted(os.listdir("/Volumes")):
                if not name.startswith("."):
                    add(name, os.path.join("/Volumes", name))
        except OSError:
            pass
    else:
        for base in ("/media", "/mnt"):
            try:
                for name in sorted(os.listdir(base)):
                    add(name, os.path.join(base, name))
            except OSError:
                pass
    return places


def _nearest_existing_folder(path):
    """The folder itself if it exists, otherwise its closest existing parent."""
    current = os.path.abspath(path)
    while current and not os.path.isdir(current):
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent
    return current or None


@projects_bp.route('/list_directories', methods=['GET'])
def list_directories():
    """List child directories for navigation and project selection.

    With fallback=nearest (the folder picker), a missing folder is not an error:
    the nearest existing parent is shown (or the home folder), with a notice, so
    the picker never gets stuck. Without it, a missing folder returns 404, so
    pages that list projects never mistake another folder for a projects folder.
    """
    requested = (request.args.get('path') or '').strip()
    include_status = (request.args.get('includeStatus') or '').lower() in ['1', 'true', 'yes']
    allow_fallback = (request.args.get('fallback') or '').lower() == 'nearest'
    notice = ''
    path = requested or _projects_root_default()
    if not os.path.isdir(path):
        if not allow_fallback:
            return jsonify({"success": False, "error": "Path not found"}), 404
        fallback = _nearest_existing_folder(path) if requested else None
        if not fallback:
            fallback = os.path.expanduser("~")
        if requested:
            notice = f"Folder not found: {requested}. Showing the nearest existing folder."
        path = fallback
    path = os.path.abspath(path)

    try:
        entries = []
        for name in os.listdir(path):
            if name.startswith('.') or name.startswith('$'):
                continue
            full = os.path.join(path, name)
            try:
                is_dir = os.path.isdir(full)
            except OSError:
                continue
            if is_dir:
                entry = {"name": name, "path": full, "isProject": project_manager.is_project_folder(full)}
                if include_status:
                    status = project_manager.read_project_status(full)
                    if not status and project_manager.is_project_folder(full):
                        status = project_manager.ensure_project_status(full)
                    entry["status"] = status
                    entry["plan"] = project_manager.get_project_plan_summary(full)
                entries.append(entry)
        entries.sort(key=lambda x: x["name"].lower())

        parent = os.path.dirname(path)
        if os.path.normcase(parent) == os.path.normcase(path):
            parent = None

        return jsonify({
            "success": True,
            "path": path,
            "parent": parent,
            "directories": entries,
            "isProject": project_manager.is_project_folder(path),
            "notice": notice,
            "quickPlaces": _quick_places(),
        })
    except PermissionError:
        return jsonify({"success": False, "error": "No permission to open this folder", "quickPlaces": _quick_places()}), 403
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "quickPlaces": _quick_places()}), 500


PROJECT_SEARCH_DEPTH = 3


def find_projects(root, max_depth=PROJECT_SEARCH_DEPTH):
    """Find EXDA projects below root, including inside group folders.

    A project is a folder with the EXDA project marker file (see
    project_manager.is_project_folder). Any other folder is a group (for example
    a bigger project holding several test campaigns) and is searched, up to
    max_depth levels below root. Project folders themselves are never searched.
    Returns (path, group) pairs; group is the folder path between root and the
    project, joined with '/', or '' for projects directly in root.
    """
    found = []
    if project_manager.is_project_folder(root):
        return [(os.path.abspath(root), "")]

    def walk(folder, parts, depth):
        try:
            names = sorted(os.listdir(folder), key=str.lower)
        except OSError:
            return
        for name in names:
            if name.startswith(('.', '$', '~')):
                continue
            full = os.path.join(folder, name)
            try:
                if not os.path.isdir(full) or os.path.islink(full):
                    continue
            except OSError:
                continue
            if project_manager.is_project_folder(full):
                found.append((full, "/".join(parts)))
            elif depth < max_depth:
                walk(full, parts + [name], depth + 1)

    walk(root, [], 1)
    return found


@projects_bp.route('/list_projects', methods=['GET'])
def list_projects():
    """List the projects below a projects root, including projects inside group folders."""
    root = (request.args.get('path') or '').strip() or _projects_root_default()
    if not os.path.isdir(root):
        return jsonify({"success": False, "error": "Path not found"}), 404
    projects = []
    for full, group in find_projects(root):
        project_manager.write_project_marker(full)  # older projects get the marker once
        status = project_manager.read_project_status(full)
        if not status:
            status = project_manager.ensure_project_status(full)
        projects.append({
            "name": os.path.basename(full),
            "path": full,
            "group": group,
            "status": status,
            "plan": project_manager.get_project_plan_summary(full),
        })
    return jsonify({"success": True, "path": os.path.abspath(root), "projects": projects})


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
        for full, group in find_projects(projects_root):
            name = f"{group}/{os.path.basename(full)}" if group else os.path.basename(full)
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
