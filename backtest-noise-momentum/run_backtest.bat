@echo off
cd /d "%~dp0"
echo Running backtest... > run_log.txt
node backtest.mjs >> run_log.txt 2>&1
echo. >> run_log.txt
echo EXIT CODE %ERRORLEVEL% >> run_log.txt
echo DONE
