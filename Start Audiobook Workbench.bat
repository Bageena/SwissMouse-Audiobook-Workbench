@echo off
setlocal

rem Always run from the folder containing this launcher. This makes shortcuts,
rem removable drives, and double-click launches behave the same way.
set "APP_ROOT=%~dp0"
cd /d "%APP_ROOT%"
title SwissMouse Server
rem The launcher serves the compiled release; do not start Vite development middleware.
set "NODE_ENV=production"

rem Do not silently open a browser against an older dev/server instance.
netstat -ano | findstr /R /C:":3000 .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo Port 3000 is already in use by another process.
  echo Close the existing "SwissMouse Server" or development terminal,
  echo then run this launcher again. The app was not started a second time.
  echo.
  pause
  exit /b 1
)

rem A future first-run bootstrap can place portable Node here. Until then, use
rem a system Node installation when one is available.
set "NODE_EXE=%APP_ROOT%runtime\node\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
set "NPM_EXE=%APP_ROOT%runtime\node\npm.cmd"
if not exist "%NPM_EXE%" set "NPM_EXE=npm"

"%NODE_EXE%" --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js is required to start SwissMouse.
  echo Portable Node is not installed and no system Node.js was found.
  echo.
  echo Run the first-run bootstrap once it is available, or install Node.js
  echo for development use.
  pause
  exit /b 1
)

if not exist "%APP_ROOT%node_modules" (
  echo.
  echo Installing the locked application dependencies for this first run...
  call "%NPM_EXE%" ci
  if errorlevel 1 (
    echo.
    echo Dependency installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

if not exist "%APP_ROOT%dist\server.cjs" (
  echo.
  echo Building the application for this first run...
  call "%NPM_EXE%" run build
  if errorlevel 1 (
    echo.
    echo The application build failed. Review the output above and try again.
    pause
    exit /b 1
  )
)

start "SwissMouse" "http://127.0.0.1:3000"
"%NODE_EXE%" "%APP_ROOT%dist\server.cjs"
set "SERVER_EXIT=%ERRORLEVEL%"
if not "%SERVER_EXIT%"=="0" (
  echo.
  echo SwissMouse Server stopped unexpectedly with exit code %SERVER_EXIT%.
  echo Review logs\install-repair.log for installer details before closing this window.
  echo.
  pause
)
exit /b %SERVER_EXIT%
