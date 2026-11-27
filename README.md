# EXDA Dashboard

## Experimental Data Analysis & Research Management System

EXDA (EXperimental DAta) Dashboard is a research application for planning, running and documenting experimental test campaigns, developed for hydrogen explosion experiments, with CFD validation and literature-assisted analysis. It combines a React frontend, a Flask backend, scientific data-processing modules, and optional AI-assisted workflows in a single workspace.

The goal of the app is to make it easier to move from project setup, to experiment planning, to signal analysis, to reporting without bouncing between separate tools.

<sub>Development and AI assistance</sub>

<sub>EXDA was designed and developed by Javier I. Camacho. The code and the documentation, including the user guide, were written with the assistance of AI coding tools (OpenAI Codex and Anthropic Claude, including Claude Opus 5.5). All changes were reviewed by the author. The calculations are covered by automated tests; see the Developer Overview for what has been verified and what has not. Results shown by EXDA are for quick on-site checks and are not final, publication-grade results.</sub>

## What The App Covers

- Project creation and recovery for a standard research folder structure
- Experiment planning and workspace persistence
- Import of experimental and simulation data
- Pressure analysis, CFD validation, flame speed analysis, and EWT workflows
- AiRA, an optional AI research assistant for literature and project context
- Smoke, frontend, and backend tests for day-to-day validation

## 🚀 Quick Start

### ✅ Prerequisites

Install these once per computer:

- Node.js 22 LTS (20.19+ or 22.12+ also work)
- Python 3.10+ (3.12 recommended)
- Git, to download (clone) EXDA
- Ollama, optional, for local AiRA model support

On Windows and macOS the launcher checks for Node.js and Python. If either is missing, it offers to install it (Windows: `winget`, macOS: Homebrew) or opens the download page.

### 📥 Get EXDA

Make one folder called `EXDA` and put the app inside it:

```bash
mkdir EXDA
cd EXDA
git clone https://github.com/jcam77/EXDA-dashboard.git
```

Without git, download the ZIP from GitHub (**Code → Download ZIP**) and unzip it inside the `EXDA` folder. The unzipped folder may be called `EXDA-dashboard-main`; that is fine.

Use a local folder, for example `C:\EXDA` or `~/EXDA`, not OneDrive, iCloud Drive, Dropbox or Google Drive. After the first start the `EXDA` folder looks like this:

```text
EXDA/
├── EXDA                ← shortcut: double-click to start (EXDA.lnk on Windows)
├── EXDA-dashboard/     ← the app: replace this folder for a new version
└── EXDA-Projects/      ← your projects: created by EXDA, never touched by updates
```

### ▶️ Start EXDA

Double-click the launcher for your operating system:

- macOS: [EXDA.app](EXDA.app) (opens Terminal and runs [Run-EXDA-MAC.command](Run-EXDA-MAC.command)); after the first start, also the **EXDA** shortcut in the `EXDA` folder
- Windows: [Run-EXDA-WIN.bat](Run-EXDA-WIN.bat); after the first start, the **EXDA** shortcut in the `EXDA` folder or in the Start menu (and on the Desktop if you chose it)
- Linux: run [Setup-EXDA-LINUX.sh](Setup-EXDA-LINUX.sh) once, then [Run-EXDA-LINUX.sh](Run-EXDA-LINUX.sh)

**First start** on a computer (macOS and Windows): the launcher finds that EXDA is not set up yet and runs the setup script ([Setup-EXDA-MAC.command](Setup-EXDA-MAC.command) / [Setup-EXDA-WIN.bat](Setup-EXDA-WIN.bat)) automatically. This takes a few minutes and needs an internet connection. Setup:

- checks the Node.js and Python versions
- creates the Python environment for this operating system inside the app folder (`.venv-mac` on macOS, `.venv-win` on Windows, `.venv-linux` on Linux) and installs the Python packages
- installs the frontend packages (`npm install`) inside the app folder
- adds the **EXDA** shortcut: in the `EXDA` folder (when the app sits in its own folder), on Windows also in the Start menu, and on the Desktop only if you answer yes

Then EXDA starts.

**Every later start** runs a quick check, which takes about two seconds. If everything is in place, it starts the backend and frontend and opens EXDA in the browser. If something is missing, setup runs again first.

