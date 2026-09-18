@echo off
setlocal

set "APP_ROOT=%~dp0.."
cd /d "%APP_ROOT%"

call npm ci
if errorlevel 1 exit /b %ERRORLEVEL%
call npm run lint
if errorlevel 1 exit /b %ERRORLEVEL%
call npm run test:audio
if errorlevel 1 exit /b %ERRORLEVEL%
call npm run build
if errorlevel 1 exit /b %ERRORLEVEL%
call npx tsx scripts\build-release.ts
if errorlevel 1 exit /b %ERRORLEVEL%

for /f %%v in ('node -p "require('./package.json').version"') do set "VERSION=%%v"
powershell -NoProfile -Command "Compress-Archive -Path ('release\SwissMouse-%VERSION%') -DestinationPath ('release\SwissMouse-%VERSION%.zip') -Force"
if errorlevel 1 exit /b %ERRORLEVEL%

echo Release archive created: release\SwissMouse-%VERSION%.zip
