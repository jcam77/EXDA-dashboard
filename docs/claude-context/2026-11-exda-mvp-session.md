# Handoff: EXDA MVP session, 23–25 November 2026 (releases 4.0.11–4.0.14)

Context for the next working session. Factual summary of what was changed,
why, what was decided, and what is still open. Written 27 November 2026.

Releases 4.0.15–5.0.9 (25–26 November 2026) were made **outside** this
conversation and are not described here (they touched, among others,
`.github/`, `skills_catalog.py`, `literature.py`, `docs/EXDA-Design-Guide.md`,
the user-guide media, and added the AI-assistance note). Check `git log
browser-MVP-v4.0.14..HEAD` before relying on details below.

## Working rules agreed with the user

- The user releases with `./versioning.sh browser-MVP-vX.Y.Z`; the assistant
  runs only `--dry-run` and never commits without an explicit request.
- Never commit `.venv*` folders; never touch or ruin existing run metadata.
- The repo is public: no real project data in screenshots (synthetic demo
  under `/tmp/EXDA-Demo` was approved for guide media).
- Never touch the user's running EXDA (ports 5000/5173). Test copies run on
  5055/5175 with `EXDA_BACKEND_PORT=5055 EXDA_FRONTEND_PORT=5175
  EXDA_PROJECTS_ROOT=…` (the frontend port is needed for CORS).
- MVP goal: fast on-site "run OK / repeat" check; detailed analysis is done in
  MATLAB. Keep the app's style (theme tokens, minimal layout), check light and
  dark themes.

## What was changed (by release)

### 4.0.11–4.0.12 (earlier in the session)
- Peak-preserving preview (`backend/modules/signal_reduction.py`, min/max
  envelope) and screening peak table (`screening_peaks.py`, `/channel_peaks`,
  `PeakTable.jsx`): raw values, full resolution, required time range.
- Project Description tab (`modules/project_description.py`,
  `routes/project_description.py`, `pages/ProjectDescription.jsx`), project
  marker `exda-project.json`, `NON_PLAN_FILENAMES`, `PageHeader.jsx`.
- User guide rewritten tab by tab for MVP mode with new synthetic media;
  reproducible via `docs/EXDA-User-Guide/tools/make_demo_project.py` and
  `record_guide_media.mjs`; Word version via `build_userguide_docx.py`.
- Developer Overview updated (state, repo map, peak-table flow, project
  marker, findings F17–F19 from the "no default values" audit, test counts,
  guide-media regeneration).

### 4.0.13 — installation layout and transparency
- Recommended layout, user creates only `EXDA/`:
  `EXDA/EXDA` (shortcut), `EXDA/EXDA-dashboard/` (app, all packages inside),
  `EXDA/EXDA-Projects/` (data). Reason: replacing only the app folder for an
  update can never delete projects.
- `backend/routes/projects.py` `_projects_root_default()`: env var → existing
  `EXDA-Projects` beside the app → older `<app>/Projects` only if it already
  has content → otherwise **create** `EXDA-Projects` beside the app (fixes S9:
  projects could land inside the app folder). Lock against concurrent first
  start. `/list_directories` returns `insideAppFolder` and
  `recommendedProjectsRoot`; Projects page shows a warning when projects are
  inside the app folder. EXDA never moves project data itself.
- Setup scripts print where packages go (start and end), warn and ask when
  the app folder is in OneDrive/iCloud/Dropbox/Google Drive (Windows, macOS).
- Shortcuts: new `scripts/make_shortcuts.ps1` (Windows): Start menu always;
  parent `EXDA` folder when the app is "in its own folder" (parent not a
  general place and named `EXDA…` or holding only `EXDA…` items), else the
  app folder; Desktop only after a yes. macOS: relative symlink `EXDA` →
  `<app>/EXDA.app` in the parent; `EXDA.app` now uses `pwd -P`.
  `.gitattributes`: `*.ps1 text eol=crlf`.
- Docs: "Get EXDA" (`mkdir EXDA`, `cd EXDA`, `git clone …` on separate lines,
  because Windows PowerShell 5.1 rejects `&&`), "The EXDA shortcut", "Where
  EXDA installs things", remove/update steps — in README, RUN_EXDA.md, user
  guide, Developer Overview (incl. "what the scripts never do" and launcher
  rules). Word builder renders `bash`/`powershell` fences as code.
- Tests: `backend/tests/test_projects_root.py` extended.

### 4.0.14 — capabilities cloud and picker start folder
- Research and experimental capabilities word cloud on the Projects page:
  `frontend/src/components/CapabilityCloud.jsx` (SVG),
  `frontend/src/utils/capabilityCloud.js` (counting, deterministic spiral
  layout, font scale 14–46 px, flat-case 22 px, only smaller words vertical),
  `CAPABILITY_FIELD_IDS` + `capability_terms()` in
  `modules/project_description.py`, `capabilities` per project in
  `/list_projects`. Computed in the browser from the loaded projects; follows
  folder and status filters, not the search. Partners/funding excluded (not a
  capability). Read-only.
- Filter visibility (user found the selected word was easy to forget):
  "Showing N of M projects matching …" bar with **Show all**, × in the search
  box, **Filter: … ×** chip in the card, other words stay faded.
