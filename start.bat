@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo [setup] Installing dependencies...
  call npm install || goto :error
)

if not exist "vendor\stockfish\stockfish.exe" (
  echo [setup] Downloading Stockfish and opening book data...
  call npm run setup || goto :error
)

if not exist "web\dist\index.html" (
  echo [build] Building web UI...
  call npm run build || goto :error
)

set OPEN_BROWSER=1
call npm run start
goto :eof

:error
echo.
echo Something failed. See the messages above.
pause
