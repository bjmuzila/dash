# Fetch Trump calendar from Roll Call
# Usage: .\fetch-trump-calendar.ps1

$url = "https://media-cdn.factba.se/rss/json/trump/calendar-full.json"
$outputPath = "$PSScriptRoot\data\trump_calendar_latest.json"
$dataDir = "$PSScriptRoot\data"

# Ensure data directory exists
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Host "✓ Created directory: $dataDir" -ForegroundColor Green
}

Write-Host "Fetching Trump calendar from factba.se..." -ForegroundColor Cyan
Write-Host "URL: $url"

try {
    $response = Invoke-WebRequest -Uri $url -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" -ErrorAction Stop
    $json = $response.Content

    # Parse JSON directly
    $rawData = $json | ConvertFrom-Json

    # API returns an array directly, wrap it
    if ($rawData -is [array]) {
        $calendarData = @{
            events = @($rawData)
            count = @($rawData).Count
            fetched = (Get-Date -AsUTC).ToString('o')
            source = $url
        }
    } else {
        # If it's already an object, use it
        $calendarData = $rawData
        if (-not $calendarData.fetched) {
            $calendarData | Add-Member -NotePropertyName "fetched" -NotePropertyValue (Get-Date -AsUTC).ToString('o') -Force
        }
        if (-not $calendarData.source) {
            $calendarData | Add-Member -NotePropertyName "source" -NotePropertyValue $url -Force
        }
        if (-not $calendarData.count -and $calendarData.events) {
            $calendarData | Add-Member -NotePropertyName "count" -NotePropertyValue @($calendarData.events).Count -Force
        }
    }

    # Save to JSON file
    $calendarData | ConvertTo-Json -Depth 10 | Out-File -FilePath $outputPath -Encoding UTF8

    Write-Host "✓ Calendar saved: $outputPath" -ForegroundColor Green
    Write-Host "✓ Events loaded: $($calendarData.count)" -ForegroundColor Green
    Write-Host "✓ Fetched: $($calendarData.fetched)" -ForegroundColor Green

} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Make sure you have internet connection and can access Roll Call." -ForegroundColor Red
    exit 1
}
