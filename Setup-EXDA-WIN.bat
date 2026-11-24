@echo off
setlocal EnableExtensions EnableDelayedExpansion
title EXDA Setup

rem EXDA setup for Windows.
rem  - Checks Node.js (20.19+ or 22.12+) and Python (3.10+); offers to install them with winget.
rem  - Creates the Windows Python environment .venv-win and installs the Python packages.
rem  - Installs the frontend packages (npm install).
rem  - Adds an "EXDA" shortcut with the EXDA icon to the Desktop, the Start menu and this folder.
rem Run-EXDA-WIN.bat calls this automatically (with --from-launcher) when something is missing.

set "REPO_ROOT=%~dp0"
cd /d "%REPO_ROOT%"

set "FROM_LAUNCHER=0"
if /I "%~1"=="--from-launcher" set "FROM_LAUNCHER=1"

set "VENV_DIR=%REPO_ROOT%.venv-win"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "PY_OK=import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
set "NODE_PKGS_OK=require('rollup'); require.resolve('vite/package.json'); require.resolve('react/package.json'); require.resolve('react-dom/package.json')"
set "PYTHON_EXE="
set "PYTHON_ARGS="
set "FAIL_MSG="

echo ========================================
echo EXDA Setup (Windows)
echo ========================================
call :seed_path

rem ---- Node.js -------------------------------------------------------------
echo.
echo Checking Node.js ...
call :find_node
if errorlevel 1 (
  if "!NODE_STATE!"=="old" (
    echo Node.js !NODE_VERSION! is too old for EXDA. EXDA needs Node.js 22.12 or newer.
  ) else (
    echo Node.js is not installed on this computer.
  )
  call :offer_install OpenJS.NodeJS.LTS "Node.js LTS" "https://nodejs.org/en/download" ""
  call :find_node
  if errorlevel 1 (
    set "FAIL_MSG=Node.js 22.12 or newer is required. If you just installed it, close this window and double-click EXDA again."
    goto :fail
  )
)
for /f "delims=" %%V in ('node -v') do echo Node.js %%V found.

rem ---- Python --------------------------------------------------------------
echo.
echo Checking Python ...
call :find_python
if errorlevel 1 (
  echo Python 3.10 or newer is not installed on this computer.
  call :offer_install Python.Python.3.12 "Python 3.12" "https://www.python.org/downloads/windows/" "--scope user"
  call :find_python
  if errorlevel 1 (
    set "FAIL_MSG=Python 3.10 or newer is required. If you just installed it, close this window and double-click EXDA again."
    goto :fail
  )
)
for /f "delims=" %%V in ('%PYTHON_EXE% %PYTHON_ARGS% --version') do echo %%V found.

rem ---- Python environment (.venv-win) ---------------------------------------
if exist "%VENV_DIR%\" (
  "%VENV_PY%" -c "!PY_OK!" >nul 2>nul
  if errorlevel 1 (
    set "OLD_VENV=.venv-win.broken-!RANDOM!"
    echo.
    echo The existing .venv-win does not work on this computer. Moving it aside to !OLD_VENV! ...
    ren "%VENV_DIR%" "!OLD_VENV!"
    if errorlevel 1 (
      set "FAIL_MSG=Could not move the old .venv-win aside. Close other EXDA windows and try again."
      goto :fail
    )
  )
)
if not exist "%VENV_PY%" (
  echo.
  echo Creating the Python environment .venv-win ...
  "!PYTHON_EXE!" !PYTHON_ARGS! -m venv "%VENV_DIR%"
  if errorlevel 1 (
    set "FAIL_MSG=Could not create .venv-win"
    goto :fail
  )
)

rem ---- Frontend packages ---------------------------------------------------
echo.
echo Installing frontend packages with npm. The first time this takes a few minutes ...
call npm install
if errorlevel 1 (
  set "FAIL_MSG=npm install failed. Check the internet connection and try again."
  goto :fail
)
node -e "%NODE_PKGS_OK%" >nul 2>nul
if errorlevel 1 (
  echo Frontend packages are incomplete for Windows. Reinstalling them from scratch ...
  rmdir /s /q "%REPO_ROOT%node_modules"
  call npm install
  node -e "%NODE_PKGS_OK%" >nul 2>nul
  if errorlevel 1 (
    set "FAIL_MSG=Frontend packages are still incomplete after npm install"
    goto :fail
  )
)

rem ---- Python packages -----------------------------------------------------
echo.
echo Installing Python packages into .venv-win ...
"%VENV_PY%" -m pip install --upgrade pip >nul 2>nul
"%VENV_PY%" -m pip install -r backend\requirements.txt
if errorlevel 1 (
  set "FAIL_MSG=Failed to install backend\requirements.txt"
  goto :fail
)
"%VENV_PY%" scripts\check_runtime_requirements.py --requirements backend\requirements.txt >nul 2>nul
if errorlevel 1 (
  set "FAIL_MSG=Backend Python packages are still incomplete"
  goto :fail
)
echo Installing optional feature packages ...
"%VENV_PY%" -m pip install -r backend\requirements-optional.txt
if errorlevel 1 (
  set "FAIL_MSG=Failed to install backend\requirements-optional.txt"
  goto :fail
)

