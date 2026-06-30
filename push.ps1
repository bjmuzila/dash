# --- flags ---
#   -SkipBuild   : skip the local build gate (VPS Docker build still gates live)
#   -LocalBuild  : force the local build gate ON
#   -NoCache     : force a clean VPS image rebuild (use after dependency changes)
param(
    [switch]$SkipBuild,
    [switch]$LocalBuild,
    [switch]$NoCache
)

$repoRoot = "C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed"
$packageJsonPath = "$repoRoot\package.json"

# --- VPS deploy target ---
$vpsHost = "root@178.156.137.36"
$vpsKey  = "$env:USERPROFILE\.ssh\cbedge"
$composeFiles = "-f docker-compose.yml -f deploy/theta/compose.theta.yml"

$ErrorActionPreference = "Stop"
$now = Get-Date
Set-Location $repoRoot
git checkout main

# Auto-version vMonth.Day.N — Nth deploy of the day
$prefix = "v$($now.Month).$($now.Day)."
$deploysToday = (git log --since="$($now.ToString('yyyy-MM-dd')) 00:00:00" --grep="^$([regex]::Escape($prefix))" --oneline | Measure-Object -Line).Lines
$version = "$prefix$($deploysToday + 1)"

$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$packageJson.version = $version
($packageJson | ConvertTo-Json -Depth 100) | Set-Content $packageJsonPath
Write-Host "Version: $version" -ForegroundColor Cyan

# --- 0. Fail fast on SSH before doing any work (no hanging password prompts) ---
$sshOpts = @("-i", $vpsKey, "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10")
& ssh @sshOpts $vpsHost "echo ok" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "SSH to VPS failed (key not loaded / host unreachable). Nothing pushed." -ForegroundColor Red
    Write-Host "Check: ssh-add $vpsKey   and that $vpsHost is up." -ForegroundColor Yellow
    exit 1
}

# --- 1. Keep package-lock.json in sync deterministically, only when package files changed ---
# Always reconcile the lock — transitive drift (e.g. picomatch 2.3.2 -> 4.0.4) happens
# with NO change to package.json, so a "did package.json change?" gate misses it and the
# VPS `npm ci` then fails. `--package-lock-only` is cheap (no node_modules install).
Write-Host "Reconciling package-lock.json (npm install --package-lock-only)..." -ForegroundColor Yellow
npm install --package-lock-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "lock reconcile FAILED - nothing committed or pushed." -ForegroundColor Red
    exit 1
}

# Verify the lock is exactly what Docker's `npm ci` will demand — fail HERE, not on the VPS.
npm ci --dry-run 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Lock still out of sync (npm ci would fail in Docker). Doing a full lock regen..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force "$repoRoot\node_modules" -ErrorAction SilentlyContinue
    Remove-Item -Force "$repoRoot\package-lock.json" -ErrorAction SilentlyContinue
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Host "Full lock regen FAILED - nothing pushed. Fix deps manually." -ForegroundColor Red; exit 1 }
    npm ci --dry-run 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host "Lock STILL broken after regen - nothing pushed. Inspect package.json." -ForegroundColor Red; exit 1 }
    Write-Host "Lock regenerated and verified." -ForegroundColor Green
}

# --- 2. Local build gate (OPTIONAL) ---
# The VPS Docker build is the authoritative gate for "live". Skip the local build by
# default to avoid building twice; turn it on with -LocalBuild for a fast pre-flight.
$doLocalBuild = $LocalBuild -and -not $SkipBuild
if ($doLocalBuild) {
    Write-Host "Local build gate (npm run build)..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "LOCAL BUILD FAILED - nothing committed or pushed. Fix above, then re-run." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Skipping local build (VPS Docker build will gate). Use -LocalBuild to enable." -ForegroundColor DarkGray
}

# --- 3. Commit + push main ---
git add -A
git commit -m "$version"
if ($LASTEXITCODE -ne 0) { Write-Host "Nothing to commit (or commit failed) - stopping." -ForegroundColor Red; exit 1 }
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "git push main FAILED - stopping." -ForegroundColor Red; exit 1 }

# --- 4. Promote main -> prod ---
git checkout prod
git merge main --no-edit
git push origin prod
if ($LASTEXITCODE -ne 0) { Write-Host "git push prod FAILED - stopping." -ForegroundColor Red; git checkout main; exit 1 }
git checkout main

Write-Host "Pushed $version to GitHub (main + prod). Deploying on VPS..." -ForegroundColor Cyan

# --- 5. VPS deploy over SSH ---
# LF-only here-string piped to remote `bash -s` (no argv quoting -> no CR bug).
# Docker layer cache makes the build incremental; --no-cache only when -NoCache passed.
$buildFlags = if ($NoCache) { "--no-cache" } else { "" }
$deployScript = @"
set -e
cd /opt/dashboard
git pull
docker compose $composeFiles build $buildFlags
docker compose $composeFiles up -d
docker compose $composeFiles ps
"@
$deployScript = $deployScript -replace "`r`n", "`n"

$deployScript | & ssh @sshOpts $vpsHost "bash -s"
if ($LASTEXITCODE -ne 0) {
    Write-Host "VPS deploy FAILED. Code is on GitHub - SSH in and rerun, or rollback: git reset --hard HEAD~1" -ForegroundColor Red
    exit 1
}

Write-Host "Done! $version is live. Logs: ssh $vpsHost 'cd /opt/dashboard; docker compose $composeFiles logs -f'" -ForegroundColor Green
