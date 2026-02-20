# Windows build (Electron demo)

This creates a Windows installer that bundles the frontend, backend, and demo project.

## Option A: GitHub Actions (Windows x64)
Workflow file: `.github/workflows/windows-build.yml`

1) Push this repo to GitHub.
2) Go to Actions → **Build Windows Installer** → Run workflow.
3) Download the artifact **EXDA-dashboard-windows-x64**.

Optional ARM64 build:
- Requires a self-hosted Windows ARM64 runner.
- When running the workflow, set **build_arm64 = true**.
  This uploads a second artifact named **EXDA-dashboard-windows-arm64**.

## Option B: Local Windows build

Tip: PowerShell may block scripts. Run this once per session if needed:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### 1) Build backend exe
From `EXDA-dashboard/backend` on Windows:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
# Optional: extra AI/analysis features
# py -m pip install -r requirements-optional.txt

./build_backend.ps1
```

Output: `EXDA-dashboard/backend/dist/exda-backend.exe`

### 2) Build frontend (demo mode)
From `EXDA-dashboard`:

```powershell
npm install
npm run build:demo
```

### 3) Build installer
From `EXDA-dashboard`:

```powershell
npm run dist:win
```

Installer output: `EXDA-dashboard/appsTestEnviroment/builds/windows/`

Notes:
- Demo projects are copied on first run to `Documents\EXDA Projects\Demo Projects`.
- AI is disabled in demo mode and shows a banner on the AI page.
- On ARM64 Windows, the installer will be ARM64; on x64 Windows, it will be x64.
- The NSIS installer allows users to choose the installation folder (no hidden installs).

## Troubleshooting

### PowerShell blocks scripts
If `build_backend.ps1` or `npm` scripts fail:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### npm install fails on shared drives
If you see `EINVAL` or symlink errors in `node_modules`:
- Copy the project to a short local path (e.g., `C:\EXDA-dashboard-win`) and run builds there.
- Avoid reusing `node_modules` created on Linux.

### Installer launches but shows spawn ENOENT
This means `exda-backend.exe` was not found inside the packaged app.
Checklist:
1) Ensure `backend/dist/exda-backend.exe` exists.
2) Rebuild installer: `npm run dist:win`.
3) Uninstall the old app (or delete `%LOCALAPPDATA%\Programs\exda-dashboard`) and install the new EXE.

### Python/Node not found
Make sure Python 3.12+ and Node.js LTS are installed and on PATH.
You can verify with:
```powershell
py --version
node -v
```
