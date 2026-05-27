@echo off
title EXDA Dashboard Manager

:: 1. Setup Paths
set "REPO_ROOT=%~dp0"
if "%REPO_ROOT:~-1%"=="\" set "REPO_ROOT=%REPO_ROOT:~0,-1%"
cd /d "%REPO_ROOT%"

set "PATH=%REPO_ROOT%\.venv\Scripts;%ProgramFiles%\nodejs;%PATH%"

:: 2. Silent Repair (No strict gatekeeping)
echo [*] Verifying Python packages...
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt --quiet

:: 3. Launch Backend (In the BACKGROUND of this same terminal)
echo [*] Starting Backend Service...
set EXDA_BACKEND_PORT=5001
set EXDA_BACKEND_DEBUG=1
:: The /B flag mimics the Mac/Linux '&' symbol. No new window will open!
start /B "" ".venv\Scripts\python.exe" backend\app.py

:: 4. Launch Frontend (In the FOREGROUND)
echo [*] Starting Frontend UI...
echo ===================================================
echo EXDA IS RUNNING
echo Close this terminal window to stop BOTH the front and backend.
echo ===================================================
call npm run vite -- --host localhost --port 5173