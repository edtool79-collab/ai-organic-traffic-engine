@echo off
setlocal
title Traffic Engine Dashboard (Port 4310)
cd /d "%~dp0"
set "NODE_EXE="
where node >nul 2>nul && for /f "delims=" %%n in ('where node') do if not defined NODE_EXE set "NODE_EXE=%%n"
if not defined NODE_EXE (
  for /f "delims=" %%n in ('dir /b /s "%LOCALAPPDATA%\Microsoft\WinGet\Packages\*node*.exe" 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%n"
)
if not defined NODE_EXE (
  echo [ERROR] Node.js not found. Please install Node.js LTS.
  pause
  exit /b 1
)
echo Starting Dashboard Server on Desktop (http://127.0.0.1:4310)...
"%NODE_EXE%" dashboard/server.js --open
pause
