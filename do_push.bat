@echo off
cd /d "C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed"
git add -A
git commit -m "Bump version to 2026.6.14-v16: fix quotes page, remove GEX Ladder + Top 10, add econ calendar impact filter, fix options chain WS + Greeks, fix multi-greek expirations"
git push origin main
pause
