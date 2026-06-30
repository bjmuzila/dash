# dev.ps1 — start local dev with a Theta tunnel to the VPS.
# Opens an SSH tunnel forwarding Theta's REST (25503) + event stream (25520)
# from the VPS host loopback to your machine, then runs `npm run dev`.
#
# Prereq (one-time, on the VPS): publish Theta to host loopback so the tunnel
# can target 127.0.0.1 instead of the (changing) container IP:
#   cd /opt/dashboard
#   docker compose -f compose.yml -f deploy/theta/compose.theta.yml up -d --force-recreate theta-terminal
#
# Usage:  ./dev.ps1
# Stop:   Ctrl-C (kills npm; run again to restart). Close the tunnel window to drop the tunnel.

$VpsHost = "root@178.156.137.36"

Write-Host "Opening Theta tunnel (25503 REST + 25520 stream) -> $VpsHost ..." -ForegroundColor Cyan
$tunnel = Start-Process ssh -ArgumentList @(
  "-N",
  "-L", "25503:127.0.0.1:25503",
  "-L", "25520:127.0.0.1:25520",
  $VpsHost
) -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 3

# Quick reachability check against Theta REST through the tunnel.
try {
  $code = (curl.exe -s -o NUL -w "%{http_code}" "http://127.0.0.1:25503/v3/option/list/expirations?symbol=SPXW")
  if ($code -eq "200") { Write-Host "Theta reachable through tunnel (HTTP 200)." -ForegroundColor Green }
  else { Write-Host "Theta not answering yet (HTTP $code). Check the tunnel/VPS Theta." -ForegroundColor Yellow }
} catch { Write-Host "Tunnel check failed: $_" -ForegroundColor Yellow }

Write-Host "Starting npm run dev..." -ForegroundColor Cyan
npm run dev

# When npm exits, tear down the tunnel.
if ($tunnel -and -not $tunnel.HasExited) {
  Write-Host "Stopping tunnel..." -ForegroundColor Cyan
  Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue
}
