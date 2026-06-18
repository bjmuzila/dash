@echo off
REM Update Trump calendar from Roll Call
REM This script fetches the latest Trump calendar and saves it locally

setlocal enabledelayedexpansion

echo.
echo  Updating Trump Calendar...
echo.

REM Try PowerShell first (more reliable on Windows)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fetch-trump-calendar.ps1"

if errorlevel 0 (
    echo.
    echo  ✓ Calendar updated successfully!
    echo.
) else (
    echo.
    echo  ✗ Update failed. Trying Node.js method...
    echo.
    node "%~dp0fetch-trump-calendar.js"
)

pause
