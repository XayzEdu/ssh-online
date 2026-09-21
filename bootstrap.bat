@echo off
rem ============================================================================
rem  Xayz SSH Online - penyiap otomatis
rem
rem  Dipanggil oleh start.bat dan ssh-console.bat. Tugasnya satu: memastikan
rem  ada Node.js yang bisa dipakai, walau komputer ini:
rem    - tidak punya OpenSSH / perintah "ssh" sama sekali
rem    - tidak punya Node.js
rem    - tidak boleh memasang program apa pun (tanpa hak admin)
rem
rem  Kalau Node tidak ada, skrip ini mengunduh Node portabel (file zip biasa)
rem  ke folder runtime\ di dalam folder aplikasi. Tidak ada yang dipasang ke
rem  sistem, tidak menyentuh registry, tidak butuh admin. Hapus folder runtime\
rem  maka jejaknya hilang sepenuhnya.
rem
rem  Koneksi SSH-nya sendiri memakai pustaka ssh2 (JavaScript murni), jadi
rem  Windows tidak perlu punya klien SSH apa pun.
rem ============================================================================

set "APPDIR=%~dp0"
set "NODE_EXE="
set "NPM_CMD="
set "RUNTIME=%APPDIR%runtime"

rem ---------------------------------------------------------- 1. Node sistem
where node >nul 2>nul
if not errorlevel 1 (
  set "NODE_EXE=node"
  set "NPM_CMD=npm"
  goto :have_node
)

rem ------------------------------------------------- 2. Node portabel lokal
if exist "%RUNTIME%\node\node.exe" (
  set "NODE_EXE=%RUNTIME%\node\node.exe"
  set "NPM_CMD=%RUNTIME%\node\npm.cmd"
  goto :have_node
)

rem ------------------------------------------------- 3. Unduh Node portabel
echo.
echo   Node.js belum ada di komputer ini.
echo   Xayz akan mengunduh Node portabel ke folder runtime\ ^(sekali saja^).
echo   Tidak dipasang ke sistem, tidak butuh hak admin.
echo.

rem Pilih arsitektur: 64-bit kalau ada, kalau tidak 32-bit.
set "NARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" (
  if not defined PROCESSOR_ARCHITEW6432 set "NARCH=x86"
)

rem v22 = LTS untuk Windows 10/11. v16 = versi terakhir yang jalan di Windows 7/8.
set "NVER=v22.11.0"
call :download_node %NVER% %NARCH%
if exist "%RUNTIME%\node\node.exe" (
  "%RUNTIME%\node\node.exe" -v >nul 2>nul
  if not errorlevel 1 goto :portable_ok
  echo   Node %NVER% tidak jalan di Windows versi ini. Mencoba versi lama...
  rmdir /s /q "%RUNTIME%\node" >nul 2>nul
)

set "NVER=v16.20.2"
call :download_node %NVER% %NARCH%
if not exist "%RUNTIME%\node\node.exe" (
  echo.
  echo   [X] Gagal menyiapkan Node.js otomatis.
  echo       Cara manual: unduh https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-%NARCH%.zip
  echo       lalu ekstrak isinya ke folder: %RUNTIME%\node
  echo       ^(sampai ada berkas %RUNTIME%\node\node.exe^), lalu jalankan lagi.
  echo.
  exit /b 1
)

:portable_ok
set "NODE_EXE=%RUNTIME%\node\node.exe"
set "NPM_CMD=%RUNTIME%\node\npm.cmd"

:have_node
for /f "tokens=*" %%v in ('"%NODE_EXE%" -v 2^>nul') do set "NODEV=%%v"
echo   Node.js siap: %NODEV%

rem ------------------------------------------------------ 4. Dependensi npm
if exist "%APPDIR%node_modules\ssh2\package.json" goto :deps_ok

echo   Memasang pustaka SSH untuk pertama kali. Mohon tunggu...
pushd "%APPDIR%"
call "%NPM_CMD%" install --omit=dev --no-audit --no-fund
popd

if not exist "%APPDIR%node_modules\ssh2\package.json" (
  echo.
  echo   [X] Pemasangan pustaka gagal.
  echo       Biasanya karena komputer ini sedang tidak terhubung internet,
  echo       atau registry npm diblokir jaringan kantor/sekolah.
  echo       Coba lagi saat internet normal, atau salin folder node_modules
  echo       dari komputer lain yang sudah berhasil.
  echo.
  exit /b 1
)

:deps_ok
exit /b 0

rem ===========================================================================
rem  :download_node <versi> <arsitektur>
rem  Mengunduh dan mengekstrak Node portabel memakai PowerShell bawaan Windows.
rem ===========================================================================
:download_node
set "DLVER=%~1"
set "DLARCH=%~2"
set "DLNAME=node-%DLVER%-win-%DLARCH%"
set "DLURL=https://nodejs.org/dist/%DLVER%/%DLNAME%.zip"

if not exist "%RUNTIME%" mkdir "%RUNTIME%" >nul 2>nul

echo   Mengunduh %DLNAME%.zip ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try {" ^
  "  [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;" ^
  "  $zip=Join-Path '%RUNTIME%' 'node.zip';" ^
  "  (New-Object Net.WebClient).DownloadFile('%DLURL%', $zip);" ^
  "  $tmp=Join-Path '%RUNTIME%' 'tmp';" ^
  "  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }" ^
  "  Add-Type -AssemblyName System.IO.Compression.FileSystem;" ^
  "  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $tmp);" ^
  "  $src=Join-Path $tmp '%DLNAME%';" ^
  "  Move-Item $src (Join-Path '%RUNTIME%' 'node') -Force;" ^
  "  Remove-Item $tmp -Recurse -Force;" ^
  "  Remove-Item $zip -Force;" ^
  "  Write-Host '  Node portabel siap.'" ^
  "} catch { Write-Host ('  Unduhan gagal: ' + $_.Exception.Message) }"

exit /b 0
