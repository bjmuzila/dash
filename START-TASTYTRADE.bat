@echo off
title SPX GEX Dashboard — TastyTrade
chcp 65001 >nul

echo.
echo  SPX GEX Dashboard — TastyTrade Edition
echo  ========================================
echo.

cd /d "%~dp0"

if not exist node_modules\ws (
    echo  Installing dependencies...
    npm install
    echo.
)

REM Kill any existing node processes on port 3001 and 8080
echo  Cleaning up existing processes...
taskkill /F /IM node.exe 2>nul

timeout /t 1 /nobreak >nul

echo  Starting proxy on port 3001...
start "TT Proxy :3001" node proxy-tastytrade.js

echo  Waiting for proxy to start...
timeout /t 3 /nobreak >nul

echo  Starting dashboard on port 8080...
start "Dashboard :8080" node serve.js

timeout /t 2 /nobreak >nul

echo  Opening browser...
start "" http://localhost:8080

echo.
echo  Both windows are open. Close them to stop the services.
