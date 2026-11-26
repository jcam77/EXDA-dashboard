"""The team's standard list of technical skills (EXDA-Projects/exda-skills.json).

The "Technical skills" field of the Project Description only takes skills from
this list, so the same skill always has the same name ("CFD (OpenFOAM)", not
"CFD", "simulations" or "OpenFOAM" in different projects). Skills are grouped
in categories, so both "can we simulate?" and "can we use OpenFOAM?" can be
answered.

- The list is shared by all projects of an EXDA installation: it lives in the
  default projects folder, not in a project.
- Until someone adds a skill, DEFAULT_CATALOG is used and no file is written.
- Adding a skill writes the whole list (atomically), with who added it and
  when, so the list can be tidied later. Nothing is ever removed by EXDA.
- Projects store the skill names as text, so a shared project stays readable
  where the list differs; such names are shown as "not in the standard list".
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime

from modules import project_store

CATALOG_FILENAME = "exda-skills.json"
SCHEMA = "exda-skills/1"
MAX_NAME = 80
MAX_CATEGORY = 60
MAX_CATEGORIES = 40
MAX_SKILLS = 400

DEFAULT_CATALOG = (
    ("Numerical simulation", (
        "CFD (OpenFOAM)", "CFD meshing", "Combustion modelling", "FEA / structural simulation",
        "HPC / cluster computing")),
    ("Instrumentation and DAQ", (
        "DAQ setup and configuration", "Pressure sensors (installation, calibration)",
        "Gas analysis (BGA, H2 sensors)", "High-speed imaging", "IR / thermal imaging",
        "Triggering and synchronisation")),
    ("Data analysis and software", (
        "MATLAB signal processing", "Python data analysis", "Uncertainty analysis",
        "Scripting and automation", "Data management")),
    ("Experimental operations", (
        "Gas handling and mixing (MFC)", "Explosion test operation", "Ignition systems",
        "Test rig commissioning")),
    ("Mechanical design and manufacturing", (
        "3D CAD design", "Technical drawings", "Workshop fabrication", "Test rig / pressure vessel design")),
    ("Electrical and control", ("Electrical wiring", "PLC / automation", "LabVIEW")),
    ("Safety and risk", ("Risk assessment (RAMS)", "ATEX / hazardous areas", "Operating procedures (SOPs)")),
    ("Reporting and management", ("Technical reporting", "Scientific writing", "Project management")),
)

_write_lock = threading.Lock()


class SkillsCatalogError(ValueError):
    """The list cannot be read, or a skill cannot be added (readable message)."""


def catalog_path(projects_root):
    return os.path.join(projects_root, CATALOG_FILENAME)


def default_catalog():
    return {"schema": SCHEMA, "categories": [
        {"name": name, "skills": [{"name": skill} for skill in skills]} for name, skills in DEFAULT_CATALOG
    ]}


def _clean(value, what, limit):
    text = " ".join(str(value or "").split())
    if not text:
        raise SkillsCatalogError(f"{what} is empty.")
    if len(text) > limit:
        raise SkillsCatalogError(f"{what} is too long (at most {limit} characters).")
    return text


def _check(data):
    if not isinstance(data, dict) or data.get("schema") != SCHEMA or not isinstance(data.get("categories"), list):
        raise SkillsCatalogError(f"{CATALOG_FILENAME} is not a valid EXDA skills list.")
    for category in data["categories"]:
        if not isinstance(category, dict) or not isinstance(category.get("name"), str) \
                or not isinstance(category.get("skills"), list) \
                or not all(isinstance(s, dict) and isinstance(s.get("name"), str) for s in category["skills"]):
            raise SkillsCatalogError(f"{CATALOG_FILENAME} is not a valid EXDA skills list.")
    return data


def load(projects_root):
    """The team list: the file if there is one, else the built-in default.

    Returns (catalog, source) with source "file" or "default". A damaged file
    raises SkillsCatalogError; it is reported, never replaced.
    """
    path = catalog_path(projects_root)
    if not os.path.isfile(path):
        return default_catalog(), "default"
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as exc:
        raise SkillsCatalogError(f"{CATALOG_FILENAME} cannot be read: {exc}") from exc
    return _check(data), "file"


def skill_names(catalog):
    return [skill["name"] for category in catalog["categories"] for skill in category["skills"]]


def add_skill(projects_root, name, category, added_by=""):
    """Add a skill to a category (an existing one, or a new one). Returns the list.

    A name that is already in the list (ignoring case, in any category) is
    refused, with the category it is in.
    """
    name = _clean(name, "The skill name", MAX_NAME)
    category = _clean(category, "The category", MAX_CATEGORY)
    with _write_lock:
        catalog, _source = load(projects_root)
        for existing in catalog["categories"]:
            for skill in existing["skills"]:
                if skill["name"].lower() == name.lower():
                    raise SkillsCatalogError(f'"{skill["name"]}" is already in the list, under {existing["name"]}.')
        if len(skill_names(catalog)) >= MAX_SKILLS:
            raise SkillsCatalogError(f"The list is full (at most {MAX_SKILLS} skills).")
        target = next((c for c in catalog["categories"] if c["name"].lower() == category.lower()), None)
        if target is None:
            if len(catalog["categories"]) >= MAX_CATEGORIES:
                raise SkillsCatalogError(f"Too many categories (at most {MAX_CATEGORIES}).")
            target = {"name": category, "skills": []}
            catalog["categories"].append(target)
        target["skills"].append({
            "name": name,
            "addedBy": str(added_by or "")[:MAX_NAME],
            "addedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        })
        os.makedirs(projects_root, exist_ok=True)
        project_store.write_json_atomic(catalog_path(projects_root), catalog)
        return catalog
