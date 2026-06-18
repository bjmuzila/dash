# scripts/prev-close.ps1
# One-off: prev close + current price for /ESU6, SPX, NVDA via Tastytrade REST.
# Reuses credentials from .env.local. Run:  powershell -File scripts/prev-close.ps1

$ErrorActionPreference = 'Stop'

# --- load env (avoid the reserved $env: drive name) ---
$cfg = @{}
Get-Content "$PSScriptRoot\..\.env.local" | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$') { $cfg[$Matches[1]] = $Matches[2] }
}
$cid = $cfg['TT_CLIENT_ID'].Trim()
$secret = $cfg['TT_CLIENT_SECRET'].Trim()
$rtoken = $cfg['TT_REFRESH_TOKEN'].Trim()
$base = if ($cfg['TT_BASE_URL']) { $cfg['TT_BASE_URL'].Trim() } else { 'https://api.tastytrade.com' }
$ua = 'spx-gex-dashboard/1.0'

# --- oauth (Basic auth header) ---
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${cid}:${secret}"))
$tok = (Invoke-RestMethod -Uri "$base/oauth/token" -Method Post `
  -Headers @{ Authorization = "Basic $basic"; 'User-Agent' = $ua } `
  -ContentType 'application/x-www-form-urlencoded' `
  -Body "grant_type=refresh_token&refresh_token=$rtoken").access_token
$H = @{ Authorization = "Bearer $tok"; 'User-Agent' = $ua; Accept = 'application/json' }

function Show($label, $item) {
  if (-not $item) { Write-Host ("{0,-8} : no data" -f $label); return }
  Write-Host ("{0,-8} : last={1}  prev-close={2}  ({3})" -f `
    $label, $item.last, $item.'prev-close', $item.'prev-close-date')
}

# --- SPX (index), NVDA (equity), /ESU6 (future) ---
$spx  = (Invoke-RestMethod -Uri "$base/market-data/by-type?index=SPX" -Headers $H).data.items[0]
$nvda = (Invoke-RestMethod -Uri "$base/market-data/by-type?equity=NVDA" -Headers $H).data.items[0]
$es   = (Invoke-RestMethod -Uri "$base/market-data/by-type?future=%2FESU6" -Headers $H).data.items[0]

Write-Host ""
Show "SPX"   $spx
Show "NVDA"  $nvda
Show "/ESU6" $es
Write-Host ""

# --- resolve the REAL dxLink streamer symbols (what to subscribe to) ---
Write-Host "--- dxLink streamer symbols (from instrument records) ---"
try {
  $f = (Invoke-RestMethod -Uri "$base/instruments/futures?symbol[]=%2FESU6" -Headers $H).data.items[0]
  Write-Host ("future  /ESU6 -> streamer-symbol = {0}" -f $f.'streamer-symbol')
} catch { Write-Host "future lookup failed: $($_.Exception.Message)" }

try {
  $eq = (Invoke-RestMethod -Uri "$base/instruments/equities/NVDA" -Headers $H).data
  Write-Host ("equity  NVDA  -> streamer-symbol = {0}" -f $eq.'streamer-symbol')
} catch { Write-Host "equity lookup failed: $($_.Exception.Message)" }
Write-Host ""
