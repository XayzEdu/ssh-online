@echo off
setlocal enabledelayedexpansion
title Xayz SSH Online
color 0B

echo.
echo   ==================================================
echo     Xayz SSH Online - mode lokal (WebSocket penuh)
echo   ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js tidak ditemukan.
  echo       Unduh Node.js 20+ ^(disarankan 24^) di https://nodejs.org
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODEV=%%v
echo   Node.js terdeteksi: %NODEV%

if not exist "node_modules\ssh2" (
  echo   Memasang dependensi untuk pertama kali. Mohon tunggu...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo   [X] npm install gagal. Cek koneksi internet.
    pause
    exit /b 1
  )
)

if "%PORT%"=="" set PORT=8787
if "%HOST%"=="" set HOST=127.0.0.1

echo   Menyalakan server di http://%HOST%:%PORT%
echo   Tekan Ctrl+C untuk berhenti.
echo.

start "" "http://%HOST%:%PORT%"
node server.js

echo.
echo   Server berhenti.
pause
