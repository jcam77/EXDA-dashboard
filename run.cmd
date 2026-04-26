@echo off
setlocal EnableExtensions

set "APP=%~1"
set "ROOT_DIR=%~dp0"

if "%APP%"=="" (
  echo Usage: run ^<appName^>
  echo Examples:
  echo   run EXDA
  echo   run exda
  echo   run dashboard
  exit /b 1
)

if /I "%APP%"=="EXDA" goto launch
if /I "%APP%"=="exda" goto launch
if /I "%APP%"=="dashboard" goto launch
if /I "%APP%"=="EXDA-dashboard" goto launch
if "%APP%"=="v0.3" goto launch
if "%APP%"=="0.3" goto launch

echo Unknown app: %APP%
echo Supported: EXDA, exda, dashboard
exit /b 1

:launch
call "%ROOT_DIR%Run-EXDA-WIN.bat"
exit /b %ERRORLEVEL%
