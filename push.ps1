$repoRoot = "C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed"
$packageJsonPath = "$repoRoot\package.json"

$now = Get-Date
$month = $now.Month
$day = $now.Day
$hour = $now.Hour
$version = "2026.$month.$day-v$hour"

Write-Host "?? Generated version: $version"

$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$packageJson.version = $version
$packageJson | ConvertTo-Json | Set-Content $packageJsonPath

Write-Host "? Updated package.json"

cd $repoRoot
git add package.json
git commit -m "Bump version to $version"
git push origin main

Write-Host "?? Done! Version $version pushed to GitHub."
