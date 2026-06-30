$repoRoot = "C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed"
$packageJsonPath = "$repoRoot\package.json"

# --- VPS deploy target ---
$vpsHost = "root@178.156.137.36"
$vpsKey  = "$env:USERPROFILE\.ssh\cbedge"
$composeFiles = "-f docker-compose.yml -f deploy/theta/compose.theta.yml"

$now = Get-Date
cd $repoRoot
git checkout main

# Auto-version vMonth.Day.N — Nth deploy of the day
$prefix = "v$($now.Month).$($now.Day)."
$deploysToday = (git log --since="$($now.ToString('yyyy-MM-dd')) 00:00:00" --grep="^$([regex]::Escape($prefix))" --oneline | Measure-Object -Line).Lines
$version = "$prefix$($deploysToday + 1)"

$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$packageJson.version = $version
($packageJson | ConvertTo-Json -Depth 100) | Set-Content $packageJsonPath
Write-Host "Version: $version" -ForegroundColor Cyan

# Keep package-lock.json synced so VPS `npm ci` never drifts (picomatch etc.)
Write-Host "Syncing package-lock.json (npm install)..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "npm install FAILED - nothing committed or pushed." -ForegroundColor Red
    exit 1
}

# Gate: build must pass before anything is committed or pushed.
Write-Host "Running build gate (npm run build)..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "BUILD FAILED - nothing committed or pushed. Fix the error above, then re-run." -ForegroundColor Red
    exit 1
}

# Stage everything, commit, push main
git add -A
git commit -m "$version"
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "git push main FAILED - stopping." -ForegroundColor Red; exit 1 }

# Promote main -> prod
git checkout prod
git merge main
git push origin prod
if ($LASTEXITCODE -ne 0) { Write-Host "git push prod FAILED - stopping." -ForegroundColor Red; git checkout main; exit 1 }
git checkout main

Write-Host "Pushed $version to GitHub (main + prod). Deploying on VPS..." -ForegroundColor Cyan

# --- VPS deploy over SSH (key auth, no password) ---
# Quoting deploy commands as a single ssh argument is fragile on Windows:
# PowerShell strings carry CRLF and quoting can reintroduce \r, breaking the
# remote shell (e.g. "unknown docker command: \"compose ps\r\"").
# Fix: build the command list as a LF-only here-string and pipe it to the
# remote `bash -s` over stdin — no argv quoting involved, so no CR can sneak in.
$deployScript = @"
set -e
cd /opt/dashboard
git pull
docker compose $composeFiles build
docker compose $composeFiles up -d
docker compose $composeFiles ps
"@
$deployScript = $deployScript -replace "`r`n", "`n"

$deployScript | ssh -i $vpsKey -o StrictHostKeyChecking=accept-new $vpsHost "bash -s"
if ($LASTEXITCODE -ne 0) {
    Write-Host "VPS deploy FAILED. Code is on GitHub - SSH in and rerun, or rollback with: git reset --hard HEAD~1" -ForegroundColor Red
    exit 1
}

Write-Host "Done! $version is live. Watch logs: ssh $vpsHost 'cd /opt/dashboard; docker compose $composeFiles logs -f'" -ForegroundColor Green
