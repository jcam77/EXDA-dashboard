@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_ROOT=%~dp0"
cd /d "%REPO_ROOT%"

set "HAS_ERRORS=0"
set "PYTHON_EXE="
set "PYTHON_ARGS="
set "CHECK_FILE=%TEMP%\exda_missing_python_%RANDOM%.txt"

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
echo Starting EXDA backend on http://127.0.0.1:5000 ...
start "EXDA Backend" cmd /k "cd /d \"%REPO_ROOT%\" && set EXDA_BACKEND_DEBUG=1 && set EXDA_BACKEND_PORT=5000 && \"%PYTHON_EXE%\" %PYTHON_ARGS% backend\app.py"

timeout /t 2 >nul

echo Starting EXDA frontend and opening the browser ...
call npm run vite

endlocal
