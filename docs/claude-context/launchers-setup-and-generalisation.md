# Handoff: launchers, cross-platform setup and generalisation (Nov 2026)

Session span: releases 4.0.6 → 4.0.9 (2026-11-23/24), branch `CLAUDE-Updates`.
State checked against the repository on 2026-11-27 (HEAD = `browser-MVP-v5.0.9`, clean tree).
Later releases (5.0.x) were made in other sessions. Items finished there are marked *(done later)*.

## 1. What changed (files and why)

### Launchers and setup (macOS / Windows)
| File | Change | Why |
|---|---|---|
| `EXDA.app/` (Info.plist, `MacOS/EXDA`, `Resources/EXDA.icns`) | Clickable macOS launcher. Opens `Run-EXDA-MAC.command` with `open -a Terminal`. | Gives Mac users an icon to double-click. AppleScript `do script` failed because it needs automation permission. |
| `docs/design/app-icon/make_app_icon.py` | Draws the "EX / DA" monogram (Inter ExtraBold, teal→blue). Writes the PNG, `EXDA.icns` and `scripts/EXDA.ico` (7 sizes). | One source for all app icons. |
| `Run-EXDA-MAC.command`, `Setup-EXDA-MAC.command` | Rewritten. Every start runs a quick check (venv works, `backend/requirements.txt` imports, Node version, frontend packages). If the check fails, the launcher runs setup with `--from-launcher` and then starts EXDA. Setup offers Homebrew installs or opens the download pages. Apple's `/usr/bin/python3` (3.9) is used only if the developer tools are installed. | The user asked for "first double-click installs, later double-clicks just check and open". |
| `Run-EXDA-WIN.bat`, `Setup-EXDA-WIN.bat` | Same flow for Windows. Setup offers `winget` installs (Node LTS; Python 3.12 with `--scope user`). It creates an `EXDA.lnk` shortcut with `scripts/EXDA.ico` on the Desktop, in the Start menu and in the EXDA folder. The launcher sets `PYTHONIOENCODING=utf-8`. The files must keep CRLF line endings (`.gitattributes` handles checkouts). | A `.bat` file cannot have its own icon. A shortcut stores an absolute path, so setup creates it on each PC. |
| `scripts/check_node_version.cjs` | New. Exits 0 for Node ^20.19 or >=22.12 (the Vite 7 `engines` range). | Shared version check for all launchers. |
| `scripts/run-python.mjs`, `electron/main.cjs`, `package.json` (`server`, `server:smoke`, `test:backend`) | Look for the per-OS venv first, then `.venv`, then system Python. The npm scripts now go through `run-python.mjs`. | Per-OS venvs (see decisions). |
| `run` | Removed the `.venv` PATH warning. | The launchers now handle the environment. |
| `backend/app.py` | Sets stdout and stderr to UTF-8 (`errors="replace"`) at startup. | Windows crashed on the 🚀 startup print: output redirected to the log file uses cp1252. |
| `backend/routes/ai.py` | Added `.venv-mac` and `.venv-win` to `REPO_SCAN_IGNORE_DIRS`. | Keeps venvs out of the AiRA repo scan. |
| `.gitignore` | Added `.venv-*/`, `.venv.*/`, `EXDA.lnk` and `Claude outputs/`. | Venvs, broken-venv copies and the PC-specific shortcut are never committed. |
| `versioning.sh` | Added `EXDA.app` to `ALLOWED_DIRS`. | Lets the release script stage the Mac launcher. |
| Git index | Set the launch scripts and `EXDA.app/Contents/MacOS/EXDA` to 100755. | The repo is on exFAT with `core.fileMode=false`, so git recorded them as 100644 and they would not run after a clone. |
| `README.md`, `RUN_EXDA.md` | New prerequisites (Node 22 LTS, Python 3.10+, Git), a description of the first-start and later-start flow, per-OS venv notes and manual setup. | The docs said "Node 18+" and described manual steps only. |

### Generalisation (wording)
- `frontend/src/pages/Home.jsx`:
  - The footer tagline is now "EXperimental DAta".
  - The footer description, the Core Capabilities subtitle and the privacy-policy line use generic test-campaign wording.
  - The footer line reads "Developed for hydrogen explosion research; usable for any experimental campaign."
- Usage disclaimer, in `Home.jsx` and `frontend/src/pages/RawDataScreeningCorePage.jsx`: "during explosion tests" became "during tests".
- Earlier in the session (release 4.0.6): the Home hero reads "EXperimental DAta / Research Platform", with EX and DA in teal. The README describes EXDA as "EXperimental DAta".

