@echo off
title Xayz SSH Console
color 0A

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js tidak ditemukan. Unduh di https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\ssh2" (
  echo   Memasang dependensi untuk pertama kali...
  call npm install --omit=dev --no-audit --no-fund
)

node cli.js
pause
