@echo off
setlocal enabledelayedexpansion
title Xayz SSH Console
color 0A
cd /d "%~dp0"

echo.
echo   ==================================================
echo     Xayz SSH Console - SSH tanpa browser
echo   ==================================================
echo.
echo   Untuk komputer yang tidak punya OpenSSH dan tidak
echo   boleh memasang apa pun. Semua dijalankan portabel
echo   dari folder ini.
echo.

call "%~dp0bootstrap.bat"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo.
"%NODE_EXE%" cli.js
echo.
pause
