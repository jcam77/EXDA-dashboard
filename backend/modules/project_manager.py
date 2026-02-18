"""Filesystem helpers for project creation, status, dialogs, and plan persistence."""

import os
import sys
import subprocess
import json
import shutil
from datetime import datetime, timezone

STATUS_FILENAME = "project_status.json"

def resolve_project_path(project_path, require_project_folder=False):
    """Validate and resolve a project path on disk."""
    if not project_path:
        return None, "Project path is required"
    resolved = os.path.realpath(project_path)
    if not os.path.exists(resolved):
        return None, "Project path not found"
    if not os.path.isdir(resolved):
        return None, "Project path is not a directory"
    if require_project_folder and not is_project_folder(resolved):
        return None, "Not a project folder"
    return resolved, None

def is_path_within(base_path, target_path):
    """Check whether target_path is inside base_path."""
    if not base_path or not target_path:
        return False
    base = os.path.realpath(base_path)
    target = os.path.realpath(target_path)
    try:
        return os.path.commonpath([base, target]) == base
    except ValueError:
        return False

def sanitize_filename(filename):
    """Return a safe basename suitable for writing into project folders."""
    if not filename:
        return None
    safe_name = os.path.basename(filename.strip())
    if not safe_name or safe_name in [".", ".."]:
        return None
    return safe_name

def _now_iso():
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).isoformat()

def _status_path(base_path):
    """Return canonical path to the status file in Plan/."""
    return os.path.join(base_path, "Plan", STATUS_FILENAME)

def _legacy_status_path(base_path):
    """Return legacy path to status file at project root."""
    return os.path.join(base_path, STATUS_FILENAME)

def _safe_mtime_iso(path):
    """Return file modification date as ISO date or None."""
    try:
        return datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc).date().isoformat()
    except Exception:
        return None

def is_project_folder(base_path):
    """Check whether path looks like an initialized project folder."""
    if not base_path or not os.path.exists(base_path):
        return False
    expected = ["Plan", "Raw_Data", "Clean_Data", "aiChat", "Reports", "Literature"]
    return any(os.path.exists(os.path.join(base_path, f)) for f in expected)

