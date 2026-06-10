@echo off
title SPX GEX Dashboard
echo.
echo  Starting SPX GEX Dashboard...
echo.

:: Kill any existing instances on port 3001
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 2^>nul') do taskkill /PID %%a /F >nul 2>&1

:: Start proxy (serves static files + APIs on single port)
start "SPX GEX Proxy" cmd /k "cd /d %~dp0 && node proxy-tastytrade.js"

:: Wait for proxy to fully start
echo  Waiting for proxy to start...
timeout /t 3 /nobreak >nul

:: Open browser
echo  Opening dashboard...
start http://localhost:3001

echo.
echo  Dashboard running at http://localhost:3001
echo.
echo  Proxy window is open and running.
echo  Close THIS window any time - proxy keeps running.
echo  To stop everything, close the Proxy window.
echo.
