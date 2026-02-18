# EXDA Dashboard

Explosion Data Analysis and research workflow app for hydrogen explosion experiments and CFD validation.

## Quick Setup
1. Install Node dependencies (repo root):
```bash
npm install
```
2. Create and activate Python venv:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
# optional
# pip install -r backend/requirements-optional.txt
```
3. Start backend:
```bash
source .venv/bin/activate
python backend/app.py
```
4. Start frontend (new terminal):
```bash
npm run dev
```

## Build, Lint, Test
```bash
npm run lint
npm run build
npm run smoke
```

## App Structure
Core entry flow:
- `frontend/src/main.jsx` -> mounts app
- `frontend/src/app/AppShell.jsx` -> router shell (BrowserRouter/HashRouter)
- `frontend/src/features/workspace/WorkspacePage.jsx` -> main workspace, tabs, shared state

Shared analysis logic:
- `frontend/src/features/workspace/hooks/useAnalysisPipeline.js`
- `frontend/src/features/analysis/PressureAnalysisWorkbench.jsx`

Main tab pages:
- `frontend/src/pages/Home.jsx`
- `frontend/src/pages/Projects.jsx`
- `frontend/src/pages/Checklist.jsx`
- `frontend/src/pages/Plan.jsx`
- `frontend/src/pages/GasMixing.jsx`
- `frontend/src/pages/ImportData.jsx`
- `frontend/src/pages/EwtAnalysis.jsx`
- `frontend/src/pages/PressureAnalysis.jsx`
- `frontend/src/pages/CFDValidation.jsx`
- `frontend/src/pages/FlameSpeedAnalysis.jsx`
- `frontend/src/pages/AiRA.jsx`
- `frontend/src/pages/Report.jsx`
- `frontend/src/pages/Literature.jsx`

Backend analysis/calculation files to verify first:
- `backend/modules/pressure_analysis.py`
- `backend/modules/flame_analysis.py`
- `backend/modules/ewt_analysis.py`
- `backend/modules/plot_interpolation.py`
- `backend/routes/calculation_api_routes.py`

## AiRA Context Awareness
AiRA receives both:
- Project overview/context from frontend (`app_context`)
- Repository snapshot context from backend (`/app_repo_context`)

Relevant files:
- `frontend/src/pages/AiRA.jsx`
- `backend/routes/ai.py`

Useful endpoint:
- `GET /app_repo_context` -> returns current app structure/codebase snapshot used by AiRA.

## Project Folder Convention
A project uses this structure:
- `Plan/`
- `Raw_Data/`
- `Clean_Data/`
- `Literature/` (`Books/`, `Papers/`, `Standards/`)
- `aiChat/`

`appsTestEnviroment/` is kept as a skeleton folder set (via `.gitkeep`) so structure is recoverable.

## Versioning
This repo uses git tags for releases. See `VERSIONING.md`.
