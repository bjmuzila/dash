@echo off
title SPX GEX Dashboard Launcher
cd /d "%~dp0"

echo Starting SPX GEX Dashboard...
echo Dashboard: http://localhost:8080/
echo Proxy API:  http://localhost:3001/proxy/api/status
echo Excel Save: http://localhost:3002/export-mvc
echo.

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001"') do (
  for /f "tokens=1" %%b in ('tasklist /FI "PID eq %%a" /FI "IMAGENAME eq node.exe" /NH 2^>nul') do taskkill /PID %%a /F >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3002"') do (
  for /f "tokens=1" %%b in ('tasklist /FI "PID eq %%a" /FI "IMAGENAME eq node.exe" /NH 2^>nul') do taskkill /PID %%a /F >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080"') do (
  for /f "tokens=1" %%b in ('tasklist /FI "PID eq %%a" /FI "IMAGENAME eq node.exe" /NH 2^>nul') do taskkill /PID %%a /F >nul 2>nul
)

taskkill /F /FI "WINDOWTITLE eq Dashboard :8080*" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq TT Proxy :3001*" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq MVC Export :3002*" >nul 2>nul

timeout /t 2 /nobreak >nul

start /min "TT Proxy :3001" node proxy-tastytrade.js
start /min "MVC Export :3002" node proxy.js
start "Dashboard :8080" cmd /k "cd /d ""%~dp0"" && node dashboard-server.js"

timeout /t 5 /nobreak >nul
start "" "http://localhost:8080/"

echo Started. Use http://localhost:8080/ for the dashboard.
