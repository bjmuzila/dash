# Net Premium Database Setup

## Quick Start

Net premium functionality is integrated into your existing `metrics_bridge.py`.

```bash
# 1. Install dependencies (if not already)
pip install Flask Flask-CORS

# 2. Run the bridge server
python metrics_bridge.py

# Server starts on http://localhost:5001
```

## API Endpoints

### Save Net Premium (Called every 30 seconds)

```
POST /api/metrics/net-premium

Request:
{
  "timestamp": "2026-06-10T14:30:00Z",
  "value": -363981,
  "spotPrice": 5500,
  "sessionTime": 870
}

Response:
{
  "status": "success",
  "id": 123,
  "timestamp": "2026-06-10T14:30:00Z",
  "value": -363981
}
```

### Get Net Premium History (Called on page load)

```
GET /api/metrics/net-premium/history?limit=800&date=2026-06-10

Response:
{
  "status": "success",
  "date": "2026-06-10",
  "count": 100,
  "data": [
    {
      "timestamp": "2026-06-10T09:30:00Z",
      "value": 1500000,
      "spotPrice": 5450,
      "sessionTime": 570
    },
    ...
  ]
}
```

### Get Statistics

```
GET /api/metrics/net-premium/stats?date=2026-06-10

Response:
{
  "status": "success",
  "date": "2026-06-10",
  "stats": {
    "min": -1200000,
    "max": 2100000,
    "avg": 450000,
    "count": 100
  }
}
```

## Database

**File:** `trading_metrics.db` (same SQLite file as trading metrics)

**Table:** `net_premium_metrics`

```sql
CREATE TABLE net_premium_metrics (
    id INTEGER PRIMARY KEY,
    trading_date TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    value REAL NOT NULL,
    spot_price REAL,
    session_time INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(trading_date, timestamp)
)
```

## Frontend Integration

**Automatic behavior:**
- Dashboard saves every 30 seconds → `/api/metrics/net-premium` (POST)
- Page load → `/api/metrics/net-premium/history` (GET) → Renders sparkline
- Hard refresh → Loads from DB → Shows full daily history

**Files:**
- `shared/app.js` - `trackNetPremium()`, `loadNetPremiumHistoryFromDB()`
- `pages/overview/overview.html` - Sparkline rendering + DB load

## Code Changes

**Added to `trading_db.py`:**
- `init_net_premium_table()` - Create table on startup
- `insert_net_premium()` - Save metric
- `get_net_premium_history()` - Get day's data
- `get_net_premium_stats()` - Get min/max/avg

**Added to `metrics_bridge.py`:**
- `POST /api/metrics/net-premium` - Save endpoint
- `GET /api/metrics/net-premium/history` - Load endpoint
- `GET /api/metrics/net-premium/stats` - Stats endpoint

## Testing

```bash
# Save a point
curl -X POST http://localhost:5001/api/metrics/net-premium \
  -H "Content-Type: application/json" \
  -d '{"timestamp":"2026-06-10T14:30:00Z","value":-363981,"spotPrice":5500,"sessionTime":870}'

# Get history
curl "http://localhost:5001/api/metrics/net-premium/history?limit=800"

# Get stats
curl "http://localhost:5001/api/metrics/net-premium/stats"
```

## That's it

No separate files, no extra setup. Restart `metrics_bridge.py` and you're live.
