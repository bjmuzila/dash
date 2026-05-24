#!/usr/bin/env python3
"""
Trading Metrics Database - Setup Script
Run this first to initialize your database.
"""

from init_db import init_database

if __name__ == "__main__":
    print("Setting up trading metrics database...")
    init_database('trading_metrics.db')
    print("\nSetup complete! Database ready to use.")
    print("\nNext steps:")
    print("1. Import TradingMetricsDB in your code:")
    print("   from trading_db import TradingMetricsDB")
    print("2. Create instance: db = TradingMetricsDB()")
    print("3. Start inserting metrics")
