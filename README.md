# EXDA-Dashboard
### Explosion Data Analysis & Research Management System

**EXDA-Dashboard** is a specialized full-stack software suite developed for Industrial Engineering PhD research focusing on **Hydrogen Explosion Modelling & Experimental Validation**. It provides a unified interface for experimental planning, high-frequency signal processing, and AI-assisted literature review.

## Versioning (Tags)
This project uses **git tags** for versions instead of versioned folders.  
See `VERSIONING.md` for the exact commands and workflow.

## Quick Setup
1. Install frontend dependencies (from repo root):
   `npm install`
2. Install backend dependencies (from repo root):
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
# Optional extras:
# pip install -r backend/requirements-optional.txt
```
3. Run the backend:
   `python backend/app.py`
4. Run the frontend (in a new terminal):
   `npm run dev`



## 🏗️ System Architecture

The application utilizes a decoupled client-server architecture to bridge high-level data visualization with low-level system file management:

### 1. Frontend: React & Vite
* **Core**: React 18+ SPA powered by **Vite** for optimized development.
* **Data Visualization**: Uses **Recharts** for explosion metrics like $P_{max}$, $t_{max}$, and impulse.
* **UI/UX**: Tailwind CSS with light/dark theming and monochrome, research-first styling.
* **Markdown Support**: Integrated `marked` library for AI research responses.

### 2. Backend: Flask & Python
* **API Service**: Flask server managing RESTful endpoints for data analysis and project state recovery.
* **Scientific Computing**: Uses **NumPy** for signal processing, including filtering and metrics extraction.
* **System Integration**: Project Manager opens native OS folder dialogs and reveals project folders.
* **AI Integration**: Optional **Ollama** integration for **AiRA** (Artificial Intelligence Research Assistant).

### 3. Project Structure & Persistence
The system enforces a standardized PhD project hierarchy created during initialization:
* `Plan/`: Stores experimental matrices and stoichiometric calculations in JSON format.
* `Raw_Data/`: Repository for experimental CSV/TXT logs and OpenFOAM simulation data (`p`, `p_rgh`).
* `Literature/`: Organized by `Books`, `Papers`, and `Standards` for automated AI indexing.
* `aiChat/`: Persistent history of AI research sessions.

## 🛠️ System Architecture

EXDA-Dashboard uses a decoupled client-server architecture:

### 1. Frontend: React + Vite
- **React 18+ SPA** (Vite-powered)
- **Tailwind CSS** for modern, research-focused UI (light/dark mode)
- **Recharts** for data visualisation (explosion metrics, time series)
- **React Router** for tabbed navigation
- **Keyboard shortcuts** overlay (press `?`)
- **Playwright** for E2E/smoke testing

### 2. Backend: Flask + Python
- **Flask REST API** for all data, analysis, and project management
- **NumPy** for signal processing (filtering, metrics)
- **Project state**: auto-save, rehydration, and folder management
- **Optional AiRA**: AI assistant via Ollama (if enabled)

### 3. Project Structure
- `Plan/` – Experimental matrices, stoichiometry (JSON)
- `Raw_Data/` – Experimental logs, OpenFOAM data
- `Literature/` – `Books/`, `Papers/`, `Standards/` (AI-indexed)
- `aiChat/` – Persistent AI research chat history

## ✨ Key Features
* Unified header/tabs with consistent navigation and status badges.
* Experiment Plan with auto-save and project rehydration.
* Data import workflow with explicit Simulation/Experiment selectors.
* Analysis tabs: EWT, Pressure Analysis, Flame Speed Analysis.
* AiRA chat with model status, cloud-powered badge, and safety warning.
* Recent Projects strip and quick Import Data CTA on Home.
* Keyboard shortcuts overlay (press `?`).
* Clickable project title to reveal project folder.



---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v18+) & **npm**
- **Python** (3.10+)
- **Ollama** (optional, for AiRA)

### Installation
1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd EXDA-dashboard
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Install backend dependencies**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r backend/requirements.txt
   # Optional extras:
   # pip install -r backend/requirements-optional.txt
   ```

4. **Run the backend server**
   ```bash
   source .venv/bin/activate
   python backend/app.py
   ```

5. **Run the frontend dev server** (in a new terminal)
   ```bash
   npm run dev
   ```

6. **Open the app**: [http://localhost:5173](http://localhost:5173)

## 🧪 Smoke Tests
Run the smoke tests:

```bash
npm run smoke
```

Generate the HTML report in the single folder:

```bash
npx playwright test tests/smoke.spec.ts --reporter=html
```

Open the report:

```bash
npm run test:report
```

Report folder: `test-report-results/`.

## 🧪 Testing & QA

### Smoke Tests (Playwright)

Run all smoke tests (UI + API + integration):
```bash
npm run smoke
```

If Playwright reports missing system libraries, run:
```bash
npx playwright install-deps
```

After running, open the HTML report:
```bash
npm run test:report
```

#### What is covered?
- Home, Projects, AiRA, Analysis, and navigation
- Keyboard shortcuts, theme toggle, responsive layout
- Backend endpoints: `/list_directories`, `/get_models`, `/projects_overview`, `/analyze`, `/aggregate_plot`, `/list_research_pdfs`, `/get_state`
- Integration: no React errors, no console errors, works on desktop/tablet

See `tests/README.md` for full test breakdown.
