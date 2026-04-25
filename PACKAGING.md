# Packaging EXDA

Packaging is now a secondary workflow.

The primary way to run EXDA is through the browser-first launchers documented in [RUN_EXDA.md](/Volumes/Sim_Back_Up/EXDA-dashboard/RUN_EXDA.md).

Use packaging only when you intentionally want a desktop deliverable such as:

- a Windows installer
- a macOS app bundle or DMG
- a Linux AppImage

## Current packaging path

EXDA still supports Electron packaging and Python backend bundling.

Relevant files:

- [package.json](/Volumes/Sim_Back_Up/EXDA-dashboard/package.json)
- [electron/main.cjs](/Volumes/Sim_Back_Up/EXDA-dashboard/electron/main.cjs)
- [backend/build_backend.sh](/Volumes/Sim_Back_Up/EXDA-dashboard/backend/build_backend.sh)
- [backend/build_backend.ps1](/Volumes/Sim_Back_Up/EXDA-dashboard/backend/build_backend.ps1)
- [backend/exda-backend.spec](/Volumes/Sim_Back_Up/EXDA-dashboard/backend/exda-backend.spec)

## Packaging scripts

From the repository root:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
npm run dist:linux:arm64
npm run dist:linux:appimage
```

## Backend binary builds

Electron packaging expects a packaged backend binary for release builds.

### Linux

```bash
./backend/build_backend.sh
```

Output:

- `backend/dist/exda-backend`

### Windows

```powershell
cd backend
./build_backend.ps1
```

Output:

- `backend/dist/exda-backend.exe`

### macOS

On macOS, the backend can be built with:

```bash
cd backend
python3 -m pip install -U pyinstaller
python3 -m pip install -r requirements.txt
pyinstaller exda-backend.spec
```

Output:

- `backend/dist/exda-backend`

## Recommendation

- use the launchers for team testing and day-to-day work
- use packaging only when you truly need a distributable desktop artifact
