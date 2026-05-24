import sqlite3
from datetime import datetime

def init_database(db_path='trading_metrics.db'):
    """Initialize the trading metrics database with required tables."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create table for intraday trading metrics
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS trading_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            mvc REAL,
            net_flow REAL,
            cvd REAL,
            trading_date TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(timestamp, trading_date)
        )
    ''')
    
    # Create index for faster queries
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_trading_date 
        ON trading_metrics(trading_date)
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_timestamp 
        ON trading_metrics(timestamp)
    ''')
    
    conn.commit()
    conn.close()
    print(f"Database initialized: {db_path}")

if __name__ == "__main__":
    init_database()
