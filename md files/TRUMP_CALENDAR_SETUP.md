# Trump Calendar Economic Events Setup

## Overview
Automated daily scraper that fetches Trump calendar events from factba.se, filters out travel/pool/weekend events, and displays them in the overview economic calendar.

**Runs at:** 7:00 AM ET daily (via Windows Task Scheduler)
**Source:** https://media-cdn.factba.se/rss/json/trump/calendar-full.json
**Output:** `C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\data\trump_calendar_latest.json`

---

## Components

### 1. Python Scraper Script
**File:** `C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\scrape_trump_calendar.py`

**What it does:**
- Fetches raw Trump calendar JSON from factba.se
- Filters events to exclude: travel, pool, in town, departure, arrival
- Keeps all other events (official schedule, briefings, remarks, etc.)
- Saves filtered output to `data/trump_calendar_latest.json`

**Key functions:**
- `fetch_calendar()` - Fetches JSON from API using built-in urllib (no requests module needed)
- `is_weekend()` - Checks if date is Saturday/Sunday
- `should_include()` - Applies filter logic
- `format_output()` - Structures data for overview consumption

**Field mapping (JSON → Output):**
- Input fields: `date`, `time`, `type`, `details`, `daily_text`
- Output fields: Same as input (no transformation)

### 2. Windows Task Scheduler Job
**Job Name:** `TrumpCalendarScraper`
**Schedule:** Daily at 07:00:00 (7:00 AM local time)
**Run As:** SYSTEM (no password prompt)
**Command:**
```
C:\Users\Brandon\AppData\Local\Programs\Python\Python313\python.exe C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\scrape_trump_calendar.py
```

### 3. Overview JavaScript Integration
**File:** `C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\pages\overview\overview.js`

**What it does:**
- Loads `trump_calendar_latest.json` on page load
- Converts Trump calendar format to ECON_EVENTS format
- Merges events into ECON_EVENTS array
- Re-renders calendar to display events
- Auto-reloads every 30 minutes

**Key function:** `loadTrumpCalendarEvents()`
- Fetches JSON from `../data/trump_calendar_latest.json`
- Converts format: `{ date, time, details/type/daily_text } → { date, time, name, period, noTime }`
- Merges into `ECON_EVENTS` array
- Calls `renderEconCalendar()` to display

---

## Troubleshooting

### Issue: Task not running at 7am
**Check:**
1. Verify task exists: `schtasks /query /tn "TrumpCalendarScraper"`
2. Check status shows "Ready"
3. Verify Cowork/app doesn't need to be running (uses Windows Task Scheduler, not Cowork)

**Fix:**
- Recreate task if missing (see Installation)
- Ensure PC is powered on at 7am ET

### Issue: No JSON file created
**Check:**
1. Python path is correct: `C:\Users\Brandon\AppData\Local\Programs\Python\Python313\python.exe`
2. Script runs manually without errors:
   ```
   C:\Users\Brandon\AppData\Local\Programs\Python\Python313\python.exe C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\scrape_trump_calendar.py
   ```

**Fix:**
- If Python path changed, update task: 
  ```
  schtasks /change /tn "TrumpCalendarScraper" /tr "C:\path\to\python.exe C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\scrape_trump_calendar.py"
  ```
- Check `data/` directory exists: `mkdir C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\data`

### Issue: Events not showing in overview calendar
**Check:**
1. JSON file was created: `dir C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\data\trump_calendar_latest.json`
2. File is valid JSON: Open in text editor, should start with `{` and contain `"events": [`
3. Browser console for errors: F12 → Console tab

**Fix:**
- Hard refresh page: `Ctrl+Shift+R`
- Check if `loadTrumpCalendarEvents()` function exists in overview.js (line ~4)
- Manually trigger load in browser console:
  ```javascript
  loadTrumpCalendarEvents();
  ```

### Issue: Events disappear after appearing
**Root cause:** `renderEconCalendar()` runs every 10 seconds and overwrites without Trump events

**Fix:**
- Ensure overview.js has the merged version (checks for `TRUMP_CALENDAR_EVENTS` variable)
- Line should read: `ECON_EVENTS.push(...TRUMP_CALENDAR_EVENTS);`
- If missing, re-apply overview.js changes from Installation section

---

## Installation / Reset

### Step 1: Create/Verify Python Script
File: `C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\scrape_trump_calendar.py`

Requirements:
- Python 3.11+ installed
- urllib (built-in, no pip install needed)
- json, re, datetime, pathlib (all built-in)

To verify Python version:
```
C:\Users\Brandon\AppData\Local\Programs\Python\Python313\python.exe --version
```

### Step 2: Create Windows Task
Open **Command Prompt as Administrator** and run:
```
schtasks /create /tn "TrumpCalendarScraper" /tr "C:\Users\Brandon\AppData\Local\Programs\Python\Python313\python.exe C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\scrape_trump_calendar.py" /sc daily /st 07:00:00 /ru "SYSTEM" /rl HIGHEST /f
```

Verify creation:
```
schtasks /query /tn "TrumpCalendarScraper" /v
```

### Step 3: Update Overview JavaScript
File: `C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\pages\overview\overview.js`

