# --- flags ---
#   -SkipBuild   : skip the local build gate (VPS Docker build still gates live)
#   -LocalBuild  : force the local build gate ON
#   -NoCache     : force a clean VPS image rebuild (use after dependency changes)
#   -Force       : push even during market hours (see the guard below)
#   -Rollback    : put the previous deploy's images back on the VPS (seconds, no
#                  rebuild, nothing committed). Works during market hours.
#   -Status      : show what is live on the VPS and what -Rollback would restore
#   -Note "..."  : the one-line note shown beside this version on owner -> Vela
#                  Health -> Activity. Optional: without it, deploy.sh has Claude
#                  write one from the diff (scripts/deploy-note.py).
#
# The VPS side of a deploy is deploy.sh (in the repo, pulled before it runs): it
# rebuilds only the services a commit touched, health-checks the result and puts
# the previous images back on its own if the new version does not come up.
param(
    [switch]$SkipBuild,
    [switch]$LocalBuild,
    [switch]$NoCache,
    [switch]$Force,
    [switch]$Rollback,
    [switch]$Status,
    [string]$Note = ""
)

# --- VPS deploy target ---
$vpsHost = "root@178.156.137.36"
$vpsKey  = "$env:USERPROFILE\.ssh\cbedge"
$sshOpts = @("-i", $vpsKey, "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10")

# --- rollback / status: no commit, no version bump, allowed any time ---
if ($Rollback -or $Status) {
    $sub = if ($Rollback) { "rollback" } else { "status" }
    & ssh @sshOpts $vpsHost "cd /opt/dashboard && bash deploy.sh $sub"
    exit $LASTEXITCODE
}

# --- market-hours guard (2026-10-09) ---
# A push that touches the trading server (server-v2/, cbedge-v3/, app/, ...)
# rebuilds and restarts the dashboard. deploy.sh now skips the restart when a
# push only touches owner/budget/recipe/daily/voltick/nginx files, but this guard
# cannot tell which kind you are about to push, so it blocks both. On
# 2026-10-09 one push at 09:01 ET restarted the server into the open and the
# site crawled for the next hour. So: no pushes 09:00-16:15 ET on weekdays
# unless you pass -Force on purpose (an outage fix you cannot wait on).
$etNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Eastern Standard Time')
$etMins = $etNow.Hour * 60 + $etNow.Minute
$etWeekday = ($etNow.DayOfWeek -ne [DayOfWeek]::Saturday) -and ($etNow.DayOfWeek -ne [DayOfWeek]::Sunday)
if ($etWeekday -and $etMins -ge 540 -and $etMins -lt 975 -and -not $Force) {
    Write-Host ("MARKET HOURS ({0:HH:mm} ET) - push blocked. Pushes rebuild and restart the live server." -f $etNow) -ForegroundColor Red
    Write-Host "Push after 16:15 ET, or re-run with -Force if this is an outage fix that cannot wait." -ForegroundColor Yellow
    exit 1
}

$repoRoot = "C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed"
$packageJsonPath = "$repoRoot\package.json"
$composeFiles = "-f docker-compose.yml"

$ErrorActionPreference = "Stop"
$now = Get-Date
Set-Location $repoRoot
git checkout main

# Auto-version vMonth.Day.N - Nth deploy of the day
$prefix = "v$($now.Month).$($now.Day)."
$deploysToday = (git log --since="$($now.ToString('yyyy-MM-dd')) 00:00:00" --grep="^$([regex]::Escape($prefix))" --oneline | Measure-Object -Line).Lines
$version = "$prefix$($deploysToday + 1)"

$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$packageJson.version = $version
($packageJson | ConvertTo-Json -Depth 100) | Set-Content $packageJsonPath
Write-Host "Version: $version" -ForegroundColor Cyan

# --- 0. Fail fast on SSH before doing any work ---
& ssh @sshOpts $vpsHost "echo ok" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "SSH to VPS failed (key not loaded / host unreachable). Nothing pushed." -ForegroundColor Red
    Write-Host "Check: ssh-add $vpsKey   and that $vpsHost is up." -ForegroundColor Yellow
    exit 1
}

Write-Host "Lock check skipped (Docker uses npm install, platform-safe)." -ForegroundColor DarkGray

# --- 1. Refresh the owner Hub brain maps (CB Brain + Voltick Brain) ---
# Rescans cbedge-v3 / server-v2 / owner-vite and ..\Voltick, rewrites
# owner-vite/src/lib/brainMap.json + voltickMap.json so they ride this commit.
# Never blocks a deploy: on failure the old snapshot just stays.
Write-Host "Refreshing brain maps..." -ForegroundColor Yellow
try {
    node "$repoRoot\owner-vite\scripts\gen-brain-map.mjs"
    if ($LASTEXITCODE -ne 0) { Write-Host "Brain map refresh failed - keeping previous snapshot." -ForegroundColor DarkYellow }
} catch {
    Write-Host "Brain map refresh skipped ($($_.Exception.Message)) - keeping previous snapshot." -ForegroundColor DarkYellow
}

# --- 2. Local build gate (OPTIONAL) ---
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
# A typed note rides in the commit body; deploy.sh reads it before falling back
# to the generated one. Tabs and newlines are flattened (the history is one line).
$noteLine = ($Note -replace "[\t\r\n]+", " ").Trim()
if ($noteLine) { git commit -m "$version" -m "$noteLine" } else { git commit -m "$version" }
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
# Pull first, so the deploy.sh that runs is the one in THIS commit. deploy.sh
# exports the NEXT_PUBLIC_* build args from .env.local itself, works out which
# services this push touched, builds only those, and health-checks the result.
# --seed is only used the very first time (before deploy.sh has a record of a
# good deploy); after that it diffs from the last deploy that passed.
$deployFlags = if ($NoCache) { "--no-cache" } else { "" }
$LF = [char]10
$deployLines = @(
    "set -e",
    "cd /opt/dashboard",
    'BEFORE=$(git rev-parse HEAD)',
    "git pull --ff-only",
    "bash deploy.sh --seed `$BEFORE $deployFlags"
)
$deployScript = ($deployLines -join $LF) + $LF
$deployScript = $deployScript -replace "[\r]", ""

$encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($deployScript))
& ssh @sshOpts $vpsHost "echo $encoded | base64 -d | bash -s"
if ($LASTEXITCODE -ne 0) {
    Write-Host "VPS deploy FAILED - the message above says which way:" -ForegroundColor Red
    Write-Host "  'build failed'          -> nothing was restarted; the old version is still live." -ForegroundColor Yellow
    Write-Host "  'was rolled back'       -> the new version did not come up; the old one is back." -ForegroundColor Yellow
    Write-Host "  anything else           -> run .\push.ps1 -Status, and .\push.ps1 -Rollback if the site is down." -ForegroundColor Yellow
    Write-Host "Code is on GitHub either way. Fix and push again; the next deploy picks up everything since the last good one." -ForegroundColor DarkGray
    exit 1
}

Write-Host "Done! $version is live.  (undo: .\push.ps1 -Rollback)" -ForegroundColor Green
Write-Host "Watch logs with:" -ForegroundColor DarkGray
Write-Host "  ssh -i $vpsKey $vpsHost 'cd /opt/dashboard; docker compose $composeFiles logs -f'" -ForegroundColor DarkGray