rem ---- Shortcut --------------------------------------------------------------
call :make_shortcuts

echo.
echo EXDA setup is complete.
if "%FROM_LAUNCHER%"=="1" (
  echo Starting EXDA ...
  endlocal
  exit /b 0
)
echo.
echo Start EXDA with the EXDA shortcut on your Desktop or in the Start menu,
echo or double-click Run-EXDA-WIN.bat in this folder.
echo.
pause
endlocal
exit /b 0


rem ==========================================================================
:fail
echo.
echo Setup failed: %FAIL_MSG%
echo.
pause
endlocal
exit /b 1


rem Add the usual install folders of Node.js and Python to PATH, so tools that
rem were installed a moment ago are found without opening a new window.
:seed_path
if exist "%ProgramFiles%\nodejs" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LocalAppData%\Programs\nodejs" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"
if exist "%AppData%\npm" set "PATH=%AppData%\npm;%PATH%"
if exist "%USERPROFILE%\scoop\shims" set "PATH=%USERPROFILE%\scoop\shims;%PATH%"
if defined ChocolateyInstall if exist "%ChocolateyInstall%\bin" set "PATH=%ChocolateyInstall%\bin;%PATH%"
if exist "%LocalAppData%\Programs\Python\Launcher" set "PATH=%LocalAppData%\Programs\Python\Launcher;%PATH%"
for /d %%D in ("%LocalAppData%\Programs\Python\Python3*") do set "PATH=%%~D;%%~D\Scripts;!PATH!"
for /d %%D in ("%ProgramFiles%\Python3*") do set "PATH=%%~D;%%~D\Scripts;!PATH!"
exit /b 0


rem Sets NODE_STATE to ok, old or missing. Returns 0 only when Node.js is new enough.
:find_node
set "NODE_STATE=missing"
set "NODE_VERSION="
where node >nul 2>nul
if errorlevel 1 exit /b 1
where npm >nul 2>nul
if errorlevel 1 exit /b 1
for /f "delims=" %%V in ('node "%REPO_ROOT%scripts\check_node_version.cjs" 2^>nul') do set "NODE_VERSION=%%V"
node "%REPO_ROOT%scripts\check_node_version.cjs" >nul 2>nul
if errorlevel 1 (
  set "NODE_STATE=old"
  exit /b 1
)
set "NODE_STATE=ok"
exit /b 0


rem Sets PYTHON_EXE / PYTHON_ARGS to a Python 3.10+ that really runs (the Microsoft
rem Store placeholder "python.exe" does not). Returns 1 when none is found.
:find_python
set "PYTHON_EXE="
set "PYTHON_ARGS="
py -3 -c "!PY_OK!" >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_EXE=py"
  set "PYTHON_ARGS=-3"
  exit /b 0
)
python -c "!PY_OK!" >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_EXE=python"
  exit /b 0
)
exit /b 1


rem :offer_install <winget id> "<name>" "<download page>" "<extra winget options>"
:offer_install
where winget >nul 2>nul
if errorlevel 1 goto :offer_manual
echo.
choice /C YN /M "Install %~2 now with winget, the Windows package installer"
if errorlevel 2 goto :offer_manual
winget install -e --id %~1 %~4 --accept-source-agreements --accept-package-agreements
call :seed_path
exit /b 0
:offer_manual
echo.
echo Please install %~2 from %~3
echo and then double-click EXDA again. Opening the download page ...
start "" "%~3"
exit /b 1


rem "EXDA" shortcuts with the EXDA icon: Desktop, Start menu and the EXDA folder itself
rem (EXDA.lnk there is ignored by git, because a shortcut stores this PC's full path).
:make_shortcuts
set "SHORTCUT_ICON=%REPO_ROOT%scripts\EXDA.ico"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'), '%REPO_ROOT:~0,-1%')) { $lnk = $ws.CreateShortcut((Join-Path $dir 'EXDA.lnk')); $lnk.TargetPath = '%REPO_ROOT%Run-EXDA-WIN.bat'; $lnk.WorkingDirectory = '%REPO_ROOT%'; $lnk.IconLocation = '%SHORTCUT_ICON%,0'; $lnk.Description = 'EXDA - EXperimental DAta'; $lnk.Save() }" >nul 2>nul
if errorlevel 1 (
  echo Note: could not create the EXDA shortcut. You can still start EXDA with Run-EXDA-WIN.bat.
) else (
  echo The EXDA shortcut is on your Desktop, in the Start menu and in the EXDA folder.
)
exit /b 0
