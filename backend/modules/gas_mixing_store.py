"""Append-only history for Reports/gas_mixing.json (EXDA-Check item 4).

The save endpoint receives the full list of records from the client. Before the
file is rewritten, every record is compared with the version on disk:

- changed record  -> the previous version (as it was on disk) is appended to
                     record["history"], and an "update" line goes to the audit log
- new record      -> "create" audit line
- removed record  -> moved to the top-level "archivedRecords" list (never
                     destroyed) with a "delete" audit line
- unchanged       -> nothing is added

History and archive always come from the file on disk, never from the client,
so a client cannot drop or rewrite them. The first saved version of a record
(the test-day entry) therefore stays retrievable.

The audit log is Reports/gas_mixing_audit.jsonl, one JSON object per line.
"""

from __future__ import annotations

import copy
import json
import os
import tempfile

AUDIT_FILENAME = "gas_mixing_audit.jsonl"

# Keys that are bookkeeping, not record content.
_NON_CONTENT_KEYS = {"history", "updatedAt"}


def record_key(record: dict) -> tuple[str, str]:
    return (
        str(record.get("group") or "").strip(),
        str(record.get("runName") or "").strip(),
    )


def _comparable(record: dict) -> dict:
    """Record content for change detection; a missing key equals a blank one."""
    return {
        key: value
        for key, value in record.items()
        if key not in _NON_CONTENT_KEYS and value not in ("", None)
    }


def _content(record: dict) -> dict:
    """Record without its own history (what goes into a history entry)."""
    return {key: copy.deepcopy(value) for key, value in record.items() if key != "history"}


def _is_changed(previous: dict, record: dict, normalize) -> bool:
    """True when saving `record` would alter or lose content of `previous`.

    - Content edits are detected on the normalized form of `previous`, so fields
      that normalization merely derives (e.g. mH2EstimatedG from results) are
      not counted as an edit.
    - Any non-blank value present in the stored `previous` that would not
      survive unchanged also counts as a change, so normalization can never
      silently drop recorded data without keeping it in history.
    """
    normalized_previous = normalize(previous) if normalize else previous
    if _comparable(normalized_previous) != _comparable(record):
        return True
    return any(record.get(key) != value for key, value in _comparable(previous).items())


def merge_with_history(existing_payload, incoming_records, now_iso: str, normalize=None):
    """Return (records, archived_records, audit_entries).

    existing_payload: the parsed gas_mixing.json on disk (or None).
    incoming_records: normalized records from the client (without history).
    normalize: the save-time record normalizer (for change detection).
    """
    existing_payload = existing_payload if isinstance(existing_payload, dict) else {}
    existing_records = existing_payload.get("records")
    existing_records = existing_records if isinstance(existing_records, list) else []
    archived = existing_payload.get("archivedRecords")
    archived = copy.deepcopy(archived) if isinstance(archived, list) else []

    existing_by_key = {}
    for record in existing_records:
        if isinstance(record, dict):
            existing_by_key[record_key(record)] = record

    audit = []
    merged = []
    seen = set()
    for incoming in incoming_records:
        key = record_key(incoming)
        seen.add(key)
        previous = existing_by_key.get(key)
        record = {k: v for k, v in incoming.items() if k != "history"}

        if previous is None:
            merged.append(record)
            audit.append({
                "timestamp": now_iso, "action": "create",
                "group": key[0], "runName": key[1],
                "previous": None, "new": _content(record),
            })
            continue

        history = previous.get("history")
        history = copy.deepcopy(history) if isinstance(history, list) else []
        if _is_changed(previous, record, normalize):
            history.append({
                "savedAt": str(previous.get("updatedAt") or ""),
                "replacedAt": now_iso,
                "record": _content(previous),
            })
            audit.append({
                "timestamp": now_iso, "action": "update",
                "group": key[0], "runName": key[1],
                "previous": _content(previous), "new": _content(record),
            })
        if history:
            record["history"] = history
        merged.append(record)

    for key, previous in existing_by_key.items():
        if key in seen:
            continue
        archived.append({"deletedAt": now_iso, "record": copy.deepcopy(previous)})
        audit.append({
            "timestamp": now_iso, "action": "delete",
            "group": key[0], "runName": key[1],
            "previous": _content(previous), "new": None,
        })

    return merged, archived, audit


def dosage_model_audit(existing_payload, dosage_model: dict, now_iso: str):
    """Audit entry when the global dosage model changes, else None."""
    previous = (existing_payload or {}).get("dosageModel") if isinstance(existing_payload, dict) else None
    if previous == dosage_model or (previous is None and not dosage_model):
        return None
    return {
        "timestamp": now_iso, "action": "dosage_model",
        "group": "", "runName": "",
        "previous": previous, "new": dosage_model,
    }


def write_json_atomic(path: str, payload: dict) -> None:
    """Write JSON via a temp file + rename so a crash never leaves a half file."""
    directory = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp_", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def append_audit(reports_dir: str, entries) -> None:
    """Append audit entries (one JSON object per line). Never rewrites the log."""
    entries = [entry for entry in entries if entry]
    if not entries:
        return
    path = os.path.join(reports_dir, AUDIT_FILENAME)
    with open(path, "a", encoding="utf-8") as handle:
        for entry in entries:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
