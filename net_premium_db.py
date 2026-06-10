"""
Net Premium Metrics Database Module
Stores and retrieves net premium sparkline data
"""

import sqlite3
from datetime import datetime
from pathlib import Path

class NetPremiumDB:
    def __init__(self, db_path='net_premium_metrics.db'):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        """Initialize database tables if they don't exist."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS net_premium_metrics (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    trading_date TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    value REAL NOT NULL,
                    spot_price REAL,
                    session_time INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(trading_date, timestamp)
                )
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_trading_date
                ON net_premium_metrics(trading_date)
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_timestamp
                ON net_premium_metrics(timestamp)
            ''')

            conn.commit()
        except sqlite3.Error as e:
            print(f"Database initialization error: {e}")
        finally:
            conn.close()

    def insert_metric(self, timestamp: str, value: float,
                     spot_price: float | None = None,
                     session_time: int | None = None,
                     trading_date: str | None = None):
        """Insert a single net premium metric record."""
        if trading_date is None:
            trading_date = datetime.now().strftime('%Y-%m-%d')

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cursor.execute('''
                INSERT INTO net_premium_metrics
                (trading_date, timestamp, value, spot_price, session_time)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(trading_date, timestamp) DO UPDATE SET
                    value = excluded.value,
                    spot_price = excluded.spot_price,
                    session_time = excluded.session_time
            ''', (trading_date, timestamp, value, spot_price, session_time))

            conn.commit()
            return cursor.lastrowid
        except sqlite3.Error as e:
            print(f"Database error: {e}")
            conn.rollback()
            return None
        finally:
            conn.close()

    def insert_batch(self, records: list):
        """Insert multiple records at once.

        Each record should be a tuple:
        (trading_date, timestamp, value, spot_price, session_time)
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cursor.executemany('''
                INSERT INTO net_premium_metrics
                (trading_date, timestamp, value, spot_price, session_time)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(trading_date, timestamp) DO UPDATE SET
                    value = excluded.value,
                    spot_price = excluded.spot_price,
                    session_time = excluded.session_time
            ''', records)

            conn.commit()
            return cursor.rowcount
        except sqlite3.Error as e:
            print(f"Database error: {e}")
            conn.rollback()
            return 0
        finally:
            conn.close()

    def get_day_metrics(self, trading_date: str, limit: int = 800):
        """Retrieve all metrics for a specific trading day."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cursor.execute('''
                SELECT timestamp, value, spot_price, session_time
                FROM net_premium_metrics
                WHERE trading_date = ?
                ORDER BY timestamp ASC
                LIMIT ?
            ''', (trading_date, limit))

            results = cursor.fetchall()
            return results
        finally:
            conn.close()

    def get_latest_metrics(self, limit: int = 800):
        """Get the most recent metrics from today."""
        trading_date = datetime.now().strftime('%Y-%m-%d')
        return self.get_day_metrics(trading_date, limit)

    def get_metrics_range(self, start_ts: str, end_ts: str, trading_date: str):
        """Get metrics within a specific timestamp range for a trading day."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cursor.execute('''
                SELECT timestamp, value, spot_price, session_time
                FROM net_premium_metrics
                WHERE trading_date = ? AND timestamp BETWEEN ? AND ?
                ORDER BY timestamp ASC
            ''', (trading_date, start_ts, end_ts))

            results = cursor.fetchall()
            return results
        finally:
            conn.close()

    def get_history(self, limit: int = 800, trading_date: str | None = None):
        """Get historical data formatted for frontend sparkline."""
        if trading_date is None:
            trading_date = datetime.now().strftime('%Y-%m-%d')

        records = self.get_day_metrics(trading_date, limit)

        return [
            {
                'timestamp': ts,
                'value': value,
                'spotPrice': spot_price,
                'sessionTime': session_time
            }
            for ts, value, spot_price, session_time in records
        ]

    def delete_old_data(self, days_to_keep: int = 30):
        """Delete metrics older than specified days."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cutoff_date = datetime.now().strftime('%Y-%m-%d')
            cursor.execute('''
                DELETE FROM net_premium_metrics
                WHERE trading_date < date('now', '-' || ? || ' days')
            ''', (days_to_keep,))

            conn.commit()
            return cursor.rowcount
        except sqlite3.Error as e:
            print(f"Database error: {e}")
            conn.rollback()
            return 0
        finally:
            conn.close()

    def get_stats(self, trading_date: str | None = None):
        """Get min/max/average for a trading day."""
        if trading_date is None:
            trading_date = datetime.now().strftime('%Y-%m-%d')

        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        try:
            cursor.execute('''
                SELECT
                    MIN(value) as min_value,
                    MAX(value) as max_value,
                    AVG(value) as avg_value,
                    COUNT(*) as record_count
                FROM net_premium_metrics
                WHERE trading_date = ?
            ''', (trading_date,))

            result = cursor.fetchone()
            if result:
                return {
                    'min': result[0],
                    'max': result[1],
                    'avg': result[2],
                    'count': result[3]
                }
            return None
        finally:
            conn.close()
