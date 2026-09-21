@echo off
setlocal enabledelayedexpansion
title Xayz SSH Online
color 0B
cd /d "%~dp0"

echo.
echo   ==================================================
echo     Xayz SSH Online - mode lokal (WebSocket penuh)
echo   ==================================================
echo.
echo   Komputer ini TIDAK perlu punya OpenSSH / perintah "ssh".
echo   Koneksi SSH dikerjakan sendiri oleh aplikasi ini.
echo.

call "%~dp0bootstrap.bat"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=8787
if "%HOST%"=="" set HOST=127.0.0.1

echo.
echo   Menyalakan server di http://%HOST%:%PORT%
echo   Tekan Ctrl+C untuk berhenti.
echo.

start "" "http://%HOST%:%PORT%"
"%NODE_EXE%" server.js

echo.
echo   Server berhenti.
pause