Add at the top (after line 1):
```javascript
// ═══════════════════════════════════════════════════════════════════════
// LOAD TRUMP CALENDAR EVENTS AUTOMATICALLY
// ═══════════════════════════════════════════════════════════════════════
let TRUMP_CALENDAR_EVENTS = [];

async function loadTrumpCalendarEvents() {
  try {
    const response = await fetch('../data/trump_calendar_latest.json');
    if (!response.ok) return;
    const data = await response.json();
    if (!data.events) return;

    // Convert Trump calendar format to ECON_EVENTS format
    TRUMP_CALENDAR_EVENTS = data.events.map(evt => ({
      date: evt.date || '',
      time: evt.time || '00:00',
      name: evt.details || evt.type || evt.daily_text || 'Event',
      period: '',
      noTime: !evt.time
    }));

    // Merge into ECON_EVENTS if it exists
    if (typeof ECON_EVENTS !== 'undefined') {
      ECON_EVENTS.push(...TRUMP_CALENDAR_EVENTS);
      // Re-render the calendar immediately
      if (typeof renderEconCalendar === 'function') {
        renderEconCalendar();
      }
    }
  } catch (e) {
    console.warn('[Trump Calendar] Load error:', e);
  }
}

// Load on page init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(loadTrumpCalendarEvents, 500); // Wait for ECON_EVENTS to load
  });
} else {
  setTimeout(loadTrumpCalendarEvents, 500);
}

// Reload every 30 minutes
setInterval(loadTrumpCalendarEvents, 30 * 60 * 1000);
```

### Step 4: Test
Manual test (Command Prompt):
```
C:\Users\Brandon\AppData\Local\Programs\Python\Python313\python.exe C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\scrape_trump_calendar.py
```

Expected output:
```
[timestamp] Fetching Trump calendar...
Fetched XXXX total events
Filtered to XXXX events (excluded travel/pool/weekend)
Saved to: C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\data\trump_calendar_20260609.json

=== FILTERED EVENTS ===
2026-06-09 - [event name]
...
```

Verify file exists:
```
dir C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\data\trump_calendar_latest.json
```

Open overview in browser, hard refresh (`Ctrl+Shift+R`), check Economic Calendar section shows Trump events.

---

## Maintenance

### Change Run Time
```
schtasks /change /tn "TrumpCalendarScraper" /st HH:MM:SS
```
Example (change to 8:00 AM):
```
schtasks /change /tn "TrumpCalendarScraper" /st 08:00:00
```

### Disable/Enable Task
Disable:
```
schtasks /change /tn "TrumpCalendarScraper" /disable
```

Enable:
```
schtasks /change /tn "TrumpCalendarScraper" /enable
```

### Delete Task
```
schtasks /delete /tn "TrumpCalendarScraper" /f
```

### Update Filter Keywords
Edit `scrape_trump_calendar.py`, modify `EXCLUDE_KEYWORDS` list:
```python
EXCLUDE_KEYWORDS = [
    'travel',
    'pool',
    'in town',
    'departure',
    'arrival',
    # Add more here
]
```

---

## Files Reference

| File | Purpose | Edit? |
|------|---------|-------|
| `scrape_trump_calendar.py` | Fetches & filters calendar | Yes (filter logic) |
| `pages/overview/overview.js` | Loads & displays events | Yes (format/display) |
| `data/trump_calendar_latest.json` | Output data (auto-generated) | No |
| Task Scheduler Job | Runs script daily | Yes (via schtasks command) |

---

## API & Data

**Source URL:** `https://media-cdn.factba.se/rss/json/trump/calendar-full.json`

**Input JSON structure:**
```json
[
  {
    "date": "2026-06-09",
    "time": "07:00",
    "type": "Official Schedule",
    "details": "Press Briefing",
    "daily_text": "Full description here",
    "location": "...",
    "coverage": "...",
    ...
  }
]
```

**Output JSON structure:**
```json
{
  "fetched": "2026-06-09T07:03:00.000Z",
  "count": 1439,
  "events": [
    {
      "date": "2026-06-09",
      "time": "07:00",
      "type": "Official Schedule",
      "details": "Press Briefing",
      "daily_text": "Full description here",
      ...
    }
  ]
}
```

---

## Quick Commands Cheat Sheet

```bash
# Check Python version
C:\Users\Brandon\AppData\Local\Programs\Python\Python313\python.exe --version

# Run scraper manually
C:\Users\Brandon\AppData\Local\Programs\Python\Python313\python.exe C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\scrape_trump_calendar.py

# Check task status
schtasks /query /tn "TrumpCalendarScraper" /v

# View task history (last run)
schtasks /query /tn "TrumpCalendarScraper" /fo list /v

# Change run time
schtasks /change /tn "TrumpCalendarScraper" /st 07:15:00

# Delete task
schtasks /delete /tn "TrumpCalendarScraper" /f

# Check JSON file
dir C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\data\trump_calendar_latest.json

# View JSON content (first 100 chars)
powershell -Command "Get-Content C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\data\trump_calendar_latest.json | Select-Object -First 100"
```

---

**Last Updated:** 2026-06-09  
**Setup Version:** 1.0
