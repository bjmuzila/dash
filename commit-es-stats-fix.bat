@echo off
cd /d "%~dp0"
git add components/dashboard/EsStatsLadder.tsx
git commit -m "Fix ES Stats Ladder: remove Google Sheets, pull from /api/es-stats SQLite, remove VAH/VPOC/VAL"
git push
pause
