@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_ROOT=%~dp0"
cd /d "%REPO_ROOT%"

set "PYTHON_EXE="
set "PYTHON_ARGS="
set "CHECK_FILE=%TEMP%\exda_setup_missing_%RANDOM%.txt"

if exist "%REPO_ROOT%\.venv\Scripts" set "PATH=%REPO_ROOT%\.venv\Scripts;%PATH%"
if exist "%ProgramFiles%\nodejs" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%LocalAppData%\Programs\nodejs" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"
if exist "%AppData%\npm" set "PATH=%AppData%\npm;%PATH%"
if exist "%USERPROFILE%\scoop\shims" set "PATH=%USERPROFILE%\scoop\shims;%PATH%"
if defined ChocolateyInstall if exist "%ChocolateyInstall%\bin" set "PATH=%ChocolateyInstall%\bin;%PATH%"

echo ========================================
echo EXDA Setup (Windows)
echo ========================================

where node >nul 2>nul
if errorlevel 1 (
  if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
  echo.
  echo Setup failed: Missing tool: node
  echo.
  pause
  endlocal
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
  echo.
  echo Setup failed: Missing tool: npm
  echo.
  pause
  endlocal
  exit /b 1
)

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

if not defined PYTHON_EXE (
  if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
  echo.
  echo Setup failed: Missing tool: Python 3
  echo.
  pause
  endlocal
  exit /b 1
)

if not exist "%REPO_ROOT%\.venv\Scripts\python.exe" (
  echo.
  echo Creating local .venv ...
  "%PYTHON_EXE%" %PYTHON_ARGS% -m venv .venv
  if errorlevel 1 (
    if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
    echo.
    echo Setup failed: Could not create .venv
    echo.
    pause
    endlocal
    exit /b 1
  )
  set "PYTHON_EXE=%REPO_ROOT%\.venv\Scripts\python.exe"
  set "PYTHON_ARGS="
)

if exist "%REPO_ROOT%\.venv\Scripts\activate.bat" (
  call "%REPO_ROOT%\.venv\Scripts\activate.bat" >nul 2>nul
)

echo.
echo Installing frontend dependencies with npm ...
call npm install
if errorlevel 1 (
  if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
  echo.
  echo Setup failed: npm install failed
  echo.
  pause
  endlocal
  exit /b 1
)
node -e "require.resolve('vite/package.json'); require.resolve('react/package.json'); require.resolve('react-dom/package.json')" >nul 2>nul
if errorlevel 1 (
  if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
  echo.
  echo Setup failed: Frontend packages are still incomplete after npm install
  echo.
  pause
  endlocal
  exit /b 1
)

echo.
echo Upgrading pip in local .venv ...
"%PYTHON_EXE%" %PYTHON_ARGS% -m pip install --upgrade pip >nul 2>nul
if errorlevel 1 (
  if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
  echo.
  echo Setup failed: Could not upgrade pip in .venv
  echo.
  pause
  endlocal
  exit /b 1
)

echo Installing backend requirements ...
"%PYTHON_EXE%" %PYTHON_ARGS% -m pip install -r backend\requirements.txt
if errorlevel 1 (
  if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
  echo.
  echo Setup failed: Failed to install backend\requirements.txt
  echo.
  pause
  endlocal
  exit /b 1
)
"%PYTHON_EXE%" %PYTHON_ARGS% scripts\check_runtime_requirements.py --requirements backend\requirements.txt > "%CHECK_FILE%" 2>nul
if not "%ERRORLEVEL%"=="0" (
  if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
  echo.
  echo Setup failed: Backend Python requirements are still incomplete
  echo.
  pause
  endlocal
  exit /b 1
)

echo Installing optional feature requirements ...
"%PYTHON_EXE%" %PYTHON_ARGS% -m pip install -r backend\requirements-optional.txt
if errorlevel 1 (
  if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
  echo.
  echo Setup failed: Failed to install backend\requirements-optional.txt
  echo.
  pause
  endlocal
  exit /b 1
)
"%PYTHON_EXE%" %PYTHON_ARGS% scripts\check_runtime_requirements.py --requirements backend\requirements-optional.txt > "%CHECK_FILE%" 2>nul
if not "%ERRORLEVEL%"=="0" (
  if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
  echo.
  echo Setup failed: Optional Python requirements are still incomplete
  echo.
  pause
  endlocal
  exit /b 1
)

if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul

echo.
echo EXDA setup is complete.
echo.
echo The EXDA launcher uses .venv automatically.
echo If you want this Command Prompt itself to stay activated afterward, run:
echo   call .venv\Scripts\activate.bat
echo.
echo Next step:
echo   Run-EXDA-WIN.bat
echo.
pause
endlocal
exit /b 0
