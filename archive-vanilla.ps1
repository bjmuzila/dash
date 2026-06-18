# Move Vanilla folder and old proxy files to _ARCHIVED_DO_NOT_EDIT
# This folder is excluded from AI context and should not be read or modified

$root = "C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed"
$archiveDir = "$root\_ARCHIVED_DO_NOT_EDIT"

# Create archive folder
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null

# Move Vanilla folder
Move-Item -Path "$root\Vanilla" -Destination "$archiveDir\Vanilla" -Force

# Move any proxy files in root (proxy*.js, proxy*.log, etc.)
Get-ChildItem -Path $root -Filter "proxy*" -File | ForEach-Object {
    Move-Item -Path $_.FullName -Destination "$archiveDir\$($_.Name)" -Force
}

# Move old proxy-related files in root
$oldProxyFiles = @("proxy-tastytrade.js","proxy.js","proxy-websocket-relay.js","serve.js")
foreach ($f in $oldProxyFiles) {
    $src = "$root\$f"
    if (Test-Path $src) {
        Move-Item -Path $src -Destination "$archiveDir\$f" -Force
    }
}

# Write a README so anyone (human or AI) knows not to touch this folder
@"
# _ARCHIVED_DO_NOT_EDIT

This folder contains the original Vanilla JS dashboard and old proxy files.
They are archived for reference only.

- DO NOT modify any files here
- DO NOT include these files in AI context
- DO NOT run any proxy files from here

The Vanilla JS pages are being replaced entirely.
The proxy is being rebuilt from scratch.
"@ | Set-Content -Path "$archiveDir\README.md"

Write-Host "Done. Archived to: $archiveDir"
