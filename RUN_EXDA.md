# Run EXDA

EXDA is now documented as a browser-first app.

## Get EXDA

Make one folder called `EXDA` and put the app (this repository) inside it:

```bash
mkdir EXDA
cd EXDA
git clone https://github.com/jcam77/EXDA-dashboard.git
```

Without git, download the ZIP from GitHub (**Code → Download ZIP**) and unzip it inside the `EXDA` folder. The unzipped folder may be called `EXDA-dashboard-main`; EXDA does not depend on the app folder's name.

Put the `EXDA` folder somewhere local with a short path, for example `C:\EXDA` or `~/EXDA`. After the first start it holds:

```text
EXDA/
├── EXDA                ← shortcut to start EXDA (EXDA.lnk on Windows, a link to EXDA.app on macOS)
├── EXDA-dashboard/     ← the app: everything EXDA installs is inside this folder
└── EXDA-Projects/      ← your projects: created by EXDA on its first start
```

The `EXDA` folder is created by you; the shortcut and `EXDA-Projects` are created by EXDA. You can skip the `EXDA` folder: EXDA still works, with `EXDA-Projects` created next to the app wherever it is, and setup prints a tip.

## Start EXDA

Double-click the launcher for your operating system:

- <img src="docs/assets/os-icons/apple.png" alt="macOS" width="16" height="16"> macOS: [EXDA.app](EXDA.app) (opens Terminal and runs [Run-EXDA-MAC.command](Run-EXDA-MAC.command)), or the **EXDA** shortcut in the `EXDA` folder that the first start creates
- <img src="docs/assets/os-icons/windows.png" alt="Windows" width="16" height="16"> Windows: [Run-EXDA-WIN.bat](Run-EXDA-WIN.bat), or the **EXDA** shortcut that the first start creates (in the `EXDA` folder, in the Start menu, and on the Desktop if you chose it)
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
- creates the **EXDA** shortcut (see below)

### The EXDA shortcut

| Place | Windows ([scripts/make_shortcuts.ps1](scripts/make_shortcuts.ps1)) | macOS ([Setup-EXDA-MAC.command](Setup-EXDA-MAC.command)) |
| --- | --- | --- |
| `EXDA` folder, next to the app and `EXDA-Projects` | `EXDA.lnk`, when the app sits in its own folder | `EXDA`, a link to `EXDA.app`, when the app sits in its own folder |
| Inside the app folder | `EXDA.lnk`, only when the app does **not** sit in its own folder | `EXDA.app` is always there |
| Start menu | Always (your user's Start menu) | – |
| Desktop | **Only if you answer yes.** An EXDA shortcut already there is just updated | Never (drag the EXDA shortcut to the Dock yourself if you like) |

"In its own folder" means the folder around the app is not a general place (the drive root, your user folder, Desktop, Documents or Downloads) and is either named `EXDA…` or holds nothing but EXDA items. Setup prints every shortcut it writes. Linux gets no shortcut. Shortcuts are never stored in git: a Windows shortcut holds the computer's full path.

## Where EXDA installs things

You choose the location by where you put the `EXDA` folder. Setup asks nothing else about locations, and it prints the paths when it starts and when it finishes.

| What | Where | Removed by deleting the app folder? |
| --- | --- | --- |
| Python packages | `.venv-win` (Windows), `.venv-mac` (macOS), `.venv` (Linux), inside the app folder | Yes |
| Frontend packages | `node_modules`, inside the app folder | Yes |
| EXDA shortcuts | See the table above | Only the one inside the app folder; delete the others by hand (or let the next version rewrite them) |
| Node.js and Python | System-wide, **only if missing and only after you accept** (Windows: `winget`, Python for your user only; macOS: Homebrew). On Linux, install them yourself | No: they are normal programs, uninstall them as usual |
| Download caches | npm and pip keep their usual caches in your user folder, as for any project | No, but they are safe to ignore or clear |
| Your projects | `EXDA-Projects` next to the app folder (created on the first start), or wherever you create them | No: they are never inside the app folder |

Together the packages take about 1–2 GB. The setup scripts never use administrator rights themselves, never change system settings, the registry or your shell profile, and never install npm or pip packages globally. Only the Node.js installer on Windows asks Windows for permission, because it installs for all users.

**Where to put the `EXDA` folder:** a local folder with a short path, for example `C:\EXDA` or `~/EXDA`. Do not use OneDrive, iCloud Drive, Dropbox or Google Drive. The sync service would upload thousands of package files and can break the Python environment, so setup warns and asks first if it finds the app there. Projects can live in a synced folder: open them from there.

## Remove EXDA or update to a newer version

Only the app folder (`EXDA-dashboard`) is replaced or removed. Your projects in `EXDA-Projects` stay where they are.

1. Close EXDA (close its terminal window). Windows cannot delete files that are in use.
2. Delete the app folder `EXDA-dashboard`. **Do not delete the `EXDA` folder around it** unless you also want to delete your projects.
3. **New version:** put the new app folder in the same `EXDA` folder and double-click its launcher. The first start installs the packages again (a few minutes, internet needed) and rewrites the EXDA shortcuts so they point to the new app.
4. **Remove EXDA completely:** also delete the EXDA shortcut in the `EXDA` folder and, on Windows, `EXDA.lnk` in the Start menu and (if you added it) on the Desktop. Keep or move `EXDA-Projects` as you wish: it is your data.

**Projects inside the app folder (older installations).** Before EXDA created `EXDA-Projects` automatically, it could keep projects in `Projects` inside the app folder ([projects.py](backend/routes/projects.py)). EXDA keeps using that folder if it holds anything, and the Projects page then shows a warning, because replacing the app folder would delete those projects. Close EXDA, move them to `EXDA-Projects` next to the app folder, and start EXDA again.

**With git:** `git pull` in the app folder updates the app in place. The Python environment and `node_modules` stay, and the next start installs only packages that changed.

Node.js and Python stay installed; the next version needs them too. Remove them like any other program only if nothing else uses them.

**If you move the whole `EXDA` folder later:**

- **macOS:** the EXDA link still works (it is relative). The next start notices that the Python environment belongs to the old place and installs it again (a few minutes).
- **Windows:** EXDA usually keeps working, but the shortcuts still point to the old place. Run `Setup-EXDA-WIN.bat` once in the new place to rewrite them.
- **Linux:** run `Setup-EXDA-LINUX.sh` again.

Each operating system keeps its own Python environment, so one EXDA folder (for example on an external drive) can be used from macOS and Windows. `node_modules` is shared: npm keeps the native packages for each system side by side. An older shared `.venv` folder is no longer used on macOS or Windows and can be deleted.

## Ports

EXDA uses two local ports, set in [config/exda-defaults.env](config/exda-defaults.env): **5173** for the page in the browser and **5077** for the backend (5000 until version 5.0.6; macOS uses port 5000 for AirPlay Receiver). On every start the launchers check that it is really EXDA that answers on the backend port ([scripts/check_exda_backend.py](scripts/check_exda_backend.py), via `/exda_health`). If another program answers there, the launcher says so and stops, instead of the page showing *"Backend not running?"*. To use other ports, change the two `PORT` lines in `config/exda-defaults.env`.

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
