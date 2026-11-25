"""Structured description of a project (Plan/project_description.json).

Two kinds of fields:

- STANDARD_FIELDS: the same fields, with the same ids, in every project. They
  can be left empty but never renamed or removed, so projects stay comparable
  (for example for a future map of experimental and research capabilities).
  Tag fields hold short terms; suggestions reuse terms from other projects.
- extra: fields a project adds for itself (label + text). They are kept and
  shown, but are not used to compare projects.

The objective and free-text description stay in the experiment plan and are
only shown next to this description, so they are edited in one place.
"""

from __future__ import annotations

import json
import os
import re

DESCRIPTION_FILENAME = "project_description.json"
SCHEMA = "exda-project-description/1"

# Order = order on screen. "tags": short terms; "text": free text.
STANDARD_FIELDS = (
    {"id": "research_questions", "label": "Research questions", "kind": "text",
     "hint": "What the campaign sets out to answer."},
    {"id": "methods", "label": "Methods", "kind": "tags",
     "hint": "e.g. vented explosion, DAQ characterisation"},
    {"id": "measured_quantities", "label": "Measured quantities", "kind": "tags",
     "hint": "e.g. pressure, flame arrival, H2 concentration"},
    {"id": "facility", "label": "Facility / rig", "kind": "tags",
     "hint": "e.g. VH2D chamber"},
    {"id": "fuels", "label": "Fuels / mixtures", "kind": "tags",
     "hint": "e.g. H2-air, 10-30 vol%"},
    {"id": "scale_conditions", "label": "Scale & conditions", "kind": "text",
     "hint": "e.g. 1 m3 chamber, ambient pressure, quiescent mixture"},
    {"id": "partners", "label": "Partners / funding", "kind": "tags",
     "hint": "e.g. LU, DBI, EMP2X"},
    {"id": "keywords", "label": "Keywords", "kind": "tags",
     "hint": "e.g. P2X, venting, Kistler"},
)
FIELD_IDS = tuple(field["id"] for field in STANDARD_FIELDS)
TAG_FIELD_IDS = tuple(field["id"] for field in STANDARD_FIELDS if field["kind"] == "tags")

MAX_TEXT = 4000
MAX_TAG = 80
MAX_TAGS = 40
MAX_EXTRA = 30
MAX_LABEL = 80
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class DescriptionError(ValueError):
    pass


def description_path(project_root):
    return os.path.join(project_root, "Plan", DESCRIPTION_FILENAME)


def empty_description():
    return {
        "schema": SCHEMA,
        "standard": {field["id"]: ([] if field["kind"] == "tags" else "") for field in STANDARD_FIELDS},
        "extra": [],
    }


def _clean_text(value, what, limit=MAX_TEXT):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise DescriptionError(f"{what} must be text.")
    text = value.strip()
    if len(text) > limit:
        raise DescriptionError(f"{what} is too long (at most {limit} characters).")
    return text


def _clean_tags(value, label):
    if value is None:
        return []
    if not isinstance(value, list):
        raise DescriptionError(f"{label} must be a list of terms.")
    tags, seen = [], set()
    for item in value:
        tag = " ".join(_clean_text(item, f"A term in {label}", MAX_TAG).split())
        if not tag or tag.lower() in seen:
            continue
        seen.add(tag.lower())
        tags.append(tag)
    if len(tags) > MAX_TAGS:
        raise DescriptionError(f"{label} has too many terms (at most {MAX_TAGS}).")
    return tags


def validate(payload):
    """Clean a description sent by the app; raises DescriptionError with a readable message."""
    if not isinstance(payload, dict):
        raise DescriptionError("The project description must be an object.")
    standard_in = payload.get("standard") or {}
    if not isinstance(standard_in, dict):
        raise DescriptionError("The standard fields must be an object.")
    unknown = sorted(set(standard_in) - set(FIELD_IDS))
    if unknown:
        raise DescriptionError(f"Unknown standard field: {', '.join(unknown)}.")

    clean = empty_description()
    for field in STANDARD_FIELDS:
        value = standard_in.get(field["id"])
        if field["kind"] == "tags":
            clean["standard"][field["id"]] = _clean_tags(value, field["label"])
        else:
            clean["standard"][field["id"]] = _clean_text(value, field["label"])

    extra_in = payload.get("extra") or []
    if not isinstance(extra_in, list):
        raise DescriptionError("The extra fields must be a list.")
    if len(extra_in) > MAX_EXTRA:
        raise DescriptionError(f"Too many extra fields (at most {MAX_EXTRA}).")
    ids, labels = set(), set()
    for index, item in enumerate(extra_in, start=1):
        if not isinstance(item, dict):
            raise DescriptionError(f"Extra field {index} is not valid.")
        field_id = str(item.get("id") or "")
        if not _ID_RE.match(field_id) or field_id in ids or field_id in FIELD_IDS:
            raise DescriptionError(f"Extra field {index} has an invalid id.")
        label = _clean_text(item.get("label"), f"The name of extra field {index}", MAX_LABEL)
        if not label:
            raise DescriptionError(f"Extra field {index} needs a name.")
        if label.lower() in labels or label.lower() in {f["label"].lower() for f in STANDARD_FIELDS}:
            raise DescriptionError(f'There is already a field called "{label}".')
        ids.add(field_id)
        labels.add(label.lower())
        clean["extra"].append({"id": field_id, "label": label,
                               "value": _clean_text(item.get("value"), f'Field "{label}"')})
    return clean


def load(project_root):
    """{'description', 'source'}: source is 'project' (file) or 'empty' (no file yet).

    A damaged file raises DescriptionError, so it is reported, never replaced.
    """
    path = description_path(project_root)
    if not os.path.exists(path):
        return {"description": empty_description(), "source": "empty"}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as exc:
        raise DescriptionError(f"Plan/{DESCRIPTION_FILENAME} cannot be read ({exc}).") from exc
    if not isinstance(data, dict) or data.get("schema") != SCHEMA:
        raise DescriptionError(f"Plan/{DESCRIPTION_FILENAME} is not an EXDA project description.")
    try:
        description = validate(data)
    except DescriptionError as exc:
        raise DescriptionError(f"Plan/{DESCRIPTION_FILENAME} is damaged: {exc}") from exc
    return {"description": description, "source": "project", "updatedAt": data.get("updatedAt", "")}


def load_quietly(project_root):
    """The description, or None when missing or unreadable (for listings and suggestions)."""
    try:
        loaded = load(project_root)
    except DescriptionError:
        return None
    return loaded["description"] if loaded["source"] == "project" else None


# Tag fields that say what a project can do (not who funds it). The Projects
# page shows them as the research and experimental capabilities cloud.
CAPABILITY_FIELD_IDS = ("methods", "measured_quantities", "facility", "fuels", "keywords")


def capability_terms(description):
    """The filled-in capability terms of a description, by field id."""
    if not description:
        return {}
    standard = description.get("standard") or {}
    return {field_id: list(standard[field_id]) for field_id in CAPABILITY_FIELD_IDS if standard.get(field_id)}


def search_text(description):
    """All filled-in values as one text, for searching projects."""
    if not description:
        return ""
    parts = []
    for field in STANDARD_FIELDS:
        value = description["standard"].get(field["id"])
        parts.extend(value if isinstance(value, list) else [value])
    for item in description.get("extra", []):
        parts.extend([item.get("label", ""), item.get("value", "")])
    return " ".join(part for part in parts if part)
