# Complete Database Setup Instructions

## What This Does
Automatically saves MVC, Net Flow, and CVD from your dashboard to a local database every 5 seconds.

## Files You Need
1. `init_db.py` - Creates the database
2. `trading_db.py` - Database operations
3. `metrics_bridge.py` - Python server that receives data
4. `dashboard_db_sync.js` - JavaScript code for your dashboard

## Setup Steps

### 1. Install Flask (one-time)
```bash
pip install flask flask-cors
```

### 2. Initialize Database (one-time)
```bash
cd C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\trading_db_complete
python setup.py
```

### 3. Add JavaScript to Your Dashboard
Open your main dashboard HTML file and add this **at the bottom**, just before `</body>`:

```html
<script src="dashboard_db_sync.js"></script>
```

Or copy the entire contents of `dashboard_db_sync.js` into a `<script>` tag.

### 4. Start the Bridge Server
Open a new terminal/PowerShell and run:
```bash
cd C:\Users\Brandon\Desktop\spx-gex-dashboard-tt-fixed\trading_db_complete
python metrics_bridge.py
```

Keep this running while trading. You'll see:
```
Starting metrics bridge server on http://localhost:5001
```

### 5. Open Your Dashboard
Your dashboard will now auto-save metrics every 5 seconds.

Check the browser console (F12) - you should see:
```
✓ Metrics saved: 09:30:15
✓ Metrics saved: 09:30:20
```

## Query Your Data

Open Python and run:
```python
from trading_db import TradingMetricsDB
db = TradingMetricsDB()

# Get today's data
metrics = db.get_day_metrics('2026-05-21')
for timestamp, mvc, net_flow, cvd in metrics:
    print(f"{timestamp}: MVC={mvc}, NetFlow={net_flow}, CVD={cvd}")

# Get latest 100 records
latest = db.get_latest_metrics(100)
```

## Troubleshooting

**"Connection refused" in browser console:**
- Make sure `metrics_bridge.py` is running

**No data being saved:**
- Check browser console for errors (F12)
- Make sure MVC/CVD/NetFlow elements exist on page
- Check metrics_bridge.py terminal for errors

**"ModuleNotFoundError: flask":**
- Run: `pip install flask flask-cors`

## Manual Control

In browser console:
```javascript
// Stop auto-save
window.stopDatabaseSync()

// Start auto-save
window.startDatabaseSync()
```
