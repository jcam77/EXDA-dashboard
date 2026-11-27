# Handoff: releases 4.0.12 to 5.0.9 (November 2026)

Context for the next developer or assistant session. EXDA is a Flask backend
plus a React/Vite frontend used for a fast on-site OK/repeat check of test
runs; detailed analysis stays in MATLAB.

State at hand-off: release `browser-MVP-v5.0.9` tagged, working tree clean,
verified on Windows, macOS and Linux. Tests: backend 176 (5 skipped),
frontend 93 (vitest), eslint clean.

## How releases work

- The maintainer releases with `./versioning.sh browser-MVP-vX.Y.Z`.
  Assistants run only `./versioning.sh --dry-run ...` and never commit.
- `versioning.sh` stages only `ALLOWED_DIRS` / `ALLOWED_FILES`; `.github`
  was added this session.
- The repository is public: no real project data in screenshots or demo
  files, and no personal email addresses (contact is through GitHub).

## What changed

### Install layout and launchers

| Change | Files | Why |
| --- | --- | --- |
| Parent-folder layout `EXDA/{EXDA shortcut, EXDA-dashboard, EXDA-Projects, EXDA-Projects-Demo}`; the user creates `EXDA/` and clones into it | README.md, RUN_EXDA.md, user guide sections 2–4 | Make it clear where everything is installed; app and data are separate |
| `EXDA-Projects` is created next to the app folder only if no projects folder is found; legacy `<app>/Projects` is used only if it has content | backend/routes/projects.py (`_projects_root_default`, `_is_inside_app_folder`) | Project data should not live inside the app folder |
| Setup scripts print install locations, warn about cloud-synced folders, create shortcuts | Setup-EXDA-*, scripts/make_shortcuts.ps1 | No hidden installs; removing EXDA = delete the folder and the shortcut |
| Backend port 5000 → 5077 | config/exda-defaults.env (`EXDA_DEFAULT_BACKEND_PORT`), launchers | macOS AirPlay Receiver occupies 5000 ("Backend not running?" on Mac) |
| `/exda_health` endpoint and `scripts/check_exda_backend.py` (exit 0 = EXDA, 1 = nothing, 2 = another program) | backend/app.py, launchers | Launchers can tell "port in use by something else" from "EXDA is up" |
| Debug mode off by default (`EXDA_BACKEND_DEBUG=0`); set `1` for development | all Run-EXDA-* launchers, RUN_EXDA.md | Colleagues start from the shortcut; debug/reloader is for development only |
| Windows launcher shows backend output in its window (no temp log), CRLF line endings kept | Run-EXDA-WIN.bat, .gitattributes (`*.ps1 text eol=crlf`) | Windows terminal now logs requests like macOS/Linux |
| `BROWSERSLIST_IGNORE_OLD_DATA=1` in launchers; caniuse-lite updated | launchers, frontend/package-lock.json | Removes the "Browserslist: data is old" warning |

### Features

