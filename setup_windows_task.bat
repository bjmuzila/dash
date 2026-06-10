@echo off
REM Create Windows Task Scheduler job for Trump calendar scraper
REM Run as Administrator

setlocal enabledelayedexpansion

set SCRIPT_PATH=C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\scrape_trump_calendar.py
set TASK_NAME=TrumpCalendarScraper
set TASK_TIME=07:00:00

echo Creating Windows Task Scheduler job...
echo Task Name: %TASK_NAME%
echo Script: %SCRIPT_PATH%
echo Time: %TASK_TIME% ET daily
echo.

REM Create the task
schtasks /create /tn "%TASK_NAME%" /tr "python \"%SCRIPT_PATH%\"" /sc daily /st %TASK_TIME% /f

if %ERRORLEVEL% EQU 0 (
    echo.
    echo SUCCESS! Task created.
    echo.
    echo Verify it in Task Scheduler (taskschd.msc) or run:
    echo   schtasks /query /tn "%TASK_NAME%"
    echo.
    echo To delete later: schtasks /delete /tn "%TASK_NAME%" /f
) else (
    echo.
    echo FAILED! Make sure you run this as Administrator.
    echo.
    echo To run as Administrator:
    echo   1. Right-click Command Prompt
    echo   2. Select "Run as administrator"
    echo   3. Run this .bat file again
)

pause
