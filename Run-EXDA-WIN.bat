@echo off
setlocal EnableExtensions EnableDelayedExpansion
title EXDA

rem Starts EXDA on Windows (double-click, or the EXDA shortcut).
rem Every start runs a quick check. On the first start on a computer, or when
rem something is missing, it runs Setup-EXDA-WIN.bat first and then starts EXDA.

set "REPO_ROOT=%~dp0"
cd /d "%REPO_ROOT%"
set "DEFAULTS_FILE=%REPO_ROOT%config\exda-defaults.env"

if exist "%DEFAULTS_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%DEFAULTS_FILE%") do (
    set "EXDA_DEF_KEY=%%~A"
    if defined EXDA_DEF_KEY if not "!EXDA_DEF_KEY:~0,1!"=="#" set "%%~A=%%~B"
  )
)

set "VENV_PY=%REPO_ROOT%.venv-win\Scripts\python.exe"
set "PY_OK=import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
set "NODE_PKGS_OK=require('rollup'); require.resolve('vite/package.json'); require.resolve('react/package.json'); require.resolve('react-dom/package.json')"
set "BACKEND_LOG=%TEMP%\exda_backend_%RANDOM%.log"
set "FRONTEND_HOST=%EXDA_FRONTEND_HOST%"
if not defined FRONTEND_HOST set "FRONTEND_HOST=%EXDA_DEFAULT_FRONTEND_HOST%"
set "FRONTEND_PORT=%EXDA_FRONTEND_PORT%"
if not defined FRONTEND_PORT set "FRONTEND_PORT=%EXDA_DEFAULT_FRONTEND_PORT%"
set "BACKEND_HOST=%EXDA_BACKEND_HOST%"
if not defined BACKEND_HOST set "BACKEND_HOST=%EXDA_DEFAULT_BACKEND_HOST%"
set "BACKEND_PORT=%EXDA_BACKEND_PORT%"
if not defined BACKEND_PORT set "BACKEND_PORT=%EXDA_DEFAULT_BACKEND_PORT%"

echo ========================================
echo EXDA Launcher (Windows)
echo ========================================
call :seed_path

echo Checking requirements ...
call :needs_setup
if not errorlevel 1 (
  echo.
  echo EXDA needs to install some components on this computer first: !SETUP_REASON!.
  echo This happens once and can take several minutes.
  echo.
  call "%REPO_ROOT%Setup-EXDA-WIN.bat" --from-launcher
  if errorlevel 1 exit /b 1
  call :seed_path
  call :needs_setup
  if not errorlevel 1 (
    echo.
    echo EXDA cannot start yet: !SETUP_REASON!.
    echo Run Setup-EXDA-WIN.bat in this folder and read its messages.
    echo.
    pause
    exit /b 1
  )
)
echo Requirements OK.

set "SETTINGS_OK=1"
if not defined FRONTEND_HOST set "SETTINGS_OK=0"
if not defined FRONTEND_PORT set "SETTINGS_OK=0"
if not defined BACKEND_HOST set "SETTINGS_OK=0"
if not defined BACKEND_PORT set "SETTINGS_OK=0"
if "%SETTINGS_OK%"=="0" (
  echo.
  echo EXDA cannot start: host or port settings are missing in config\exda-defaults.env
  echo.
  pause
  exit /b 1
)

echo.
echo Starting EXDA backend on http://%BACKEND_HOST%:%BACKEND_PORT% ...
set EXDA_BACKEND_DEBUG=1
set EXDA_BACKEND_HOST=%BACKEND_HOST%
set EXDA_BACKEND_PORT=%BACKEND_PORT%
set EXDA_FRONTEND_HOST=%FRONTEND_HOST%
set EXDA_FRONTEND_PORT=%FRONTEND_PORT%
set EXDA_CORS_ORIGINS=http://%FRONTEND_HOST%:%FRONTEND_PORT%,http://localhost:%FRONTEND_PORT%,http://127.0.0.1:%FRONTEND_PORT%
if exist "%BACKEND_LOG%" del /q "%BACKEND_LOG%" >nul 2>nul
start "EXDA Backend" /B "%VENV_PY%" backend\app.py > "%BACKEND_LOG%" 2>&1

powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(20); while((Get-Date) -lt $deadline){ try { $client=New-Object System.Net.Sockets.TcpClient; $iar=$client.BeginConnect('%BACKEND_HOST%', %BACKEND_PORT%, $null, $null); if($iar.AsyncWaitHandle.WaitOne(500, $false) -and $client.Connected){ $client.Close(); exit 0 } $client.Close() } catch {} Start-Sleep -Milliseconds 500 }; exit 1" >nul 2>nul
if errorlevel 1 (
  echo.
  echo The backend stopped during startup. Check the error output below.
  if exist "%BACKEND_LOG%" (
    echo.
    type "%BACKEND_LOG%"
  )
  echo.
  pause
  exit /b 1
)

echo Starting EXDA frontend on http://%FRONTEND_HOST%:%FRONTEND_PORT% ...
echo App URL:
echo   http://%FRONTEND_HOST%:%FRONTEND_PORT%/?backendPort=%BACKEND_PORT%
echo ===================================================
echo EXDA IS RUNNING
echo Close this window to stop EXDA.
echo ===================================================
call npm run vite -- --host %FRONTEND_HOST% --port %FRONTEND_PORT%

endlocal
exit /b 0


rem ==========================================================================
rem Add the usual install folders of Node.js and Python to PATH (same list as
rem Setup-EXDA-WIN.bat), so tools installed a moment ago are found.
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


rem Quick check before every start. Returns 0 (and sets SETUP_REASON) when setup
rem has to run, 1 when everything EXDA needs is in place.
:needs_setup
set "SETUP_REASON="
if not exist "%VENV_PY%" (
  set "SETUP_REASON=the Python environment for Windows is not set up yet"
  exit /b 0
)
"%VENV_PY%" -c "!PY_OK!" >nul 2>nul
if errorlevel 1 (
  set "SETUP_REASON=the Python environment does not work on this computer"
  exit /b 0
)
"%VENV_PY%" scripts\check_runtime_requirements.py --requirements backend\requirements.txt >nul 2>nul
if errorlevel 1 (
  set "SETUP_REASON=some Python packages are missing"
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  set "SETUP_REASON=Node.js is not installed"
  exit /b 0
)
node scripts\check_node_version.cjs >nul 2>nul
if errorlevel 1 (
  set "SETUP_REASON=Node.js is too old"
  exit /b 0
)
node -e "%NODE_PKGS_OK%" >nul 2>nul
if errorlevel 1 (
  set "SETUP_REASON=some frontend packages are missing"
  exit /b 0
)
exit /b 1