Because each operating system has its own Python environment, one EXDA folder can be used from macOS and Windows, for example on an external drive. Nothing is installed system-wide apart from Node.js and Python, and only if they are missing and you agree. For a new version, replace only the app folder; to remove EXDA, delete the app folder and the shortcuts. See [RUN_EXDA.md](RUN_EXDA.md#where-exda-installs-things) for the full list.

Full launcher notes are in [RUN_EXDA.md](RUN_EXDA.md).

### 🧪 MVP Mode (Simplified Workflow)

EXDA includes an MVP mode (Minimum Viable Product) for fast onsite work.

- Use the `MVP` button in the upper-right area of the app to toggle it on/off.
- The current state is saved in your browser (`localStorage`) and reused on next launch.
- You can also set startup default with env vars before launch:
  - `MVP_MODE=true`
  - or `VITE_MVP_MODE=true`
- Optional: protect turning MVP mode off with a developer password:
  - Default unlock password is `exda`
  - `EXDA_MVP_UNLOCK_PASSWORD=your-password`
  - or `VITE_MVP_UNLOCK_PASSWORD=your-password`

Current MVP simplifications include:

- hidden advanced tabs such as `Pressure Analysis` and `Data Preprocessing`
- a simplified `Raw Data Pressure Analysis` tab that reuses the same behavior as Data Preprocessing

### 📦 Manual Installation

If you do not want to use the setup scripts, you can still install everything manually.

From the repository root:

```bash
npm install
python3 -m venv .venv-linux  # on macOS use .venv-mac, on Windows .venv-win (the names the launchers use)
source .venv-linux/bin/activate
pip install -r backend/requirements.txt
# Optional extras (AiRA / local LLM):
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
source .venv-linux/bin/activate   # .venv-mac on macOS
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

AiRA now auto-detects a reachable Ollama host when no explicit override is set.
Resolution order is:

- `OLLAMA_HOST` (explicit full URL)
- `OLLAMA_IP` (+ optional `OLLAMA_PORT`)
- `OLLAMA_HOSTNAME` / `MAC_HOSTNAME` (+ optional `OLLAMA_PORT`)
- local `.ollama_hostname` file (advanced override)
- auto-probe common local/VM hosts:
  - `localhost`, `127.0.0.1`
  - `host.docker.internal`, `host.internal`
  - Linux default gateway IP
  - common VM host IPs (`10.211.55.2`, `10.0.2.2`)
- localhost fallback

Advanced override options (remote Ollama, VM routing, custom host) are:

- `OLLAMA_HOST` (preferred explicit override)
- optional local `.ollama_hostname` file (not committed; see `.ollama_hostname.example`)

## 🏷️ Versioning

This project uses git tags for releases instead of versioned folders.

Quick release helper:

```bash
./versioning.sh
```

`versioning.sh` asks only for the new release tag (for example `my-release-v2.9.0`), then auto-detects the app version from the tag suffix.

See `VERSIONING.md` for the exact workflow, examples, and tag naming guidance.

## 🛠️ Troubleshooting

- If backend startup fails, make sure the virtual environment is activated and `backend/requirements.txt` is installed.
- If AiRA features are unavailable, check whether Ollama and any optional backend dependencies are installed.
- If AiRA cannot connect to Ollama on your machine, verify Ollama is running locally at `http://localhost:11434`.
- If AiRA still cannot detect the correct host automatically, set `OLLAMA_HOST` to the full URL (for example `http://my-host:11434`).
- If PDF-related AI features are limited, install the optional backend requirements.
- If frontend tooling behaves strangely on shared or synced folders, check for macOS sidecar files such as `._*` and `.DS_Store`, which can interfere with JS tooling.
- If you need a packaged desktop build rather than the normal browser-first workflow, see [PACKAGING.md](PACKAGING.md).

## 🤝 Help And Contributing

All contact goes through GitHub; there is no public email address.

- **Bugs, ideas, accessibility barriers:** open an issue with the [issue forms](https://github.com/jcam77/EXDA-dashboard/issues/new/choose). Please never include confidential project data.
- **Security problems:** report them privately, see [SECURITY.md](.github/SECURITY.md).
- **Contributing:** see [CONTRIBUTING.md](.github/CONTRIBUTING.md) and the [code of conduct](.github/CODE_OF_CONDUCT.md).
- **Accessibility:** what EXDA does and its known limits are in [ACCESSIBILITY.md](.github/ACCESSIBILITY.md).
- **Look and feel:** [design guide](docs/EXDA-Design-Guide.md).

