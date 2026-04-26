@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_ROOT=%~dp0"
cd /d "%REPO_ROOT%"

set "PYTHON_EXE="
set "PYTHON_ARGS="
set "CHECK_FILE=%TEMP%\exda_setup_missing_%RANDOM%.txt"

call :prepend_path_if_dir "%REPO_ROOT%\.venv\Scripts"
call :prepend_path_if_dir "%ProgramFiles%\nodejs"
call :prepend_path_if_dir "%ProgramFiles(x86)%\nodejs"
call :prepend_path_if_dir "%LocalAppData%\Programs\nodejs"
call :prepend_path_if_dir "%AppData%\npm"
call :prepend_path_if_dir "%USERPROFILE%\scoop\shims"
if defined ChocolateyInstall call :prepend_path_if_dir "%ChocolateyInstall%\bin"

echo ========================================
echo EXDA Setup (Windows)
echo ========================================

where node >nul 2>nul
if errorlevel 1 (
  call :fail "Missing tool: node"
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  call :fail "Missing tool: npm"
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
  call :fail "Missing tool: Python 3"
  exit /b 1
)

if not exist "%REPO_ROOT%\.venv\Scripts\python.exe" (
  echo.
  echo Creating local .venv ...
  "%PYTHON_EXE%" %PYTHON_ARGS% -m venv .venv
  if errorlevel 1 (
    call :fail "Could not create .venv"
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
  call :fail "npm install failed"
  exit /b 1
)
node -e "require.resolve('vite/package.json'); require.resolve('react/package.json'); require.resolve('react-dom/package.json')" >nul 2>nul
if errorlevel 1 (
  call :fail "Frontend packages are still incomplete after npm install"
  exit /b 1
)

echo.
echo Upgrading pip in local .venv ...
"%PYTHON_EXE%" %PYTHON_ARGS% -m pip install --upgrade pip >nul 2>nul
if errorlevel 1 (
  call :fail "Could not upgrade pip in .venv"
  exit /b 1
)

echo Installing backend requirements ...
"%PYTHON_EXE%" %PYTHON_ARGS% -m pip install -r backend\requirements.txt
if errorlevel 1 (
  call :fail "Failed to install backend\requirements.txt"
  exit /b 1
)
"%PYTHON_EXE%" %PYTHON_ARGS% scripts\check_runtime_requirements.py --requirements backend\requirements.txt > "%CHECK_FILE%" 2>nul
if not "%ERRORLEVEL%"=="0" (
  call :fail "Backend Python requirements are still incomplete"
  exit /b 1
)

echo Installing optional feature requirements ...
"%PYTHON_EXE%" %PYTHON_ARGS% -m pip install -r backend\requirements-optional.txt
if errorlevel 1 (
  call :fail "Failed to install backend\requirements-optional.txt"
  exit /b 1
)
"%PYTHON_EXE%" %PYTHON_ARGS% scripts\check_runtime_requirements.py --requirements backend\requirements-optional.txt > "%CHECK_FILE%" 2>nul
if not "%ERRORLEVEL%"=="0" (
  call :fail "Optional Python requirements are still incomplete"
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

:prepend_path_if_dir
if "%~1"=="" exit /b 0
if not exist "%~1" exit /b 0
echo ;%PATH%; | find /I ";%~1;" >nul
if errorlevel 1 set "PATH=%~1;%PATH%"
exit /b 0

:fail
if exist "%CHECK_FILE%" del /q "%CHECK_FILE%" >nul 2>nul
echo.
echo Setup failed: %~1
echo.
pause
endlocal
exit /b 1
