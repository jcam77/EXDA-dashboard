# Linux build (Electron demo)

## Overview
The Electron app bundles a Python backend binary. For Linux ARM64 you must build
the backend on an ARM64 Linux host (or a VM) and then run the Electron packaging
step targeting ARM64 so the final AppImage launches correctly.

## Backend build (ARM64)
1) Install Python 3 and a working compiler toolchain on your ARM64 Linux VM.
2) From the repo root, run:
   ```bash
   ./backend/build_backend.sh
   ```
3) Confirm the backend binary is present at `backend/dist/exda-backend`.

## Electron packaging (ARM64)
1) From the repo root, run:
   ```bash
   npm install
   npm run dist:linux:arm64
   ```
2) The output artifacts are written to `dist-electron/`.

## Notes
- The packaged app searches for `backend/dist/exda-backend` at runtime. If the
  binary is missing or built for the wrong architecture, the app may appear to
  open and immediately exit.
