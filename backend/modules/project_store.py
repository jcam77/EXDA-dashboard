"""Safe, traceable writes for project files (EXDA-Check C1).

Every project JSON save goes through ``save_json_tracked`` / ``save_text_tracked``:

- Atomic write: temp file in the same folder, flush + fsync, then os.replace.
  A crash or full disk leaves either the old file or the new one, never a
  truncated one.
- Before a file's content changes, the previous version is copied byte for
  byte to ``<project>/History/<file>/<timestamp>.<ext>``. Copies are never
  deleted by the app, so the version saved on the test day stays retrievable.
- Each change is appended to ``<project>/History/change_log.jsonl``: when,
  who (OS user and host), which file, the history copy, and the changed
  fields with old -> new values.
- A save whose content is identical (ignoring bookkeeping fields such as
  updatedAt) writes nothing new to History.

Concurrent edits (outdated copies):
- ``file_version`` is a hash of a file's content (bookkeeping fields such as
  updatedAt ignored). Load endpoints return it; saves send it back as
  ``baseVersion``. If the file changed in between, the save is refused with
  StaleWriteError instead of overwriting the other change.

One writer per project:
- ``<project>/.exda.lock`` records which running app (instance id, user,
  host, pid, heartbeat) is writing. While another app holds a fresh lock,
  every tracked save raises ProjectLockedError, so a second app (another PC,
  the host of a VM shared folder, an old window) can only read.
"""

from __future__ import annotations

import getpass
import json
import os
import shutil
import socket
import tempfile
import threading
import time
import uuid
import hashlib
from datetime import datetime, timezone

HISTORY_DIRNAME = "History"
CHANGE_LOG_FILENAME = "change_log.jsonl"
BOOKKEEPING_KEYS = frozenset({"updatedAt", "updated_at", "last_opened_at"})
MAX_LOGGED_CHANGES = 200
MAX_VALUE_CHARS = 300
LOCK_FILENAME = ".exda.lock"
LOCK_STALE_SECONDS = 120
INSTANCE_ID = uuid.uuid4().hex
_WRITE_LOCK = threading.RLock()


class StoreConflict(Exception):
    """Base class for saves refused to protect data written by someone else."""

    http_status = 409

    def to_payload(self):
        return {"success": False, "error": str(self)}


class StaleWriteError(StoreConflict):
    http_status = 409

    def __init__(self, path, expected, current):
        self.path, self.expected, self.current = path, expected, current
        super().__init__(
            f"{os.path.basename(path)} was changed elsewhere (another window or computer) after you opened it. "
            "Your changes were not saved. Reload to see the current version."
        )

    def to_payload(self):
        return {**super().to_payload(), "conflict": True, "currentVersion": self.current}


class ProjectLockedError(StoreConflict):
    http_status = 423

    def __init__(self, holder):
        self.holder = holder or {}
        super().__init__(
            "Read-only: this project is open for editing on "
            f"{self.holder.get('host') or 'another computer'} by {self.holder.get('user') or 'another user'} "
            f"(since {self.holder.get('acquiredAt') or '?'}). Nothing was saved."
        )

    def to_payload(self):
        return {**super().to_payload(), "locked": True, "holder": public_lock(self.holder)}


def _now():
    return datetime.now(timezone.utc)


def _actor():
    try:
        user = getpass.getuser()
    except Exception:
        user = "unknown"
    try:
        host = socket.gethostname()
    except Exception:
        host = "unknown"
    return {"user": user, "host": host}


def _fsync_dir(directory):
    try:
        fd = os.open(directory, os.O_RDONLY)
    except Exception:
        return
    try:
        os.fsync(fd)
    except Exception:
        pass
    finally:
        os.close(fd)


def write_text_atomic(path: str, text: str) -> None:
    directory = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(directory, exist_ok=True)
    suffix = os.path.splitext(path)[1] or ".tmp"
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp_", suffix=suffix, dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
        _fsync_dir(directory)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def write_json_atomic(path: str, payload) -> None:
    write_text_atomic(path, json.dumps(payload, indent=2, ensure_ascii=False))


