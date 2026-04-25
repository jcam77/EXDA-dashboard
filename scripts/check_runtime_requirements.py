#!/usr/bin/env python3
"""Check EXDA runtime requirements that are easiest to validate from Python."""

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path


IMPORT_NAME_MAP = {
    "flask-cors": "flask_cors",
    "pymupdf": "fitz",
    "pywavelets": "pywt",
}


def requirement_name_to_import_name(requirement_name: str) -> str:
    normalized = requirement_name.strip().lower()
    if normalized in IMPORT_NAME_MAP:
        return IMPORT_NAME_MAP[normalized]
    return normalized.replace("-", "_")


def load_requirement_names(requirements_path: Path) -> list[str]:
    names: list[str] = []
    for raw_line in requirements_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        line = re.split(r"[<>=!~;\[]", line, maxsplit=1)[0].strip()
        if line:
            names.append(line)
    return names


def missing_imports(requirements_path: Path) -> list[str]:
    missing: list[str] = []
    for requirement_name in load_requirement_names(requirements_path):
        import_name = requirement_name_to_import_name(requirement_name)
        if importlib.util.find_spec(import_name) is None:
            missing.append(requirement_name)
    return missing


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--requirements", default="backend/requirements.txt")
    args = parser.parse_args()

    requirements_path = Path(args.requirements)
    if not requirements_path.exists():
        print(f"Could not find requirements file: {requirements_path}", file=sys.stderr)
        return 2

    missing = missing_imports(requirements_path)
    if not missing:
        return 0

    for requirement_name in missing:
        print(requirement_name)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