- Colours: theme tokens `--cloud-methods/-measured/-facility/-fuels` in
  `frontend/src/index.css` (+ `cloud` colours in `tailwind.config.js`);
  blue, green, red (facility, as in the DBI logo; user rejected pink), amber;
  keywords muted grey. Validated with the dataviz validator (`--pairs all`):
  CVD ≥ 9.3, normal ≥ 15.7, text contrast ≥ 4.6:1 in both themes. Known
  deviation: OKLCH lightness band "fails" (deep red in light, bright colours
  in dark) — accepted, because text contrast matters more than the mark band.
- Picker start folder: `frontend/src/utils/pickerStart.js`. Open/Create
  Project start in a projects folder (the saved projects folder that holds the
  last project, else the default `EXDA-Projects`), never at the last project
  path. Cause found: `lastProjectPath` pointed into an old EXDA copy under
  `…/PostProcessing/apps`, which no longer existed, so the picker fell back to
  that folder.
- Guide sections 3–4 updated; Projects-page media re-recorded (recorder now
  clicks a cloud word; `getByText(…, { exact: true })` because SVG titles
  contain project names).
- Tests: `frontend/tests/capability-cloud.test.js`, `picker-start.test.js`,
  `backend/tests/test_project_description.py`. At 4.0.14: 164 backend tests
  (5 skipped), 76 frontend, lint clean.

### Data outside the repo (not in git)
- Made-up Project Descriptions written to the four demo projects in
  `/media/psf/Sim_Back_Up/EXDA-Projects-Demo` via EXDA's save route (History
  kept), each with the note "Demo project: this description is made-up
  example data."
- Upload cleanup: 58 items (stale `.exda.lock`, `_writetest`, `.__writetest`,
  demo `.trash`, macOS `._*` and `.DS_Store`) **moved**, not deleted, to
  `/media/psf/Sim_Back_Up/EXDA-upload-cleanup-2026-11-25/` (list in
  `moved-files.txt`). `aiChat` folders were not touched.

## Decisions and reasons

- No install-location question in setup: the EXDA folder position decides it;
  fewer steps, fewer mistakes.
- Demo projects are **not** generated by the app (a first-start generator was
  built and reverted): the user ships their own demo folder in the download.
- Capabilities cloud computed client-side instead of a separate endpoint, so
  it changes with whatever is loaded and filtered.
- Size encodes number of projects only (no fake variation); a flat cloud says
  so in a hint line.
- Email to colleagues targets the released layout (after commit), with zips
  built to exclude macOS metadata.

## Known bugs / open issues

1. **F17 – Gas mixing prefill** (`frontend/src/pages/GasMixing.jsx:165–171`,
   `359–365`): new/old records default L=W=H=0.9 m and volume corrections 0.
   Planned: copy from the project's previous gas record (labelled), else
   leave empty so "required" stops the calculation. Still open at 5.0.9.
2. **F9 / audit #3 – MFC standard conditions** default 25 °C / 101325 Pa
   (`backend/modules/gas_mixing.py:20–21`); must be checked against the MFC
   datasheet and made a visible project setting. Still open.
3. **F18 – TPC5 preview defaults** (`backend/modules/tpc5_parser.py:65–73`):
   1 Hz and factor 1 when attributes are missing; `daq_reader.py:105–106`
   still defaults scaling factors/offsets. Still open.
4. **F19 – "assumed" unit not shown**: `/preview_multichannel` returns
   `unitSource`, no UI uses it. Still open.
5. **Untested on real hardware:** `scripts/make_shortcuts.ps1` (run once in
   the Parallels Windows VM); the macOS ZIP route (does Gatekeeper need "Open
   Anyway"?).
6. Calculation findings F1–F16 and structure findings S1–S8 in the Developer
   Overview remain open (no CI yet, S7).
7. User's `~/.bashrc` still adds the old `…/PostProcessing/apps` folder to
   PATH (harmless forwarder; user may remove it).

## Pending with the user (when this conversation ended)

- Zipping for WeTransfer: confirm whether `EMP2X-Experiments.zip` should
  include `VH2D-Project-Wk-22-2026` (1.5 GB, includes RAMS drafts and SOPs)
  or only Week 27 (~21 GB); `aiChat` include or exclude is the user's choice.
  Command pattern: `zip -r -X <name>.zip <folder> -x '*/._*' '*.DS_Store'
  '*/.exda.lock' '__MACOSX/*'`. Free WeTransfer stops at 3 GB.
- Update the colleague email accordingly (Week 22 line if included; data
  size). AI-assistance disclosure is already in README, guide and Home page
  (added after this conversation) — the email line can reuse that wording.
- Last question asked: show the AI note on the Home page? Already done at
  `frontend/src/pages/Home.jsx:842` (small text) — keep it short there.

## Planned improvements, in priority order

1. F17 gas-mixing prefill (MVP correctness, user asked to go "one by one").
2. MFC standard conditions as a visible project/DAQ setting (needs datasheet).
3. F18 TPC5 missing-attribute errors; F19 "assumed" unit badge in screening
   and the peak table.
4. OK/Repeat verdict per run: new fields (e.g. `meta.verdict` + reason) on top
   of `hasError`/`isCanceled`, never altering existing metadata; placement
   (screening tab, run card, Plan badge) still to be decided with the user.
5. CI (S7): backend unittest + vitest + eslint on every push.
6. Remaining Developer Overview findings (F1, F5 first; then F3, F2/F4, F8).
