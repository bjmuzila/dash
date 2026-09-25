# One-time: installs the Voltick Brain auto-refresh hooks into your LOCAL
# Voltick clone (.git\hooks is never pushed, so Gnotz's repo is untouched).
# After this, every sync on bzilabranch (merge, pull, rebase) rebuilds
# admin-site\brain-data.js and commits just that file if it changed.
$src  = $PSScriptRoot
$dest = "C:\Users\Brandon\Desktop\Voltick\.git\hooks"
if (-not (Test-Path $dest)) { Write-Host "Voltick repo not found at $dest" -ForegroundColor Red; exit 1 }
foreach ($f in "brain-refresh.sh", "post-merge", "post-rewrite") {
    # keep LF endings - Git's sh chokes on CRLF
    $txt = [IO.File]::ReadAllText("$src\$f") -replace "`r`n", "`n"
    [IO.File]::WriteAllText("$dest\$f", $txt)
}
Write-Host "Installed brain hooks into $dest" -ForegroundColor Green
