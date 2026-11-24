"""Pre-experiment checklist definition of a project (Reports/checklist.json).

The definition is the list of groups and items; the ticks and sign-off are
stored separately, per item id, in Reports/checklist_state.json. Item ids are
stable, so renaming or reordering an item keeps its tick.

- A project without Reports/checklist.json shows BUILTIN_V1: the checklist
  EXDA had before it became editable, with the same ids. BUILTIN_V1 must never
  change (tests pin it), so an EXDA update cannot silently alter the checklist
  of an older project.
- New projects get NEW_PROJECT_TEMPLATE written to Reports/checklist.json.
- Numbers such as "1.2" are not stored: they follow the order on screen.
"""

from __future__ import annotations

import copy
import json
import os
import re

CHECKLIST_FILENAME = "checklist.json"
SCHEMA = "exda-checklist/1"

ICONS = ("list-checks", "warehouse", "hard-hat", "cog", "activity", "flame", "gauge", "shield")
DEFAULT_ICON = "list-checks"

# Keys used in checklist_state.json for the sign-off; items may not use them.
RESERVED_IDS = {"resp_name", "inst_init", "final_confirm"}

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_GROUPS = 30
MAX_ITEMS_PER_GROUP = 100
MAX_TITLE = 120
MAX_TEXT = 300


class ChecklistError(ValueError):
    pass


BUILTIN_V1 = {
    "schema": SCHEMA,
    "groups": [
        {"id": "facility", "title": "Facility & Environmental Prep", "icon": "warehouse", "items": [
            {"id": "vent", "text": "Ventilation system is confirmed OFF [Proc.Ref. xxx]"},
            {"id": "hatches", "text": "All ceiling hatches are confirmed OPEN [Proc.Ref. xxx]"},
            {"id": "cranes", "text": "Overhead cranes are de-energized/OFF [Proc.Ref. xxx]"},
            {"id": "neighbors", "text": "DBI neighbors and personnel in the area informed [Proc.Ref. xxx]"},
            {"id": "gate", "text": "Façade Hall gate/safety tape 'DO NOT CROSS' in place [Proc.Ref. xxx]"},
        ]},
        {"id": "personnel", "title": "Personnel & PPE (TBT)", "icon": "hard-hat", "items": [
            {"id": "phones", "text": "NO mobile phones in the Façade Hall / Safe zone storage [Proc.Ref. xxx]"},
            {"id": "ppe", "text": "PPE: Hearing protection, safety boots, and FR clothing verified [Proc.Ref. xxx]"},
            {"id": "stop", "text": "'Say Stop' policy briefed to all involved [Proc.Ref. xxx]"},
            {"id": "firstaid", "text": "Nearest First Aid kit located and 2+ first aiders present [Proc.Ref. xxx]"},
            {"id": "batteries", "text": "Lithium-Ion batteries inspected for shape changes [Proc.Ref. xxx]"},
        ]},
        {"id": "hardware", "title": "Hardware & Supply Line", "icon": "cog", "items": [
            {"id": "blocks", "text": "Mechanical blocks (2-3 per side) secured against tunnel [Proc.Ref. xxx]"},
            {"id": "leak", "text": "Soapy water leakage test completed on H2 supply line [Proc.Ref. xxx]"},
            {"id": "v7", "text": "Valve V7 confirmed OPEN for H2 adding to protect seal [Proc.Ref. xxx]"},
            {"id": "cylinder", "text": "Hydrogen cylinder secured in stable position [Proc.Ref. xxx]"},
            {"id": "fan", "text": "ATEX fan securely fixed and grounded [Proc.Ref. xxx]"},
        ]},
        {"id": "shakedown", "title": "Systems Shakedown", "icon": "activity", "items": [
            {"id": "pretest", "text": "Dry shakedown (no H2) verified for sync, cameras, and spark [Proc.Ref. xxx]"},
            {"id": "emergency", "text": "Action cards for Ignitor/Fan failure reviewed by team [Proc.Ref. xxx]"},
            {"id": "sensors", "text": "Pressure and H2 sensors zeroed and signal verified [Proc.Ref. xxx]"},
        ]},
    ],
}