### Folder picker (started here, finished in another session)
- Added `backend/modules/folder_dialog.py`, with native OS folder dialogs and a tkinter fallback.
- `project_manager.select_folder_dialog()` now calls it.
- A second session edited the same files at the same time. I stopped and asked the user which session should continue. The final picker (quick places, nearest-existing-folder fallback, tests in `backend/tests/test_folder_picker.py`) came from that other session *(done later)*.

## 2. Decisions and reasons
- **Per-OS Python environments:**
  - `.venv-mac` on macOS, `.venv-win` on Windows; Linux keeps `.venv`.
  - Reason: the EXDA folder sits on a drive used by macOS, Windows (as `E:`) and a Linux VM. The single `.venv` had become a mix of a Mac 3.11 venv and a Windows 3.13 venv (`Lib` and `lib` collide on the case-insensitive drive).
- **`node_modules` stays shared:** npm keeps each OS's native packages (rollup, esbuild) side by side. Setup reinstalls `node_modules` only if `require('rollup')` still fails after `npm install`.
- **Launcher always runs a quick check:** this costs about 2 s on macOS, mostly the backend wait. Setup is idempotent and can be run on its own.
- **Prerequisite install is opt-in (y/N):** it uses winget or Homebrew. Otherwise setup opens the download page and stops with a clear message.
- **Minimum versions:** Python 3.10, because of `X | None` annotations, scipy and asammdf. Node 20.19 / 22.12, the Vite 7 `engines` range.
- **Generalisation approach:** keep the name EXDA, reinterpret it as "EXperimental DAta", and mention the hydrogen-explosion origin once ("developed for … usable for any experimental campaign").
- **Releases:** the user runs `./versioning.sh <tag>` because it prompts y/N. Claude only runs `--dry-run`. Commits only on explicit request (see memory "Ask before committing").

## 3. Known bugs / open issues
1. **No native "Browse…" button in the folder picker.** The current picker (`ProjectPickerModal.jsx`) has quick places and fallback but no `/choose_folder` endpoint. `folder_dialog.py` duplicates helpers that exist in `routes/projects.py` (`quick_places`, `parent_folder`, `clean_path` are unused); only `choose_folder()` is used, via `select_folder_dialog()`. Consolidate into one module.
2. **Windows install paths not tested:**
   - Tested and working: first-start setup, launch, and the shortcut icon on the user's Parallels Windows VM (4.0.9).
   - Not tested: the winget install path, and a clean install on the colleague's PC.
   - The Homebrew install path on macOS is also untested.
3. **Linux launchers unchanged:** they still use `.venv` and have no automatic first-run setup.
4. **Leftover explosion icon:**
   - `frontend/public/explosion-rays.svg` is unused now. The tab favicon was replaced by `favicon.ico` and `exda-icon-192.png` *(done later)*.
   - `frontend/dist/index.html` (a build output) still references the old SVG and needs a rebuild.
5. **Old mixed `.venv` folder:** it may still exist on the shared drive. It is unused on macOS and Windows and can be deleted.
6. **`import fitz` deprecation warning** from PyMuPDF 1.28 (7 call sites in `routes/state.py` and `routes/ai.py`). It is harmless but noisy. Switch to `import pymupdf` with a fallback for older installs.
7. **Old checklist text:** projects using the built-in checklist (BUILTIN_V1) still show `[Proc.Ref. xxx]` texts.
8. **Plan in public git history:** an old `docs/Reports_Template.docx` containing PhD plan text is in the public history. A history rewrite was offered but not done.
9. **Unresolved user request:** "fix what /usage flagged", and turn off skills unused for a month. Not done; it needs the `/usage` output and the user's choice.

## 4. Planned improvements (priority order)
1. Confirm a clean Windows install on the colleague's PC (clone or ZIP → `Run-EXDA-WIN.bat` → shortcut).
2. Add a native "Browse…" button to the folder picker and merge `folder_dialog.py` with the helpers in `routes/projects.py`.
3. Delete `explosion-rays.svg` and rebuild `dist`; delete the old shared `.venv`.
4. Generalisation roadmap:
   - Gas Mixing tab: currently H2-specific;
   - pressure-analysis and EWT labels: currently assume explosions;
   - AiRA hydrogen defaults;
   - a neutral new-project checklist template;
   - run naming: currently VH2D-based.
5. Bring the Linux launchers in line with macOS and Windows (automatic setup, version checks).
6. Replace `import fitz` with `import pymupdf`.
7. Re-record the user-guide screenshots and videos for the redesigned Checklist tab.
8. Optional: serve the backend with Waitress to remove the Flask development-server warning (see memory "December follow-ups").
