@echo off
setlocal

rem Always run from the folder containing this launcher. This makes shortcuts,
rem removable drives, and double-click launches behave the same way.
set "APP_ROOT=%~dp0"
cd /d "%APP_ROOT%"
title Audiobook Workbench Server
rem The launcher serves the compiled release; do not start Vite development middleware.
set "NODE_ENV=production"

rem Do not silently open a browser against an older dev/server instance.
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo Port 3000 is already in use by another process.
  echo Close the existing "Audiobook Workbench Server" or development terminal,
  echo then run this launcher again. The app was not started a second time.
  echo.
  pause
  exit /b 1
)

rem A future first-run bootstrap can place portable Node here. Until then, use
rem a system Node installation when one is available.
set "NODE_EXE=%APP_ROOT%runtime\node\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js is required to start Audiobook Workbench.
  echo Portable Node is not installed and no system Node.js was found.
  echo.
  echo Run the first-run bootstrap once it is available, or install Node.js
  echo for development use.
  pause
  exit /b 1
)

if not exist "%APP_ROOT%dist\server.cjs" (
  echo.
  echo This release has not been built yet. Run npm install then npm run build.
  pause
  exit /b 1
)

start "Audiobook Workbench" "http://127.0.0.1:3000"
"%NODE_EXE%" "%APP_ROOT%dist\server.cjs"
set "SERVER_EXIT=%ERRORLEVEL%"
if not "%SERVER_EXIT%"=="0" (
  echo.
  echo Audiobook Workbench Server stopped unexpectedly with exit code %SERVER_EXIT%.
  echo Review logs\install-repair.log for installer details before closing this window.
  echo.
  pause
)
exit /b %SERVER_EXIT%
