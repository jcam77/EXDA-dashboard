# Run EXDA

EXDA is now documented as a browser-first app.

For day-to-day use, the recommended workflow is:

- clone or download the repository
- run the setup file for your operating system once
- run the launcher for your operating system
- let the launcher check requirements, start the backend, and open the browser

## Setup Once

- <img src="docs/assets/os-icons/linux.png" alt="Linux" width="16" height="16"> Linux: [Setup-EXDA-LINUX.sh](/Volumes/Sim_Back_Up/EXDA-dashboard/Setup-EXDA-LINUX.sh)
- <img src="docs/assets/os-icons/apple.png" alt="macOS" width="16" height="16"> macOS: [Setup-EXDA-MAC.command](/Volumes/Sim_Back_Up/EXDA-dashboard/Setup-EXDA-MAC.command)
- <img src="docs/assets/os-icons/windows.png" alt="Windows" width="16" height="16"> Windows: [Setup-EXDA-WIN.bat](/Volumes/Sim_Back_Up/EXDA-dashboard/Setup-EXDA-WIN.bat)

The setup scripts:

- create or repair `.venv`
- run `npm install`
- install `backend/requirements.txt`
- install `backend/requirements-optional.txt`
- verify the resulting environment

## Launchers

- <img src="docs/assets/os-icons/linux.png" alt="Linux" width="16" height="16"> Linux: [Run-EXDA-LINUX.sh](/Volumes/Sim_Back_Up/EXDA-dashboard/Run-EXDA-LINUX.sh)
- <img src="docs/assets/os-icons/apple.png" alt="macOS" width="16" height="16"> macOS: [Run-EXDA-MAC.command](/Volumes/Sim_Back_Up/EXDA-dashboard/Run-EXDA-MAC.command)
- <img src="docs/assets/os-icons/windows.png" alt="Windows" width="16" height="16"> Windows: [Run-EXDA-WIN.bat](/Volumes/Sim_Back_Up/EXDA-dashboard/Run-EXDA-WIN.bat)

Terminal shortcuts from the repo root:

- Linux/macOS: `./run exda`
- Windows Command Prompt: `run exda`
- Windows PowerShell: `.\run.cmd exda`

## What the launchers do

- check for required tools: `node`, `npm`, and `python`
- check that core npm packages are installed
- check that packages from [backend/requirements.txt](/Volumes/Sim_Back_Up/EXDA-dashboard/backend/requirements.txt) are available
- print a clear list of missing tools or packages
- start the Flask backend on `http://127.0.0.1:5000`
- start the Vite frontend and open the browser

## First-time setup

If the launcher reports missing dependencies, run the appropriate setup steps once.

### Linux and macOS

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Optional extras:

```bash
pip install -r backend/requirements-optional.txt
```

### Windows

```powershell
npm install
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

Optional extras:

```powershell
pip install -r backend\requirements-optional.txt
```

## Notes

- AiRA can remain limited if optional local AI tooling such as Ollama is not installed.
- For normal user installs, AiRA defaults to local Ollama at `http://localhost:11434`.
- AiRA auto-detects Ollama host when no override is set, probing common local and VM routes before localhost fallback.
- If Ollama runs on another host and auto-detection is not correct in your environment, set `OLLAMA_HOST` to a full URL such as `http://my-host:11434`.
- Optional hostname override file `.ollama_hostname` is advanced-only; see `.ollama_hostname.example`.
- The launchers are intended for users running the app from a repository checkout.
- Packaged desktop builds are still possible, but they are now treated as a secondary release workflow. See [PACKAGING.md](/Volumes/Sim_Back_Up/EXDA-dashboard/PACKAGING.md).