_PROC_REF = re.compile(r"\s*\[Proc\.Ref\.\s*xxx\]\s*$")


def _new_project_template():
    template = copy.deepcopy(BUILTIN_V1)
    for group in template["groups"]:
        for item in group["items"]:
            item["text"] = _PROC_REF.sub("", item["text"])
    return template


NEW_PROJECT_TEMPLATE = _new_project_template()


def checklist_path(project_root: str) -> str:
    return os.path.join(project_root, "Reports", CHECKLIST_FILENAME)


def validate(definition) -> dict:
    """Return a clean copy of a checklist definition, or raise ChecklistError."""
    if not isinstance(definition, dict):
        raise ChecklistError("The checklist must be an object with a list of groups.")
    groups = definition.get("groups")
    if not isinstance(groups, list):
        raise ChecklistError("The checklist has no list of groups.")
    if len(groups) > MAX_GROUPS:
        raise ChecklistError(f"At most {MAX_GROUPS} groups are allowed.")
    seen = set()
    clean_groups = []
    for g_index, group in enumerate(groups, start=1):
        if not isinstance(group, dict):
            raise ChecklistError(f"Group {g_index} is not valid.")
        gid = str(group.get("id") or "").strip()
        if not _ID_RE.match(gid):
            raise ChecklistError(f"Group {g_index} has no valid id.")
        if gid in seen:
            raise ChecklistError(f"Id '{gid}' is used twice.")
        seen.add(gid)
        title = str(group.get("title") or "").strip()
        if not title:
            raise ChecklistError(f"Group {g_index} needs a title.")
        if len(title) > MAX_TITLE:
            raise ChecklistError(f"The title of group {g_index} is longer than {MAX_TITLE} characters.")
        icon = str(group.get("icon") or DEFAULT_ICON).strip()
        if icon not in ICONS:
            raise ChecklistError(f"Group {g_index} uses an unknown icon '{icon}'.")
        items = group.get("items")
        if not isinstance(items, list):
            raise ChecklistError(f"Group {g_index} has no list of items.")
        if len(items) > MAX_ITEMS_PER_GROUP:
            raise ChecklistError(f"Group {g_index} has more than {MAX_ITEMS_PER_GROUP} items.")
        clean_items = []
        for i_index, item in enumerate(items, start=1):
            label = f"Item {g_index}.{i_index}"
            if not isinstance(item, dict):
                raise ChecklistError(f"{label} is not valid.")
            iid = str(item.get("id") or "").strip()
            if not _ID_RE.match(iid):
                raise ChecklistError(f"{label} has no valid id.")
            if iid in RESERVED_IDS:
                raise ChecklistError(f"{label} uses the reserved id '{iid}'.")
            if iid in seen:
                raise ChecklistError(f"Id '{iid}' is used twice.")
            seen.add(iid)
            text = str(item.get("text") or "").strip()
            if not text:
                raise ChecklistError(f"{label} has no text.")
            if len(text) > MAX_TEXT:
                raise ChecklistError(f"{label} is longer than {MAX_TEXT} characters.")
            clean_items.append({"id": iid, "text": text})
        clean_groups.append({"id": gid, "title": title, "icon": icon, "items": clean_items})
    return {"schema": SCHEMA, "groups": clean_groups}


def load(project_root: str) -> dict:
    """The project's checklist: {'checklist', 'source': 'project'|'builtin', 'path'}.

    A file that exists but cannot be read or is not a valid checklist raises
    ChecklistError: it is reported, never replaced by the built-in list.
    """
    path = checklist_path(project_root)
    if not os.path.exists(path):
        return {"checklist": copy.deepcopy(BUILTIN_V1), "source": "builtin", "path": path}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as exc:
        raise ChecklistError(f"{os.path.relpath(path, project_root)} cannot be read: {exc}") from exc
    try:
        clean = validate(data)
    except ChecklistError as exc:
        raise ChecklistError(f"{os.path.relpath(path, project_root)} is not a valid checklist: {exc}") from exc
    return {"checklist": clean, "source": "project", "path": path}
