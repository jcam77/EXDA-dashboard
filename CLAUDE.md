# CLAUDE.md

Guidance for AI coding assistants (Claude Code, and others that read this file)
working in this repository. Keep it short and current; details live in the
documents linked below.

**This repository is public.** Nothing private goes into this file or any other
tracked file. Private working notes live in the git-ignored places listed under
[AI working files](#ai-working-files).

## What EXDA is

EXDA (EXperimental DAta) Dashboard is a local web app for planning, running and
documenting experimental test campaigns (developed for vented hydrogen
deflagration tests). A React 19 + Vite 7 single-page app talks to a Flask API on
the same computer. There is no database: the project folder on disk is the
record.

The current focus is **MVP mode**: a fast on-site "run OK / repeat" check of each
test. Detailed analysis is done elsewhere (MATLAB), so EXDA results are screening
results, not publication-grade results.

## Where to look first

| Topic | Document |
| --- | --- |
| Architecture, repository map, request flows, project data on disk | [docs/EXDA-Developer-Overview/EXDA-Developer-Overview.md](docs/EXDA-Developer-Overview/EXDA-Developer-Overview.md) |
| Open findings: calculations (F1–F19), code structure (S1–S9) | same file, sections 6–7 |
| Look and feel, theme tokens, chart colours | [docs/EXDA-Design-Guide.md](docs/EXDA-Design-Guide.md) |
| Install layout, launchers, ports | [RUN_EXDA.md](RUN_EXDA.md), [README.md](README.md) |
| Releases | [VERSIONING.md](VERSIONING.md), [versioning.sh](versioning.sh) |
| User guide and its media tools | [docs/EXDA-User-Guide/](docs/EXDA-User-Guide/) |
| Tests | [tests/README.md](tests/README.md), [backend/VERIFICATION.md](backend/VERIFICATION.md) |

## Layout in one screen

- `backend/app.py`: Flask app. Blueprints in `backend/routes/` (`state.py` is the
  large one: saves, exports, lock, raw files, channel peaks). Calculations and
  file readers in `backend/modules/`. Tests in `backend/tests/` (unittest).
- `frontend/src/`: `main.jsx` → `app/AppShell.jsx` →
  `features/workspace/WorkspacePage.jsx` (tabs, project state, lock). Tabs in
  `pages/`, shared logic in `utils/`, tests in `frontend/tests/` (vitest).
- `tests/e2e/`: Playwright end-to-end tests.
- `electron/`: optional desktop build. `config/exda-defaults.env`: default hosts
  and ports.
- Launchers: `Setup-EXDA-*` (first start) and `Run-EXDA-*` (every start) for
  macOS (`.command`, `EXDA.app`), Windows (`.bat`) and Linux (`.sh`).

## Commands

```bash
npm run dev                 # Vite (5173) + Flask backend (5077), debug on
./run exda                  # browser-first launcher, as users start it

python3 -m unittest discover -s backend/tests -v   # all backend tests
npm run test:frontend       # vitest
npm run lint                # eslint
npm run test:e2e            # Playwright
npm run test:all            # backend reference tests + vitest + Playwright
```

`npm run test:backend` runs only the calculation reference tests; use
`unittest discover` for the full backend suite. Run backend and frontend tests
and lint before saying a change is done, and report the counts.

## Working rules

- **Commits and releases.** Commit only when the maintainer asks, staging
  explicit paths (never `git add -A` or `git add .`). Develop on a `*-Updates`
  branch. Releases are made by the maintainer with
  `./versioning.sh browser-MVP-vX.Y.Z`; assistants may run only
  `./versioning.sh --dry-run`. A new top-level file must be added to
  `ALLOWED_FILES` in `versioning.sh`, or the release script will refuse to run.
- **Never commit data.** No project folders, measurement files (`*.tpc5`,
  `*.mf4`, `*.seq`), Python environments (`.venv*`), or real campaign data in
  screenshots. Guide media use synthetic demo projects only
  (`docs/EXDA-User-Guide/tools/make_demo_project.py`).
- **Never alter existing run metadata or project records** when testing. Tests
  use temporary folders.
- **Do not touch the maintainer's running EXDA** (5077/5173). Run a test copy on
  other ports, for example
  `EXDA_BACKEND_PORT=5055 EXDA_FRONTEND_PORT=5175 EXDA_PROJECTS_ROOT=<demo folder>`
  (the frontend port is needed for CORS). Delete stale `.exda.lock` files left by
  test runs; they make pages read-only.
- **No silent default values in calculations.** A missing input should stop the
  calculation or be shown as assumed, not be filled in quietly (see the
  "no default values" audit, F17–F19).
- **App and data stay separate.** Project data lives in `EXDA-Projects/` beside
  the app folder. Replacing or deleting the app folder must never touch it, and
  EXDA never moves project data itself.

## Conventions and pitfalls

- **Style:** use the theme tokens in `frontend/src/index.css` (dark on `:root`,
  light under `.light`), never fixed palette classes. Check light and dark
  themes. Plot colours come from `utils/themeColors.js`. Minimum text size 11 px.
- **Paths:** store relative paths with `/` separators; frontend path helpers
  accept both separators (Windows).
- **Line endings:** `.bat` and `.ps1` files keep CRLF (`.gitattributes`).
- **Executable bits:** the repo is often edited on exFAT with
  `core.fileMode=false`, so set launch scripts to 100755 in the index
  (`git update-index --chmod=+x <file>`) or they will not run after a clone.
- **Ports:** backend 5077, not 5000 (macOS AirPlay Receiver uses 5000).
  `/exda_health` lets launchers tell EXDA apart from another program on the port.
- **Shared GET cache:** `utils/sharedFetch.js` merges identical in-flight GETs;
  any non-GET clears it. Pass `force` after a change.
- **API responses:** follow the existing route patterns in the blueprint you are
  editing; new feature areas get their own blueprint rather than growing
  `routes/state.py`.

## AI working files

All AI-assistant working material is kept out of git in one place:

| Path | Tracked | Purpose |
| --- | --- | --- |
| `CLAUDE.md` (this file) | yes, public | Shared project rules for assistants |
| `CLAUDE.local.md` | no | Private instructions for the maintainer's own sessions; loaded automatically by Claude Code |
| `claude-context/` | no | Private handoff notes, roadmap and session outputs |
| `.claude/settings.local.json` | no | Local Claude Code settings |
| `.codex` | no | Local Codex files |

At the end of a working session, update the handoff notes in `claude-context/`
(what changed, decisions and reasons, open issues, next steps), not files under
`docs/`.
