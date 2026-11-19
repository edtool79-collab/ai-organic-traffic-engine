@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Traffic Engine Dashboard (Port 4310)
cd /d "%~dp0"
if not defined DASH_PORT set "DASH_PORT=4310"

echo Cleaning up previous dashboard processes on port %DASH_PORT%...
set "KILLED_PREV=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%DASH_PORT% " ^| findstr "LISTENING"') do (
  if not "%%p"=="0" (
    taskkill /F /T /PID %%p >nul 2>nul
    set "KILLED_PREV=1"
  )
)
if "!KILLED_PREV!"=="1" (
  for /l %%i in (1,1,6) do (
    netstat -ano | findstr ":%DASH_PORT% " | findstr "LISTENING" >nul 2>nul && (
      ping -n 2 127.0.0.1 >nul
    )
  )
)

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
echo Starting Dashboard Server on Desktop (http://127.0.0.1:%DASH_PORT%)...
"%NODE_EXE%" dashboard/server.js --open
pause
