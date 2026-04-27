@echo off
setlocal EnableExtensions EnableDelayedExpansion
title EXDA Dashboard Manager

set "REPO_ROOT=%~dp0"
cd /d "%REPO_ROOT%"
set "DEFAULTS_FILE=%REPO_ROOT%config\exda-defaults.env"

if exist "%DEFAULTS_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%A in ("%DEFAULTS_FILE%") do (
    if not "%%~A"=="" if not "%%~A:~0,1%%"=="#" set "%%~A=%%~B"
  )
)

set "HAS_ERRORS=0"
set "PYTHON_EXE="
set "PYTHON_ARGS="
set "CHECK_FILE=%TEMP%\exda_missing_python_%RANDOM%.txt"
set "PY_PREFIX_FILE=%TEMP%\exda_python_prefix_%RANDOM%.txt"
set "BACKEND_LOG=%TEMP%\exda_backend_%RANDOM%.log"
set "FRONTEND_HOST=%EXDA_FRONTEND_HOST%"
if not defined FRONTEND_HOST set "FRONTEND_HOST=%EXDA_DEFAULT_FRONTEND_HOST%"
set "FRONTEND_PORT=%EXDA_FRONTEND_PORT%"
if not defined FRONTEND_PORT set "FRONTEND_PORT=%EXDA_DEFAULT_FRONTEND_PORT%"
set "BACKEND_HOST=%EXDA_BACKEND_HOST%"
if not defined BACKEND_HOST set "BACKEND_HOST=%EXDA_DEFAULT_BACKEND_HOST%"
set "BACKEND_PORT=%EXDA_BACKEND_PORT%"
if not defined BACKEND_PORT set "BACKEND_PORT=%EXDA_DEFAULT_BACKEND_PORT%"

if exist "%REPO_ROOT%\.venv\Scripts" set "PATH=%REPO_ROOT%\.venv\Scripts;%PATH%"
if exist "%ProgramFiles%\nodejs" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%LocalAppData%\Programs\nodejs" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"
if exist "%AppData%\npm" set "PATH=%AppData%\npm;%PATH%"
if exist "%USERPROFILE%\scoop\shims" set "PATH=%USERPROFILE%\scoop\shims;%PATH%"
if defined ChocolateyInstall if exist "%ChocolateyInstall%\bin" set "PATH=%ChocolateyInstall%\bin;%PATH%"

echo ========================================
echo EXDA Launcher (Windows)
echo ========================================

if exist "%REPO_ROOT%\.venv\Scripts\python.exe" (
  set "PYTHON_EXE=%REPO_ROOT%\.venv\Scripts\python.exe"
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    set "PYTHON_EXE=py"
    set "PYTHON_ARGS=-3"
  ) else (
    where python >nul 2>nul
    if not errorlevel 1 (
      set "PYTHON_EXE=python"
    )
  )
)

if defined PYTHON_EXE (
  set "PY_PREFIX="
  "%PYTHON_EXE%" %PYTHON_ARGS% -c "import sys; print(sys.prefix)" > "%PY_PREFIX_FILE%" 2>nul
  if errorlevel 1 (
    if /I "%PYTHON_EXE%"=="%REPO_ROOT%\.venv\Scripts\python.exe" (
      set "PYTHON_EXE="
      set "PYTHON_ARGS="
      where py >nul 2>nul
      if not errorlevel 1 (
        set "PYTHON_EXE=py"
        set "PYTHON_ARGS=-3"
      ) else (
        where python >nul 2>nul
        if not errorlevel 1 (
          set "PYTHON_EXE=python"
        )
      )
    )
  ) else (
    set /p PY_PREFIX=<"%PY_PREFIX_FILE%"
    if /I "%PYTHON_EXE%"=="%REPO_ROOT%\.venv\Scripts\python.exe" (
      if /I not "%PY_PREFIX%"=="%REPO_ROOT%\.venv" (
        set "PYTHON_EXE="
        set "PYTHON_ARGS="
        where py >nul 2>nul
        if not errorlevel 1 (
          set "PYTHON_EXE=py"
          set "PYTHON_ARGS=-3"
        ) else (
          where python >nul 2>nul
          if not errorlevel 1 (
            set "PYTHON_EXE=python"
          )
        )
      )
    )
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo  - Missing tool: node
  set "HAS_ERRORS=1"
)

where npm >nul 2>nul
if errorlevel 1 (
  echo  - Missing tool: npm
  set "HAS_ERRORS=1"
)

if not defined PYTHON_EXE (
  echo  - Missing tool: Python 3
  set "HAS_ERRORS=1"
)

if not defined FRONTEND_HOST (
  echo  - Missing runtime setting: EXDA_DEFAULT_FRONTEND_HOST in config\exda-defaults.env
  set "HAS_ERRORS=1"
)

if not defined FRONTEND_PORT (
  echo  - Missing runtime setting: EXDA_DEFAULT_FRONTEND_PORT in config\exda-defaults.env
  set "HAS_ERRORS=1"
)

if not defined BACKEND_HOST (
  echo  - Missing runtime setting: EXDA_DEFAULT_BACKEND_HOST in config\exda-defaults.env
  set "HAS_ERRORS=1"
)

if not defined BACKEND_PORT (
  echo  - Missing runtime setting: EXDA_DEFAULT_BACKEND_PORT in config\exda-defaults.env
  set "HAS_ERRORS=1"
)

node -e "require.resolve('vite/package.json'); require.resolve('react/package.json'); require.resolve('react-dom/package.json')" >nul 2>nul
if errorlevel 1 (
  echo  - Missing npm packages: run npm install
  set "HAS_ERRORS=1"
)

if defined PYTHON_EXE (
  "%PYTHON_EXE%" %PYTHON_ARGS% scripts\check_runtime_requirements.py --requirements backend\requirements.txt > "%CHECK_FILE%" 2>nul
  set "PY_CHECK_EXIT=%ERRORLEVEL%"
  if "%PY_CHECK_EXIT%"=="1" (
    for /f "usebackq delims=" %%L in ("%CHECK_FILE%") do (
      if not "%%L"=="" echo  - Missing Python package: %%L
    )
    set "HAS_ERRORS=1"
  ) else if not "%PY_CHECK_EXIT%"=="0" (
    echo  - Could not verify Python packages in backend\requirements.txt
    set "HAS_ERRORS=1"
  )
)

if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
if exist "%PY_PREFIX_FILE%" del /q "%PY_PREFIX_FILE%" >nul 2>nul

if "%HAS_ERRORS%"=="1" (
  echo.
  echo EXDA cannot start yet. Please install the missing requirements.
  echo.
  echo Recommended setup commands:
  echo   npm install
  echo   py -3 -m venv .venv
  echo   .venv\Scripts\activate
  echo   pip install -r backend\requirements.txt
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
start "EXDA Backend" /B "%PYTHON_EXE%" %PYTHON_ARGS% backend\app.py > "%BACKEND_LOG%" 2>&1

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
echo Close this terminal window to stop BOTH the frontend and backend.
echo ===================================================
call npm run vite -- --host %FRONTEND_HOST% --port %FRONTEND_PORT%

endlocal
exit /b 0