def content_version(data) -> str:
    """Version of a file's content; bookkeeping fields (updatedAt ...) ignored."""
    if data is None:
        return ""
    raw = data.encode("utf-8") if isinstance(data, str) else data
    try:
        parsed = json.loads(raw.decode("utf-8-sig"))
        canonical = json.dumps(_strip_bookkeeping(parsed), sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        raw = canonical.encode("utf-8")
    except Exception:
        pass
    return hashlib.sha256(raw).hexdigest()[:20]


def file_version(path: str) -> str:
    """'' when the file does not exist."""
    if not path or not os.path.exists(path):
        return ""
    with open(path, "rb") as handle:
        return content_version(handle.read())


# ---------------------------------------------------------------- project lock

def _lock_path(project_root):
    return os.path.join(project_root, LOCK_FILENAME)


def read_lock(project_root):
    try:
        with open(_lock_path(project_root), "r", encoding="utf-8") as handle:
            lock = json.load(handle)
        return lock if isinstance(lock, dict) else None
    except FileNotFoundError:
        return None
    except Exception:
        return None


def public_lock(lock):
    lock = lock or {}
    return {k: lock.get(k) for k in ("user", "host", "pid", "acquiredAt", "heartbeatAt", "client")}


def _pid_alive(pid):
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes

            handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
            if handle:
                ctypes.windll.kernel32.CloseHandle(handle)
                return True
            return False
        except Exception:
            return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except Exception:
        return True
    return True


def lock_is_active(lock) -> bool:
    if not lock:
        return False
    try:
        age = time.time() - float(lock.get("heartbeatEpoch") or 0)
    except (TypeError, ValueError):
        return False
    if age > LOCK_STALE_SECONDS:
        return False
    if lock.get("host") == _actor()["host"] and lock.get("instanceId") != INSTANCE_ID \
            and not _pid_alive(lock.get("pid")):
        return False  # app on this computer that is no longer running
    return True


def lock_status(project_root):
    lock = read_lock(project_root)
    active = lock_is_active(lock)
    mine = bool(lock) and lock.get("instanceId") == INSTANCE_ID
    return {"locked": active, "owned": active and mine, "holder": public_lock(lock) if active else None}


def _write_lock(project_root, previous=None, client=None):
    now = _now()
    lock = {
        "instanceId": INSTANCE_ID,
        **_actor(),
        "pid": os.getpid(),
        "client": client or (previous or {}).get("client"),
        "acquiredAt": (previous or {}).get("acquiredAt") if previous and previous.get("instanceId") == INSTANCE_ID
        else now.isoformat(timespec="seconds"),
        "heartbeatAt": now.isoformat(timespec="seconds"),
        "heartbeatEpoch": time.time(),
        "note": "Written by EXDA while this project is open for editing. Safe to delete if no EXDA is running.",
    }
    write_json_atomic(_lock_path(project_root), lock)
    return lock


def acquire_lock(project_root, force=False, client=None):
    """Take the project lock. Returns lock_status(); 'owned' False if someone else holds it."""
    with _WRITE_LOCK:
        lock = read_lock(project_root)
        if lock_is_active(lock) and lock.get("instanceId") != INSTANCE_ID and not force:
            return lock_status(project_root)
        previous_holder = public_lock(lock) if (lock and lock.get("instanceId") != INSTANCE_ID) else None
        _write_lock(project_root, lock, client)
        if force and previous_holder and lock_is_active(lock):
            try:
                append_change_log(project_root, {"action": "project_lock_taken_over", "previousHolder": previous_holder})
            except Exception:
                pass
        return lock_status(project_root)


def heartbeat_lock(project_root, client=None):
    with _WRITE_LOCK:
        lock = read_lock(project_root)
        if lock and lock.get("instanceId") == INSTANCE_ID:
            _write_lock(project_root, lock, client)
            return lock_status(project_root)
        if not lock_is_active(lock):
            return acquire_lock(project_root, client=client)
        return lock_status(project_root)


def release_lock(project_root):
    with _WRITE_LOCK:
        lock = read_lock(project_root)
        if lock and lock.get("instanceId") == INSTANCE_ID:
            try:
                os.remove(_lock_path(project_root))
            except FileNotFoundError:
                pass
        return lock_status(project_root)


def assert_can_write(project_root):
    lock = read_lock(project_root)
    if lock_is_active(lock) and lock.get("instanceId") != INSTANCE_ID:
        raise ProjectLockedError(lock)


def _strip_bookkeeping(value):
    if isinstance(value, dict):
        return {k: _strip_bookkeeping(v) for k, v in value.items() if k not in BOOKKEEPING_KEYS}
    if isinstance(value, list):
        return [_strip_bookkeeping(v) for v in value]
    return value


def _short(value):
    text = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    return text if len(text) <= MAX_VALUE_CHARS else text[:MAX_VALUE_CHARS] + "…"


def _list_key(old, new):
    """Key list items by 'id' or 'name' when every item has one, unique within each list."""
    for key in ("id", "name", "runName"):
        ok = True
        for items in (old, new):
            if not all(isinstance(i, dict) and i.get(key) not in (None, "") for i in items):
                ok = False
                break
            values = [str(i[key]) for i in items]
            if len(set(values)) != len(values):
                ok = False
                break
        if ok and (old or new):
            return key
    return None


def diff_values(old, new, path="", out=None):
    """List of {path, old, new} for changed leaves (bookkeeping keys ignored)."""
    out = [] if out is None else out
    if isinstance(old, dict) and isinstance(new, dict):
        for key in sorted(set(old) | set(new), key=str):
            if key in BOOKKEEPING_KEYS:
                continue
            sub = f"{path}.{key}" if path else str(key)
            if key not in old:
                out.append({"path": sub, "old": None, "new": new[key], "kind": "added"})
            elif key not in new:
                out.append({"path": sub, "old": old[key], "new": None, "kind": "removed"})
            else:
                diff_values(old[key], new[key], sub, out)
        return out
    if isinstance(old, list) and isinstance(new, list):
        key = _list_key(old, new)
        if key:
            old_map = {str(i[key]): i for i in old}
            new_map = {str(i[key]): i for i in new}
            for name in list(old_map) + [n for n in new_map if n not in old_map]:
                sub = f"{path}[{key}={name}]"
                if name not in new_map:
                    out.append({"path": sub, "old": old_map[name], "new": None, "kind": "removed"})
                elif name not in old_map:
                    out.append({"path": sub, "old": None, "new": new_map[name], "kind": "added"})
                else:
                    diff_values(old_map[name], new_map[name], sub, out)
            return out
        for idx in range(max(len(old), len(new))):
            sub = f"{path}[{idx}]"
            if idx >= len(old):
                out.append({"path": sub, "old": None, "new": new[idx], "kind": "added"})
            elif idx >= len(new):
                out.append({"path": sub, "old": old[idx], "new": None, "kind": "removed"})
            else:
                diff_values(old[idx], new[idx], sub, out)
        return out
    if old != new:
        out.append({"path": path, "old": old, "new": new, "kind": "changed"})
    return out


def history_dir_for(project_root: str, path: str) -> str:
    rel = os.path.relpath(os.path.abspath(path), os.path.abspath(project_root))
    safe = rel.replace(os.sep, "__").replace("/", "__")
    return os.path.join(project_root, HISTORY_DIRNAME, safe)


def _copy_previous(project_root, path, stamp):
    target_dir = history_dir_for(project_root, path)
    os.makedirs(target_dir, exist_ok=True)
    ext = os.path.splitext(path)[1] or ".txt"
    target = os.path.join(target_dir, f"{stamp}{ext}")
    counter = 2
    while os.path.exists(target):
        target = os.path.join(target_dir, f"{stamp}_{counter}{ext}")
        counter += 1
    shutil.copy2(path, target)
    return target


def append_change_log(project_root: str, entry: dict) -> None:
    """Append one JSON line to History/change_log.jsonl. Never rewrites the log."""
    log_dir = os.path.join(project_root, HISTORY_DIRNAME)
    os.makedirs(log_dir, exist_ok=True)
    record = {"timestamp": _now().isoformat(), **_actor(), **entry}
    with open(os.path.join(log_dir, CHANGE_LOG_FILENAME), "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        handle.flush()
        try:
            os.fsync(handle.fileno())
        except Exception:
            pass


def _rel(project_root, path):
    return os.path.relpath(os.path.abspath(path), os.path.abspath(project_root)).replace(os.sep, "/")


def save_text_tracked(project_root: str, path: str, text: str, action: str = "save", context=None,
                      expected_version=None) -> dict:
    """Atomically write text, keeping the previous version and logging the change.

    expected_version: the version the caller loaded ('' = file did not exist).
    None skips the check (internal callers, old clients).
    """
    with _WRITE_LOCK:
        assert_can_write(project_root)
        if expected_version is not None:
            current = file_version(path)
            if str(expected_version) != current:
                raise StaleWriteError(path, str(expected_version), current)
        result = _save_text_tracked_unlocked(project_root, path, text, action, context)
        result["version"] = content_version(text)
        return result


def _save_text_tracked_unlocked(project_root, path, text, action, context):
    previous_bytes = None
    if os.path.exists(path):
        with open(path, "rb") as handle:
            previous_bytes = handle.read()

    previous_json = new_json = None
    previous_readable = True
    if previous_bytes is not None:
        try:
            previous_json = json.loads(previous_bytes.decode("utf-8-sig"))
        except Exception:
            previous_readable = False
    try:
        new_json = json.loads(text)
    except Exception:
        new_json = None

    if previous_bytes is not None and previous_bytes.decode("utf-8", errors="replace") == text:
        return {"changed": False, "historyCopy": None, "changeCount": 0}
    content_changed = True
    if previous_json is not None and new_json is not None:
        content_changed = _strip_bookkeeping(previous_json) != _strip_bookkeeping(new_json)

    stamp = _now().strftime("%Y%m%dT%H%M%S_%fZ")
    history_copy = None
    if previous_bytes is not None and content_changed:
        history_copy = _copy_previous(project_root, path, stamp)

    write_text_atomic(path, text)

    if not content_changed:
        return {"changed": False, "historyCopy": None, "changeCount": 0}

    if previous_bytes is None:
        changes, kind = [], "created"
    elif previous_json is not None and new_json is not None:
        changes, kind = diff_values(previous_json, new_json), "modified"
    else:
        changes, kind = [], "modified (previous file was not readable JSON)" if not previous_readable else "modified"
    entry = {
        "file": _rel(project_root, path),
        "action": action,
        "kind": kind,
        "historyCopy": _rel(project_root, history_copy) if history_copy else None,
        "changeCount": len(changes),
        "changes": [
            {"path": c["path"], "kind": c["kind"], "old": _short(c["old"]), "new": _short(c["new"])}
            for c in changes[:MAX_LOGGED_CHANGES]
        ],
        "changesTruncated": len(changes) > MAX_LOGGED_CHANGES,
    }
    if context:
        entry["context"] = context
    append_change_log(project_root, entry)
    return {"changed": True, "historyCopy": history_copy, "changeCount": len(changes)}


def save_json_tracked(project_root: str, path: str, payload, action: str = "save", context=None,
                      expected_version=None) -> dict:
    return save_text_tracked(project_root, path, json.dumps(payload, indent=2, ensure_ascii=False), action, context,
                             expected_version=expected_version)


def find_project_root(path: str):
    """Walk up from a file to the folder that holds Plan/ or Reports/ (the project)."""
    current = os.path.dirname(os.path.abspath(path))
    for _ in range(4):
        if os.path.isdir(os.path.join(current, "Plan")) or os.path.isdir(os.path.join(current, "Reports")):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return os.path.dirname(os.path.dirname(os.path.abspath(path)))
