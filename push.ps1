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

Write-Host "Updated package.json"

cd $repoRoot

# Gate: build must pass before anything is committed or pushed.
# Catches errors like "showHpay is not defined" locally (~50s) instead of
# discovering them on the VPS after a push + Docker rebuild.
Write-Host "Running build gate (npm run build)..."
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "BUILD FAILED - nothing committed or pushed. Fix the error above, then re-run /push." -ForegroundColor Red
    exit 1
}

# Stage EVERYTHING (-A), not just package.json. The old `git add package.json`
# silently left every code change uncommitted, so version bumps shipped without
# the actual edits (this is what froze app/budget/page.tsx on a broken version).
git add -A
git commit -m "Bump version to $version"
git push origin main

Write-Host "Done! Version $version pushed to GitHub."
