@echo off
title SPX GEX Dashboard
echo.
echo  Starting SPX GEX Dashboard...
echo.

:: Kill any existing instances on ports 3001 and 3002
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 2^>nul') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3002 2^>nul') do taskkill /PID %%a /F >nul 2>&1

:: Copy logo to Next.js public folder
if not exist "%~dp0bzila-dashboard\public\bzilatrades-logo.png" (
    copy "%~dp0assets\bzilatrades-logo.png" "%~dp0bzila-dashboard\public\bzilatrades-logo.png" >nul 2>&1
)

:: Install proxy dependencies if needed, then start (port 3001)
start "Tastytrade Proxy" cmd /k "cd /d %~dp0 && npm install --prefix . dotenv ws 2>nul & node server\proxy-tastytrade.js"

:: Wait for proxy to initialize
echo  Waiting for proxy to start...
timeout /t 3 /nobreak >nul

:: Install dashboard dependencies if needed, then start Next.js (port 3002)
start "BzilaTrades Next" cmd /k "cd /d %~dp0\bzila-dashboard && npm install html2canvas 2>nul & npm run dev"

:: Wait for Next.js to compile
echo  Waiting for Next.js to start...
timeout /t 5 /nobreak >nul

:: Open dashboard
echo  Opening dashboard...
start http://localhost:3002

echo.
echo  Proxy:      http://localhost:3001
echo  Dashboard:  http://localhost:3002
echo.
echo  Close this window any time.
echo.