def read_project_status(base_path):
    """Read project status JSON from canonical or legacy location."""
    if not base_path or not os.path.exists(base_path):
        return None
    status_file = _status_path(base_path)
    legacy_file = _legacy_status_path(base_path)
    if os.path.exists(status_file):
        try:
            with open(status_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    if os.path.exists(legacy_file):
        try:
            with open(legacy_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None

def ensure_project_status(base_path):
    """Create/update project status file with default metadata."""
    if not base_path or not os.path.exists(base_path):
        return None

    plan_dir = os.path.join(base_path, "Plan")
    if not os.path.exists(plan_dir):
        try:
            os.makedirs(plan_dir)
        except Exception:
            return None

    status_file = _status_path(base_path)
    now = _now_iso()
    existing = read_project_status(base_path) or {}

    status = {
        "project_name": existing.get("project_name") or os.path.basename(base_path),
        "project_path": existing.get("project_path") or base_path,
        "created_at": existing.get("created_at") or now,
        "updated_at": now,
        "last_opened_at": now,
        "status": existing.get("status") or "active",
        "tags": existing.get("tags") or [],
        "notes": existing.get("notes") or "",
    }

    try:
        with open(status_file, "w", encoding="utf-8") as f:
            json.dump(status, f, indent=2)
        return status
    except Exception:
        return None

def _latest_plan_file(plan_dir):
    """Return newest plan JSON file in a Plan directory."""
    if not plan_dir or not os.path.exists(plan_dir):
        return None
    plan_files = [
        os.path.join(plan_dir, f)
        for f in os.listdir(plan_dir)
        if f.endswith(".json") and not f.startswith('.') and f != STATUS_FILENAME
    ]
    if not plan_files:
        return None
    return max(plan_files, key=os.path.getmtime)

def get_project_plan_summary(base_path):
    """Build a compact plan summary used by project list views."""
    if not base_path or not os.path.exists(base_path):
        return None

    plan_dir = os.path.join(base_path, "Plan")
    latest_plan = _latest_plan_file(plan_dir)
    if not latest_plan:
        return None

    try:
        with open(latest_plan, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None

    experiments = data.get("experiments") or []
    total = len(experiments)
    done_count = len([e for e in experiments if e.get("done")])
    progress = int(round((done_count / total) * 100)) if total else 0

    def pick_first_string(*values):
        for value in values:
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    meta = data.get("meta") or {}
    if not isinstance(meta, dict):
        meta = {}

    objective = pick_first_string(
        meta.get("objective"),
        meta.get("objectives"),
        data.get("objective"),
        data.get("objectives"),
    )
    description = pick_first_string(
        meta.get("description"),
        data.get("description"),
    )
    if objective.lower() in ["objective", "n/a", "na", "none", "tbd", "todo"]:
        objective = ""
    if not description and objective:
        description = objective
    start_date = pick_first_string(meta.get("startDate"), data.get("startDate"))
    deadline = pick_first_string(meta.get("deadline"), data.get("deadline"))

    if total == 0:
        status = "planning"
    elif done_count >= total:
        status = "archived"
    else:
        status = "active"

    status_file = read_project_status(base_path) or {}
    override_status = status_file.get("status") if isinstance(status_file, dict) else None
    if override_status in ["planning", "active", "archived"]:
        status = override_status

    created_date = start_date or _safe_mtime_iso(latest_plan)

    return {
        "plan_name": data.get("planName") or os.path.splitext(os.path.basename(latest_plan))[0],
        "objective": objective,
        "description": description,
        "start_date": start_date,
        "deadline": deadline,
        "created_date": created_date,
        "experiments_total": total,
        "experiments_done": done_count,
        "progress": progress,
        "status": status,
    }

def archive_project(project_path):
    """Move a project into a local .trash archive directory."""
    if not project_path or not os.path.exists(project_path):
        return False, "Project path not found"
    if not os.path.isdir(project_path):
        return False, "Project path is not a directory"

    parent_dir = os.path.dirname(project_path)
    trash_dir = os.path.join(parent_dir, ".trash")
    try:
        os.makedirs(trash_dir, exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        base_name = os.path.basename(project_path.rstrip(os.sep))
        target_path = os.path.join(trash_dir, f"{base_name}__archived_{timestamp}")
        shutil.move(project_path, target_path)
        return True, target_path
    except Exception as e:
        return False, str(e)

def update_project_status(project_path, status_value):
    """Persist status in status file and mirror it into latest plan meta."""
    if not project_path or not os.path.exists(project_path):
        return False, "Project path not found"
    if status_value not in ["planning", "active", "archived"]:
        return False, "Invalid status value"

    status = read_project_status(project_path) or ensure_project_status(project_path) or {}
    if not status:
        return False, "Could not load status file"

    status["status"] = status_value
    status["updated_at"] = _now_iso()

    try:
        with open(_status_path(project_path), "w", encoding="utf-8") as f:
            json.dump(status, f, indent=2)
    except Exception as e:
        return False, str(e)

    plan_dir = os.path.join(project_path, "Plan")
    latest_plan = _latest_plan_file(plan_dir)
    if latest_plan:
        try:
            with open(latest_plan, "r", encoding="utf-8") as f:
                plan_data = json.load(f)
            meta = plan_data.get("meta") or {}
            if not isinstance(meta, dict):
                meta = {}
            meta["status"] = status_value
            plan_data["meta"] = meta
            with open(latest_plan, "w", encoding="utf-8") as f:
                json.dump(plan_data, f, indent=2)
        except Exception:
            pass

    return True, status

def open_folder(path):
    """Open a folder using platform-specific file explorer integration."""
    if not path or not os.path.exists(path):
        return False, "Path not found"

    try:
        if sys.platform.startswith("win"):
            os.startfile(path)  # type: ignore[attr-defined]
            return True, "Opened in file explorer"
        if sys.platform == "darwin":
            subprocess.Popen(["open", path])
            return True, "Opened in Finder"
        subprocess.Popen(["xdg-open", path])
        return True, "Opened in file manager"
    except Exception as exc:
        return False, str(exc)

def select_folder_dialog(initial_dir=None):
    """
    Consolidated version:
    1. Supports the 'Umbrella' (initial_dir=None)
    2. Supports the 'Data Tab' (initial_dir=project_path)
    3. Uses the 'Subprocess' method you know works.
    """
    try:
        # Prepare the path just like you did for the file dialog
        clean_dir = initial_dir.replace('"', '\\"') if initial_dir else ""
        
        script = (
            "import tkinter as tk; "
            "from tkinter import filedialog; "
            "root = tk.Tk(); "
            "root.withdraw(); "
            "root.attributes('-topmost', True); "
            f"path = filedialog.askdirectory(initialdir='{clean_dir}', title='Select Folder'); "
            "print(path)"
        )
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except Exception as e:
        print(f"Dialog Error: {e}")
        return None

def select_file_dialog(initial_dir):
    """Opens a file dialog starting at a specific directory."""
    try:
        # We pass the directory into the script carefully
        clean_dir = initial_dir.replace('"', '\\"') # Escape quotes for safety
        script = (
            "import tkinter as tk; "
            "from tkinter import filedialog; "
            "root = tk.Tk(); "
            "root.withdraw(); "
            "root.attributes('-topmost', True); "
            f"path = filedialog.askopenfilename(initialdir='{clean_dir}', title='Load Experiment Plan', filetypes=[('JSON Files', '*.json')]); "
            "print(path)"
        )
        result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except Exception as e:
        print(f"File Dialog Error: {e}")
        return None

def initialize_project_structure(base_path):
    """
    Creates the PhD project folder hierarchy.
    Updated: includes Clean_Data plus Literature subdirectories.
    """
    if not base_path or not os.path.exists(base_path): return False, "Invalid path"
    
    # Primary PhD project folders
    folders = ["Plan", "Raw_Data", "Clean_Data", "aiChat", "Reports", "Literature"]
    
    # Specific Literature subcategories as requested
    sub_resources = [os.path.join("Literature", "Books"), os.path.join("Literature", "Papers"),os.path.join("Literature","Standards")]
    
    all_targets = folders + sub_resources
    created = []
    
    try:
        for f in all_targets:
            path = os.path.join(base_path, f)
            if not os.path.exists(path):
                os.makedirs(path)
                created.append(f)
        ensure_project_status(base_path)
        return True, f"Project Initialized. Folders created: {', '.join(created)}"
    except Exception as e:
        return False, str(e)

def create_project_structure(parent_path, project_name):
    """Create a new project folder and initialize required structure."""
    if not parent_path or not os.path.exists(parent_path):
        return False, "Invalid parent path", None
    if not project_name:
        return False, "Invalid project name", None

    project_path = os.path.join(parent_path, project_name)
    if os.path.exists(project_path):
        return False, "Project folder already exists", project_path

    try:
        os.makedirs(project_path)
    except Exception as e:
        return False, str(e), None

    success, msg = initialize_project_structure(project_path)
    return success, msg, project_path

def save_plan_to_project(project_path, filename, content):
    """Write plan content into the project's Plan directory."""
    resolved_path, err = resolve_project_path(project_path)
    if err:
        return False, err
    safe_name = sanitize_filename(filename)
    if not safe_name:
        return False, "Invalid filename"
    target_dir = os.path.join(resolved_path, "Plan")
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)
    full_path = os.path.join(target_dir, safe_name)
    if not is_path_within(target_dir, full_path):
        return False, "Invalid filename"
    try:
        with open(full_path, 'w', encoding='utf-8') as f: f.write(content)
        return True, full_path
    except Exception as e:
        return False, str(e)
