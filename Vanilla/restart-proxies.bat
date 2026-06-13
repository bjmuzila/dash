@echo off
:: Kill existing processes on 3001 and 3002
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 2^>nul') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3002 2^>nul') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: Install/update proxy dependencies (picks up better-sqlite3 if new)
echo Installing proxy dependencies...
cd /d %~dp0
call npm install --prefer-offline >nul 2>&1

:: Start proxy
start "SPX GEX Proxy" cmd /k "cd /d %~dp0 && node proxy-tastytrade.js"
timeout /t 3 /nobreak >nul

:: Start Next.js
start "BzilaTrades Next" cmd /k "cd /d %~dp0\bzila-dashboard && npm run dev"

echo Done. Proxy on 3001, Next.js on 3002.
