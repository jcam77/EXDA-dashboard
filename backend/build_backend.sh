#!/usr/bin/env bash
set -euo pipefail

# Build a Linux backend executable for Electron packaging.
# Run this from the EXDA-dashboard repository root on a Linux machine.

python3 -m pip install --upgrade pip pyinstaller
python3 -m pip install -r backend/requirements.txt

python3 -m PyInstaller --noconfirm --onefile --name exda-backend \
  --add-data "backend/routes:routes" \
  --add-data "backend/modules:modules" \
  backend/app.py

# Output: backend/dist/exda-backend
