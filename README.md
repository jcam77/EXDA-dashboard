# EXDA Dashboard
### Explosion Data Analysis & Research Management System

EXDA Dashboard is a full-stack research application for hydrogen explosion experiments, CFD validation, and literature-assisted analysis. It combines a React frontend, a Flask backend, scientific data-processing modules, and optional AI-assisted workflows in a single workspace.

The goal of the app is to make it easier to move from project setup, to experiment planning, to signal analysis, to reporting without bouncing between separate tools.

## What The App Covers

- Project creation and recovery for a standard research folder structure
- Experiment planning and workspace persistence
- Import of experimental and simulation data
- Pressure analysis, CFD validation, flame speed analysis, and EWT workflows
- AiRA, an optional AI research assistant for literature and project context
- Smoke, frontend, and backend tests for day-to-day validation

## 🚀 Quick Start

### ✅ Prerequisites

- Node.js 18+
- npm
- Python 3.10+
- Ollama, optional, for local AiRA model support

### ▶️ Recommended Launchers

Users can prepare EXDA from a repository checkout with a one-time setup file for their operating system, then use the launcher normally afterwards.

Setup once:

- <img src="docs/assets/os-icons/linux.png" alt="Linux" width="16" height="16"> Linux: [Setup-EXDA-LINUX.sh](/Volumes/Sim_Back_Up/EXDA-dashboard/Setup-EXDA-LINUX.sh)
- <img src="docs/assets/os-icons/apple.png" alt="macOS" width="16" height="16"> macOS: [Setup-EXDA-MAC.command](/Volumes/Sim_Back_Up/EXDA-dashboard/Setup-EXDA-MAC.command)
- <img src="docs/assets/os-icons/windows.png" alt="Windows" width="16" height="16"> Windows: [Setup-EXDA-WIN.bat](/Volumes/Sim_Back_Up/EXDA-dashboard/Setup-EXDA-WIN.bat)

Then run EXDA with the launcher:

- <img src="docs/assets/os-icons/linux.png" alt="Linux" width="16" height="16"> Linux: [Run-EXDA-LINUX.sh](/Volumes/Sim_Back_Up/EXDA-dashboard/Run-EXDA-LINUX.sh)
- <img src="docs/assets/os-icons/apple.png" alt="macOS" width="16" height="16"> macOS: [Run-EXDA-MAC.command](/Volumes/Sim_Back_Up/EXDA-dashboard/Run-EXDA-MAC.command)
- <img src="docs/assets/os-icons/windows.png" alt="Windows" width="16" height="16"> Windows: [Run-EXDA-WIN.bat](/Volumes/Sim_Back_Up/EXDA-dashboard/Run-EXDA-WIN.bat)

The setup script will:

- create or repair `.venv`
- install npm dependencies
- install backend Python requirements
- install optional feature requirements
- verify the installation

The launcher will then:

- check for required tools and packages
- report anything missing
- start the backend
- start the frontend
- open EXDA in the browser

Full launcher notes are in [RUN_EXDA.md](/Volumes/Sim_Back_Up/EXDA-dashboard/RUN_EXDA.md).

### 📦 Manual Installation

If you do not want to use the setup scripts, you can still install everything manually.

From the repository root:

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
# Optional extras:
# pip install -r backend/requirements-optional.txt
```

### ▶️ Manual Run

The simplest way in this repo is:

```bash
./run exda
```

On Windows Command Prompt, use:

```bat
run exda
```

On Windows PowerShell, use:

```powershell
.\run.cmd exda
```

That wrapper runs the app's browser-first launcher for you.

If you want to start the services manually instead, use the two-terminal flow below.

Start the backend:

```bash
source .venv/bin/activate
python backend/app.py
```

In a second terminal, start the frontend:

```bash
npm run dev
```

Open the app at `http://localhost:5173`.

## 🧰 Most Useful Commands

```bash
# Simplest local startup (Linux/macOS)
./run exda

# Simplest local startup (Windows cmd.exe)
run exda

# Browser-first launcher docs
# See RUN_EXDA.md

# Frontend dev server + backend helper scripts
npm run dev

# Production frontend build
npm run build

# Lint frontend code
npm run lint

# Backend calculation tests
npm run test:backend

# Frontend unit tests
npm run test:frontend

# End-to-end tests
npm run test:e2e

# Main smoke test
npm run smoke

# Full test suite
npm run test:all

# Open Playwright HTML report
npm run test:report
```