| Change | Files | Why |
| --- | --- | --- |
| Capabilities word cloud on the Projects overview: built from loaded projects, empty card when none loaded, click a term to filter, filter bar "Showing N of M … Show all" | frontend/src/components/CapabilityCloud.jsx, utils/capabilityCloud.js, pages/Projects.jsx; backend `capabilities` in `/list_projects`, `capability_terms()` in modules/project_description.py | Show research/experimental capabilities at a glance; visible filter so users don't forget an active selection |
| Technical skills field from a standard list, new skills can be added (category required) | backend/modules/skills_catalog.py, routes/project_description.py (`/skills_catalog`, `/add_skill_to_catalog`), frontend SkillPicker.jsx, utils/skillsCatalog.js; catalog file `EXDA-Projects/exda-skills.json` | Consistent skill names across projects (input for a later team skills map) |
| Demo projects filled with made-up engineering descriptions | docs/EXDA-User-Guide/tools/make_demo_project.py | Demo cloud and guide screenshots without real data |
| AI-assistance note (Codex and Claude Opus 5.5) | README.md, user guide, Home page Usage Disclaimer | Transparency about how the app and guide were developed |
| GitHub community files (no public email) | .github/* | GitHub community checklist; contact through GitHub |

### Bug fixes

| Bug | Fix | Files |
| --- | --- | --- |
| Windows: run card saved absolute paths with backslashes, raw data not detected | Relative paths stored with `/` (`.replace(os.sep, "/")`); frontend path helpers accept both separators | backend/routes/state.py, literature.py; frontend utils/runFiles.js, utils/pickerStart.js |
| Folder picker opened at an unrelated default path | Starts at the folder that holds the projects | utils/pickerStart.js, `/list_directories` (`recommendedProjectsRoot`, `insideAppFolder`) |
| Long paths broke at hyphens; Windows chips showed full paths | `PathText` wraps only after separators | frontend/src/components/PathText.jsx |
| Same request sent up to 6× per folder (StrictMode double effects, Home + Projects asking for the same lists) | `fetchJsonShared`: identical in-flight GETs share one answer, reused for 2 s; any non-GET clears the cache; `force` on Refresh/after changes | frontend/src/utils/sharedFetch.js, utils/clientId.js, pages/Projects.jsx, Home.jsx |

### Design clean-up (5.0.6)

- All fixed palette classes moved to theme tokens in `frontend/src/index.css`
  (dark on `:root`, light under `.light`, `hsl(var(--token))` so `/alpha`
  works). Legacy compatibility layer removed. Only modal backdrops keep
  `bg-black/60–80`.
- New tokens `--cloud-*` and `--series-1..8`, checked for contrast with the
  dataviz palette validator. Series order: blue, orange, aqua, yellow, violet,
  red, green, magenta (no pink; red matches the DBI logo).
- Plots read colours from tokens (`utils/themeColors.js`), so uPlot and
  Recharts follow the theme. Plan timeline uses token colours.
- Minimum text size 11 px on advanced screens.
- Rules written down in `docs/EXDA-Design-Guide.md`
  (`design_guidelines.json` now only points to it).

### Documentation

- README, RUN_EXDA.md (Get EXDA, shortcut table, install locations,
  remove/update, ports, development mode), user guide (title shows 5.0.7;
  sections 2–4 and a troubleshooting row updated), Developer Overview
  (changes table through 5.0.9, test counts).

### New tests

- Backend: test_projects_root, test_project_description, test_skills_catalog,
  test_raw_data_listing, test_health.
- Frontend: capability-cloud, picker-start, run-files, skills-catalog,
  windows-paths, path-text, shared-fetch.

## Decisions and reasons

- **App and data are separate folders.** Updating or deleting the app must
  never touch project data. EXDA creates `EXDA-Projects` only if no
  projects folder is found.
- **Demo folder shipped with the download.** The maintainer shares demo
  projects with colleagues directly, so it is not auto-generated.
- **Port 5077, not 5000.** 5000 clashes with macOS AirPlay Receiver.
- **Debug off by default.** Developers set `EXDA_BACKEND_DEBUG=1` in their
  own shell profile; the setting is not changed by the app or launchers.
- **Short-lived shared cache instead of a global store.** Fixes duplicate
  requests with one small module; writes always clear it, so lists are
  never stale after a change.
- **Skills from a catalog, extendable.** Free text would make the planned
  team map unusable; a locked list would block new work.
- **Project team field postponed.** People often hold several roles on one
  project; the data model needs a decision first.
- **Flask development server kept.** The "This is a development server"
  warning is harmless here: backend listens on 127.0.0.1, one user.

## Known issues / open items

- Flask prints the development-server warning on every start (cosmetic).
- User guide title still says 5.0.7 (content is current; update on the
  next guide revision).
- Defaults audit items F17–F19 are still open (gas mixing prefills chamber
  geometry, TPC5 preview assumes missing attributes, assumed units not shown;
  see the Developer Overview).
- GitHub Private vulnerability reporting must be enabled by the repo owner
  (Settings → Code security); SECURITY.md already refers to it.
- No per-run OK/Repeat verdict yet (to be discussed with colleagues).

## Planned improvements (priority order)

1. Collect feedback from the colleague hands-on session (installation on
   their machines, demo projects, cloud and skills field).
2. Per-run OK/Repeat verdict, if colleagues confirm they want it (core of
   the on-site MVP goal).
3. Close defaults audit F17–F19.
4. Optional (December 2026): run the backend with Waitress for normal use
   and keep Flask's server when `EXDA_BACKEND_DEBUG=1`; removes the
   warning. One extra package; launchers change.
5. Project team field, once the multi-role model is decided.
6. Team skills map as a separate app (planned February 2027), reusing the
   EXDA design guide and the skills catalog.

## Working notes for the next session

- Don't stop or reuse the maintainer's running EXDA (5077/5173). Test copies
  run on 5055/5175 with `EXDA_FRONTEND_PORT=5175` (needed for CORS).
- Delete stale `.exda.lock` files left by test runs; they make pages
  read-only.
- Screenshots: Playwright with Chromium, both light and dark themes, demo
  data only. Guide media: docs/EXDA-User-Guide/tools/record_guide_media.mjs.
- Don't overwrite existing project metadata when testing.
