# Run EXDA

EXDA is now documented as a browser-first app.

## Start EXDA

Double-click the launcher for your operating system:

- <img src="docs/assets/os-icons/apple.png" alt="macOS" width="16" height="16"> macOS: [EXDA.app](EXDA.app) (opens Terminal and runs [Run-EXDA-MAC.command](Run-EXDA-MAC.command))
- <img src="docs/assets/os-icons/windows.png" alt="Windows" width="16" height="16"> Windows: [Run-EXDA-WIN.bat](Run-EXDA-WIN.bat), or the **EXDA** shortcut on the Desktop / Start menu that the first start creates
- <img src="docs/assets/os-icons/linux.png" alt="Linux" width="16" height="16"> Linux: run [Setup-EXDA-LINUX.sh](Setup-EXDA-LINUX.sh) once, then [Run-EXDA-LINUX.sh](Run-EXDA-LINUX.sh)

Install once per computer: Node.js 22 LTS (20.19+ or 22.12+), Python 3.10+ (3.12 recommended) and Git. On macOS and Windows the setup offers to install Node.js and Python if they are missing (macOS: Homebrew, Windows: `winget`). Otherwise it opens the download page.

## First start and later starts (macOS and Windows)

Every start runs a quick check:

- the Python environment for this operating system exists and works (`.venv-mac` on macOS, `.venv-win` on Windows)
- the packages in [backend/requirements.txt](backend/requirements.txt) are installed
- Node.js is new enough ([scripts/check_node_version.cjs](scripts/check_node_version.cjs))
- the frontend packages are installed for this operating system

If everything is in place, which is the normal case, EXDA starts within a few seconds. If something is missing, including on the very first start, the launcher prints what is missing and runs the setup script ([Setup-EXDA-MAC.command](Setup-EXDA-MAC.command) / [Setup-EXDA-WIN.bat](Setup-EXDA-WIN.bat)) with `--from-launcher`, then starts EXDA. The setup scripts can also be run on their own at any time. They are safe to repeat.

Setup:

- checks Node.js and Python, and offers to install them
- creates the Python environment, or moves a broken one aside to `.venv-*.broken-<id>`
- runs `npm install`, and reinstalls `node_modules` if the packages for this operating system are incomplete
- installs `backend/requirements.txt` and `backend/requirements-optional.txt`
- on Windows, creates the **EXDA** shortcut (icon: [scripts/EXDA.ico](scripts/EXDA.ico)) on the Desktop and in the Start menu

Each operating system keeps its own Python environment, so one EXDA folder (for example on an external drive) can be used from macOS and Windows. `node_modules` is shared: npm keeps the native packages for each system side by side. An older shared `.venv` folder is no longer used on macOS or Windows and can be deleted.

## MVP Mode (Optional)

For a simplified onsite workflow, you can enable MVP mode (Minimum Viable Product).

- Toggle with the `MVP` button in the app header (upper-right area).
- The selection is stored locally in your browser and reused on next app start.
- Set a default before launch with:
  - `MVP_MODE=true`
  - or `VITE_MVP_MODE=true`
- Optional: require a developer password to disable MVP mode:
  - Default unlock password is `exda`
  - `EXDA_MVP_UNLOCK_PASSWORD=your-password`
  - or `VITE_MVP_UNLOCK_PASSWORD=your-password`

In MVP mode, advanced tabs are hidden and the workspace uses a simpler `Raw Data Pressure Analysis` tab for quicker operation.

Terminal shortcuts from the repo root:

- Linux/macOS: `./run exda`
- Windows Command Prompt: `run exda`
- Windows PowerShell: `.\run.cmd exda`

## Manual setup (without the setup scripts)

### Linux and macOS

```bash
npm install
python3 -m venv .venv            # on macOS the launcher uses .venv-mac
source .venv/bin/activate
pip install -r backend/requirements.txt
pip install -r backend/requirements-optional.txt   # optional extras
```

### Windows

```powershell
npm install
py -3 -m venv .venv-win
.\.venv-win\Scripts\Activate.ps1
pip install -r backend\requirements.txt
pip install -r backend\requirements-optional.txt   # optional extras
```

## Notes

- AiRA can remain limited if optional local AI tooling such as Ollama is not installed.
- For normal user installs, AiRA defaults to local Ollama at `http://localhost:11434`.
- AiRA auto-detects Ollama host when no override is set, probing common local and VM routes before localhost fallback.
- If Ollama runs on another host and auto-detection is not correct in your environment, set `OLLAMA_HOST` to a full URL such as `http://my-host:11434`.
- Optional hostname override file `.ollama_hostname` is advanced-only; see `.ollama_hostname.example`.
- The launchers are intended for users running the app from a repository checkout.
- Packaged desktop builds are still possible, but they are now treated as a secondary release workflow. See [PACKAGING.md](PACKAGING.md).
