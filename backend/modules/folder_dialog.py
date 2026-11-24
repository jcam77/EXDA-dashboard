"""Folder selection helpers for the local EXDA backend.

The backend runs on the user's own computer, so it can open the operating
system's folder dialog and list useful starting places (home folder, Desktop,
Documents, drives) for the in-app folder browser.

choose_folder() returns the chosen folder, "" when the user cancels, and
raises FolderDialogUnavailable when no dialog can be shown (for example on a
computer without a desktop session).
"""

import os
import shutil
import string
import subprocess
import sys
from pathlib import Path

DIALOG_TITLE = "Select a folder for EXDA"
DIALOG_TIMEOUT_S = 15 * 60


class FolderDialogUnavailable(RuntimeError):
    """No folder dialog could be shown on this computer."""


def _start_dir(initial_dir):
    if initial_dir and os.path.isdir(initial_dir):
        return initial_dir
    return os.path.expanduser("~")


def _run(cmd, env=None, **kwargs):
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=DIALOG_TIMEOUT_S,
        env=env,
        **kwargs,
    )


def _windows_dialog(initial_dir):
    # Values are passed through environment variables, so paths with quotes or
    # other special characters cannot break the PowerShell command.
    script = (
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
        "Add-Type -AssemblyName System.Windows.Forms; "
        "$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true; ShowInTaskbar = $false}; "
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; "
        "$dialog.Description = $env:EXDA_DIALOG_TITLE; "
        "$dialog.ShowNewFolderButton = $true; "
        "$dialog.SelectedPath = $env:EXDA_DIALOG_START; "
        "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) "
        "{ [Console]::Out.Write($dialog.SelectedPath) }"
    )
    env = dict(os.environ, EXDA_DIALOG_TITLE=DIALOG_TITLE, EXDA_DIALOG_START=_start_dir(initial_dir))
    result = _run(
        ["powershell", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
        env=env,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode != 0:
        raise FolderDialogUnavailable(result.stderr.strip() or "PowerShell folder dialog failed")
    return result.stdout.strip()


_MAC_SCRIPT = """
on run argv
  activate
  try
    set chosen to choose folder with prompt (item 1 of argv) default location (POSIX file (item 2 of argv))
  on error number -128
    return ""
  end try
  return POSIX path of chosen
end run
"""


def _mac_dialog(initial_dir):
    result = _run(["osascript", "-e", _MAC_SCRIPT, DIALOG_TITLE, _start_dir(initial_dir)])
    if result.returncode != 0:
        raise FolderDialogUnavailable(result.stderr.strip() or "macOS folder dialog failed")
    chosen = result.stdout.strip()
    return chosen.rstrip("/") or chosen


def _linux_dialog(initial_dir):
    start = _start_dir(initial_dir)
    if shutil.which("zenity"):
        result = _run([
            "zenity", "--file-selection", "--directory",
            f"--title={DIALOG_TITLE}", f"--filename={start.rstrip('/')}/",
        ])
    elif shutil.which("kdialog"):
        result = _run(["kdialog", "--getexistingdirectory", start, "--title", DIALOG_TITLE])
    else:
        raise FolderDialogUnavailable("zenity or kdialog is not installed")
    if "display" in result.stderr.lower():
        raise FolderDialogUnavailable("no desktop session to show the folder dialog")
    if result.returncode == 1 and not result.stdout.strip():
        return ""  # cancelled
    if result.returncode != 0:
        raise FolderDialogUnavailable(result.stderr.strip() or "folder dialog failed")
    return result.stdout.strip()


def _tk_dialog(initial_dir):
    script = (
        "import sys, tkinter as tk; from tkinter import filedialog; "
        "root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True); "
        "sys.stdout.write(filedialog.askdirectory(initialdir=sys.argv[1], title=sys.argv[2]) or '')"
    )
    result = _run([sys.executable, "-c", script, _start_dir(initial_dir), DIALOG_TITLE])
    if result.returncode != 0:
        raise FolderDialogUnavailable(result.stderr.strip() or "tkinter folder dialog failed")
    return os.path.normpath(result.stdout.strip()) if result.stdout.strip() else ""


def choose_folder(initial_dir=None):
    """Show the system folder dialog. Returns the folder, or "" when cancelled."""
    if os.name == "nt":
        native = _windows_dialog
    elif sys.platform == "darwin":
        native = _mac_dialog
    else:
        native = _linux_dialog
    errors = []
    for dialog in (native, _tk_dialog):
        try:
            return dialog(initial_dir)
        except (FolderDialogUnavailable, OSError, subprocess.SubprocessError) as error:
            errors.append(f"{dialog.__name__}: {error}")
    raise FolderDialogUnavailable("; ".join(errors))


def parent_folder(path):
    """Parent of a folder, or None at the top of a drive ("C:\\" or "/")."""
    current = Path(path)
    parent = current.parent
    return None if parent == current else str(parent)


def clean_path(path):
    """Accept paths as users paste them: surrounding quotes (Windows "Copy as
    path"), surrounding spaces and a leading ~ for the home folder."""
    text = (path or "").strip().strip('"').strip("'").strip()
    return os.path.expanduser(text) if text else ""


def quick_places(projects_root=None):
    """Starting points for the folder browser that exist on this computer."""
    places = []
    seen = set()

    def add(label, path, kind):
        if not path or not os.path.isdir(path):
            return
        key = os.path.normcase(os.path.abspath(path))
        if key in seen:
            return
        seen.add(key)
        places.append({"label": label, "path": path, "kind": kind})

    add("EXDA-Projects", projects_root, "projects")
    home = os.path.expanduser("~")
    add("Home", home, "home")
    for name in ("Desktop", "Documents", "Downloads"):
        add(name, os.path.join(home, name), "folder")
        add(f"{name} (OneDrive)", os.path.join(home, "OneDrive", name), "folder")

    if os.name == "nt":
        for letter in string.ascii_uppercase[2:]:  # skip A: and B:
            add(f"{letter}:", f"{letter}:\\", "drive")
    elif sys.platform == "darwin":
        try:
            volumes = sorted(os.listdir("/Volumes"))
        except OSError:
            volumes = []
        for name in volumes:
            if not name.startswith("."):
                add(name, os.path.join("/Volumes", name), "drive")
    else:
        add("/", "/", "drive")
        for base in (os.path.join("/media", os.environ.get("USER", "")), "/mnt"):
            try:
                names = sorted(os.listdir(base))
            except OSError:
                names = []
            for name in names:
                add(name, os.path.join(base, name), "drive")
    return places
