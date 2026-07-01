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
$sshOpts = @("-i", $vpsKey, "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10")
& ssh @sshOpts $vpsHost "echo ok" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "SSH to VPS failed (key not loaded / host unreachable). Nothing pushed." -ForegroundColor Red
    Write-Host "Check: ssh-add $vpsKey   and that $vpsHost is up." -ForegroundColor Yellow
    exit 1
}

Write-Host "Lock check skipped (Docker uses npm install, platform-safe)." -ForegroundColor DarkGray

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
# Reads .env.local on the VPS and passes Supabase keys as Docker build args
# so Next.js can bake them into the client bundle at build time.
$buildFlags = if ($NoCache) { "--no-cache" } else { "" }
$LF = [char]10
$deployLines = @(
    "set -e",
    "cd /opt/dashboard",
    "git pull",
    "export \$(grep -v '^#' .env.local | xargs)",
    "docker compose $composeFiles build $buildFlags ``",
    "  --build-arg NEXT_PUBLIC_SUPABASE_URL=\$NEXT_PUBLIC_SUPABASE_URL ``",
    "  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=\$NEXT_PUBLIC_SUPABASE_ANON_KEY ``",
    "  --build-arg NEXT_PUBLIC_OWNER_USER_ID=\$NEXT_PUBLIC_OWNER_USER_ID",
    "docker compose $composeFiles up -d",
    "docker compose $composeFiles ps"
)
$deployScript = ($deployLines -join $LF) + $LF
$deployScript = $deployScript -replace "[\r]", ""

$deployScript | & ssh @sshOpts $vpsHost "bash -s"
if ($LASTEXITCODE -ne 0) {
    Write-Host "VPS deploy FAILED. Code is on GitHub - SSH in and rerun, or rollback: git reset --hard HEAD~1" -ForegroundColor Red
    exit 1
}

Write-Host "Done! $version is live." -ForegroundColor Green
Write-Host "Watch logs with:" -ForegroundColor DarkGray
Write-Host "  ssh -i $vpsKey $vpsHost 'cd /opt/dashboard; docker compose $composeFiles logs -f'" -ForegroundColor DarkGray
