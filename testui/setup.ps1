# testui — one-time setup (Windows PowerShell)
# Run from the testui folder:  .\setup.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "`n== 1/3  npm install ==" -ForegroundColor Cyan
npm install

Write-Host "`n== 2/3  pulling @bklit registry components ==" -ForegroundColor Cyan
node scripts/add-charts.mjs

Write-Host "`n== 3/3  done ==" -ForegroundColor Cyan
Write-Host "Start the gallery with:  npm run dev" -ForegroundColor Green
Write-Host "It serves on http://localhost:5199" -ForegroundColor Green
