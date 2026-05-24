import sqlite3
from datetime import datetime

class TradingMetricsDB:
    def __init__(self, db_path='trading_metrics.db'):
        self.db_path = db_path
        
    def insert_metric(self, timestamp: str, mvc: float | None, 
                     net_flow: float | None, cvd: float | None,
                     trading_date: str | None = None):
        """Insert a single trading metric record."""
        if trading_date is None:
            trading_date = datetime.now().strftime('%Y-%m-%d')
            
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO trading_metrics (timestamp, mvc, net_flow, cvd, trading_date)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(timestamp, trading_date) DO UPDATE SET
                    mvc = excluded.mvc,
                    net_flow = excluded.net_flow,
                    cvd = excluded.cvd
            ''', (timestamp, mvc, net_flow, cvd, trading_date))
            
            conn.commit()
            return cursor.lastrowid
        except sqlite3.Error as e:
            print(f"Database error: {e}")
            conn.rollback()
            return None
        finally:
            conn.close()
    
    def insert_batch(self, records: list):
        """Insert multiple records at once."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        try:
            cursor.executemany('''
                INSERT INTO trading_metrics (timestamp, mvc, net_flow, cvd, trading_date)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(timestamp, trading_date) DO UPDATE SET
                    mvc = excluded.mvc,
                    net_flow = excluded.net_flow,
                    cvd = excluded.cvd
            ''', records)
            
            conn.commit()
            return cursor.rowcount
        except sqlite3.Error as e:
            print(f"Database error: {e}")
            conn.rollback()
            return 0
        finally:
            conn.close()
    
    def get_day_metrics(self, trading_date: str):
        """Retrieve all metrics for a specific trading day."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT timestamp, mvc, net_flow, cvd
            FROM trading_metrics
            WHERE trading_date = ?
            ORDER BY timestamp
        ''', (trading_date,))
        
        results = cursor.fetchall()
        conn.close()
        
        return results
    
    def get_latest_metrics(self, limit=100):
        """Get the most recent metrics."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT timestamp, mvc, net_flow, cvd, trading_date
            FROM trading_metrics
            ORDER BY trading_date DESC, timestamp DESC
            LIMIT ?
        ''', (limit,))
        
        results = cursor.fetchall()
        conn.close()
        
        return results
    
    def get_metrics_range(self, start_time: str, end_time: str, trading_date: str):
        """Get metrics within a specific time range for a trading day."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT timestamp, mvc, net_flow, cvd
            FROM trading_metrics
            WHERE trading_date = ? AND timestamp BETWEEN ? AND ?
            ORDER BY timestamp
        ''', (trading_date, start_time, end_time))
        
        results = cursor.fetchall()
        conn.close()
        
        return results
