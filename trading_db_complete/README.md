# Trading Metrics Database

SQLite database system for storing intraday MVC, net flow, and CVD data.

## Files

- `init_db.py` - Initialize database schema
- `trading_db.py` - Core database operations class
- `example_usage.py` - Usage examples
- `trading_metrics.db` - SQLite database (created on first run)

## Quick Start

```python
from init_db import init_database
from trading_db import TradingMetricsDB

# Initialize (first time only)
init_database()

# Create instance
db = TradingMetricsDB()

# Insert single metric
db.insert_metric(
    timestamp='09:30:15',
    mvc=1250000.50,
    net_flow=45000.25,
    cvd=125000.75,
    trading_date='2026-05-21'
)

# Insert batch
records = [
    ('09:30:00', 1200000.0, 40000.0, 120000.0, '2026-05-21'),
    ('09:31:00', 1210000.0, 41000.0, 121000.0, '2026-05-21'),
]
db.insert_batch(records)

# Query today's data
metrics = db.get_day_metrics('2026-05-21')

# Get latest records
latest = db.get_latest_metrics(limit=100)

# Query time range
metrics = db.get_metrics_range('09:30:00', '16:00:00', '2026-05-21')
```

## Database Schema

Table: `trading_metrics`
- `id` - Auto-increment primary key
- `timestamp` - Time of day (HH:MM:SS)
- `mvc` - Market Value of Contracts
- `net_flow` - Net flow value
- `cvd` - Cumulative Volume Delta
- `trading_date` - Date (YYYY-MM-DD)
- `created_at` - Record creation timestamp

Indexes on `trading_date` and `timestamp` for fast queries.

## Features

- Automatic upsert (update on conflict)
- Batch insertion support
- Date-based queries
- Time range queries
- Latest N records retrieval
