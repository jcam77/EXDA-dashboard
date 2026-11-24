"""Procedure documents of a project (Procedures/: RAMS, RAMS-Appendices, SOPs).

Read only: lists what is in the folder so the Checklist page can preview,
open or download it. Nothing in the folder is created, renamed or changed
here (the empty standard subfolders are created by project_manager when a
project is opened).
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

PROCEDURES_FOLDER = "Procedures"
STANDARD_SECTIONS = ("RAMS", "RAMS-Appendices", "SOPs")

# Files that are not procedure documents: macOS metadata, Office lock files
# and Word's automatic backup copies.
_HIDDEN_PREFIXES = ("._", "~$", ".")
_HIDDEN_NAMES = {"desktop.ini", "thumbs.db"}
_BACKUP_PREFIX = "backup of "

PREVIEWABLE = {".pdf"}


def is_hidden_name(name: str) -> bool:
    lower = name.lower()
    return (
        name.startswith(_HIDDEN_PREFIXES)
        or lower in _HIDDEN_NAMES
        or lower.startswith(_BACKUP_PREFIX)
    )


def _section_order(section: str):
    try:
        return (0, STANDARD_SECTIONS.index(section), "")
    except ValueError:
        return (1, 0, section.casefold())


def list_procedures(project_root: str) -> dict:
    """Documents under <project>/Procedures, grouped by section and subfolder.

    A document is one file name without its extension in one folder; a PDF
    and a Word file with the same name are one document in two formats.
    """
    base = os.path.join(project_root, PROCEDURES_FOLDER)
    if not os.path.isdir(base):
        return {"folder": PROCEDURES_FOLDER, "exists": False, "documents": [], "fileCount": 0}

    documents = {}
    file_count = 0
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if not is_hidden_name(d))
        rel_dir = os.path.relpath(dirpath, base)
        parts = [] if rel_dir == "." else rel_dir.split(os.sep)
        section = parts[0] if parts else ""
        group = "/".join(parts[1:])
        for filename in filenames:
            if is_hidden_name(filename):
                continue
            full = os.path.join(dirpath, filename)
            if not os.path.isfile(full):
                continue
            stem, ext = os.path.splitext(filename)
            stat = os.stat(full)
            key = (section, group, stem)
            doc = documents.setdefault(key, {"section": section, "group": group, "name": stem, "files": []})
            doc["files"].append({
                "format": ext.lstrip(".").upper() or "FILE",
                "path": os.path.relpath(full, project_root).replace(os.sep, "/"),
                "fileName": filename,
                "sizeBytes": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds"),
                "previewable": ext.lower() in PREVIEWABLE,
            })
            file_count += 1

    ordered = sorted(documents.values(),
                     key=lambda d: (_section_order(d["section"]), d["group"].casefold(), d["name"].casefold()))
    for doc in ordered:
        doc["files"].sort(key=lambda f: (not f["previewable"], f["format"]))
    return {"folder": PROCEDURES_FOLDER, "exists": True, "documents": ordered, "fileCount": file_count}
