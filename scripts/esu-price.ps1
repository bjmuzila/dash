# esu-price.ps1 — show ESU live price + prior-session settle from the running server-v2.
# Reads /proxy/snapshot (same esFut / esFutPrevClose the toolbar uses). Server must be up (npm run dev).
param([int]$Port = 3002)

try {
    $s = Invoke-RestMethod "http://localhost:$Port/proxy/snapshot" -TimeoutSec 5
} catch {
    Write-Host "Could not reach server on port $Port. Is 'npm run dev' running?" -ForegroundColor Red
    exit 1
}

$cur  = [double]$s.esFut
$prev = [double]$s.esFutPrevClose
$chg  = $cur - $prev
$pct  = if ($prev) { ($chg / $prev) * 100 } else { 0 }

Write-Host ""
Write-Host "ESU current price : $($cur.ToString('0.00'))"
Write-Host "ESU last-day close: $($prev.ToString('0.00'))"
$color = if ($chg -ge 0) { 'Green' } else { 'Red' }
Write-Host ("Change            : {0:+0.00;-0.00} ({1:+0.00;-0.00}%)" -f $chg, $pct) -ForegroundColor $color
Write-Host ""
