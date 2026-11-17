@echo off
setlocal
title HirePulse Web Traffic & Swarm Dashboard (Port 4310)
cd /d "%~dp0"
echo Stopping any background server on port 4310...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":4310 .*LISTENING"') do (
  taskkill /F /T /PID %%a >nul 2>nul
)
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue; if ($c) { foreach ($x in $c) { Stop-Process -Id $x.OwningProcess -Force -ErrorAction SilentlyContinue } }" >nul 2>nul
powershell -NoProfile -Command "for ($i=0; $i -lt 20; $i++) { $c = Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue; if (-not $c) { break }; Start-Sleep -Milliseconds 250 }" >nul 2>nul
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
