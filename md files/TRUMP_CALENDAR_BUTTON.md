# Trump Calendar Refresh Button

## What Was Added

A **REFRESH** button in the Economic Calendar header that fetches the latest Trump calendar data with a single click.

## How It Works

### On the Dashboard
1. Look for the Economic Calendar section at the bottom left
2. Click the **REFRESH** button next to "Economic Calendar"
3. Button shows status:
   - **REFRESH** → Ready to click
   - **↻ Fetching...** → Loading data
   - **✓ Updated** → Success (green)
   - **✗ Error** → Failed (red)

### Behind the Scenes
1. Button click triggers `refreshTrumpCalendar()`
2. Calls `http://localhost:3001/proxy/api/trump-calendar-refresh`
3. Proxy fetches from `https://media-cdn.factba.se/rss/json/trump/calendar-full.json`
4. Saves to `data/trump_calendar_latest.json`
5. Reloads calendar in the UI immediately
6. Button shows success/error status

## Files Modified

### 1. `pages/overview/overview.html`
- Added REFRESH button to Economic Calendar header
- Styled to match other buttons (cyan color, subtle background)

### 2. `pages/overview/overview.js`
- Added `refreshTrumpCalendar()` function
- Handles button visual feedback
- Fetches from proxy endpoint
- Reloads calendar data on success

### 3. `proxy-tastytrade.js`
- Added POST `/proxy/api/trump-calendar-refresh` endpoint
- Fetches from factba.se API
- Saves to local JSON file
- Returns status/count to dashboard

## Usage

### Simple Click
Just click the **REFRESH** button on the Economic Calendar. That's it!

### Manual Terminal Command (if needed)
```bash
node fetch-trump-calendar.js
```

### Automatic Updates
- Calendar auto-refreshes on page load
- Calendar auto-refreshes every 30 minutes
- Manual refresh available via button anytime

## Status Indicators

The button provides visual feedback:

```
Click →  ↻ Fetching...  →  ✓ Updated  →  REFRESH (ready again)
                              (green)
         
Or on error:

Click →  ↻ Fetching...  →  ✗ Error  →  REFRESH (ready to retry)
                              (red)
```

## No Additional Scripts Needed

Everything works through the dashboard now. No need to:
- Open terminal
- Run PowerShell scripts
- Click batch files

Just **click the button** and the calendar updates!

## Technical Details

- **Endpoint**: `POST /proxy/api/trump-calendar-refresh`
- **Data Source**: `https://media-cdn.factba.se/rss/json/trump/calendar-full.json`
- **Local Storage**: `data/trump_calendar_latest.json`
- **Timeout**: 5 seconds per fetch
- **Auto-reload**: Yes, renders immediately on success