## 🏗️ Architecture

EXDA Dashboard uses a decoupled client-server setup.

### Frontend

- React SPA powered by Vite
- React Router-based workspace and page navigation
- Recharts and custom plotting components for research visualisation
- Tailwind-based styling and app shell UI
- Keyboard shortcuts overlay, opened with `?`
- Playwright-based smoke and end-to-end coverage

Key entry points:

- `frontend/src/main.jsx`
- `frontend/src/app/AppShell.jsx`
- `frontend/src/features/workspace/WorkspacePage.jsx`

### Backend

- Flask REST API for project operations and analysis endpoints
- NumPy-based scientific calculations for pressure and related metrics
- Project-state loading, rehydration, and folder management
- Optional AiRA routes for model-backed research workflows

Key backend files:

- `backend/app.py`
- `backend/routes/calculation_api_routes.py`
- `backend/routes/projects.py`
- `backend/routes/state.py`
- `backend/routes/ai.py`

Core analysis modules:

- `backend/modules/pressure_analysis.py`
- `backend/modules/flame_analysis.py`
- `backend/modules/ewt_analysis.py`
- `backend/modules/plot_interpolation.py`

### 📁 Project Folder Convention

Each research project follows a predictable structure so the app can recover state and route files consistently:

- `Plan/`
- `Raw_Data/`
- `Clean_Data/`
- `Literature/`
- `aiChat/`

Inside `Literature/`, the app expects:

- `Books/`
- `Papers/`
- `Standards/`

The repository also keeps `appsTestEnviroment/` as a recoverable skeleton for expected folder structure.

## ✨ Main Features

- Unified navigation across Home, Projects, Verification, AiRA, and workspace tabs
- Experiment planning with saved JSON state and recovery
- Explicit import paths for experiment and simulation datasets
- Pressure analysis and CFD comparison workflows
- EWT and flame speed analysis views
- Literature and report pages tied to project context
- AiRA context awareness from both project state and repository context
- Recent projects and quick resume workflow

## 🧪 Testing And QA

This repository has three main test layers:

- Backend calculations: `backend/tests/test_calculations_reference.py`
- Frontend unit tests: `frontend/tests/*.test.js`
- Playwright end-to-end tests: `tests/e2e/*.spec.ts`

### Common Test Commands

```bash
npm run test:backend
npm run test:frontend
npm run test:e2e
npm run smoke
npm run test:all
```

### Playwright Notes

- Playwright output is written to `test-report-results/`
- `playwright.config.ts` starts both the frontend and backend smoke servers automatically
- Open the HTML report with:

```bash
npm run test:report
```

For more test details, see `tests/README.md`.

## 🤖 AiRA Notes

AiRA is the app's research assistant workflow. It can use:

- Project overview and current app context from the frontend
- Repository context from backend endpoints such as `/app_repo_context`
- Optional local model access through Ollama

Relevant files:

- `frontend/src/pages/AiRA.jsx`
- `backend/routes/ai.py`

If Ollama is not installed, the rest of the app can still run, but AI features will be limited.

For typical user installs (EXDA and Ollama on the same machine), AiRA uses:

- `http://localhost:11434`

No hostname file edits are needed for that default case.

Advanced override options (remote Ollama, VM routing, custom host) are:

- `OLLAMA_HOST` (preferred explicit override)
- optional local `.ollama_hostname` file (not committed; see `.ollama_hostname.example`)

## 🏷️ Versioning

This project uses git tags for releases instead of versioned folders.

See `VERSIONING.md` for the exact workflow, examples, and tag naming guidance.

## 🛠️ Troubleshooting

- If backend startup fails, make sure the virtual environment is activated and `backend/requirements.txt` is installed.
- If AiRA features are unavailable, check whether Ollama and any optional backend dependencies are installed.
- If AiRA cannot connect to Ollama on your machine, verify Ollama is running locally at `http://localhost:11434`.
- If you intentionally run Ollama on another host, set `OLLAMA_HOST` to the full URL (for example `http://my-host:11434`).
- If PDF-related AI features are limited, install the optional backend requirements.
- If frontend tooling behaves strangely on shared or synced folders, check for macOS sidecar files such as `._*` and `.DS_Store`, which can interfere with JS tooling.
- If you need a packaged desktop build rather than the normal browser-first workflow, see [PACKAGING.md](/Volumes/Sim_Back_Up/EXDA-dashboard/PACKAGING.md).
