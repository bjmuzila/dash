from init_db import init_database
from trading_db import TradingMetricsDB
from datetime import datetime

# Initialize database
init_database()

# Create database instance
db = TradingMetricsDB()

# Example: Insert single metric
timestamp = datetime.now().strftime('%H:%M:%S')
trading_date = datetime.now().strftime('%Y-%m-%d')

db.insert_metric(
    timestamp=timestamp,
    mvc=1250000.50,
    net_flow=45000.25,
    cvd=125000.75,
    trading_date=trading_date
)

print(f"Inserted metric at {timestamp}")

# Example: Insert batch of metrics
batch_records = [
    ('09:30:00', 1200000.0, 40000.0, 120000.0, trading_date),
    ('09:31:00', 1210000.0, 41000.0, 121000.0, trading_date),
    ('09:32:00', 1220000.0, 42000.0, 122000.0, trading_date),
]

rows_inserted = db.insert_batch(batch_records)
print(f"Inserted {rows_inserted} batch records")

# Example: Query today's metrics
today_metrics = db.get_day_metrics(trading_date)
print(f"\nToday's metrics ({len(today_metrics)} records):")
for timestamp, mvc, net_flow, cvd in today_metrics:
    print(f"  {timestamp}: MVC={mvc}, NetFlow={net_flow}, CVD={cvd}")

# Example: Get latest metrics
latest = db.get_latest_metrics(limit=5)
print(f"\nLatest 5 metrics:")
for timestamp, mvc, net_flow, cvd, date in latest:
    print(f"  {date} {timestamp}: MVC={mvc}, NetFlow={net_flow}, CVD={cvd}")
