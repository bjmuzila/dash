#!/usr/bin/env python3
"""
AUTO-DEPLOY SCRIPT
Run this once to set everything up automatically.
"""

import subprocess
import sys
import os

def main():
    print("=" * 60)
    print("TRADING METRICS DATABASE - AUTO SETUP")
    print("=" * 60)
    
    # 1. Install dependencies
    print("\n[1/3] Installing Flask dependencies...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "flask", "flask-cors", "-q"])
        print("✓ Flask installed")
    except:
        print("⚠ Flask install failed - may already be installed")
    
    # 2. Initialize database
    print("\n[2/3] Initializing database...")
    from init_db import init_database
    init_database('trading_metrics.db')
    print("✓ Database ready")
    
    # 3. Instructions
    print("\n[3/3] Setup complete!")
    print("\n" + "=" * 60)
    print("NEXT STEPS:")
    print("=" * 60)
    print("\n1. ADD THIS TO YOUR DASHBOARD HTML (before </body>):")
    print("   <script src=\"dashboard_db_sync.js\"></script>")
    print("\n2. START THE BRIDGE SERVER:")
    print("   python metrics_bridge.py")
    print("\n3. OPEN YOUR DASHBOARD")
    print("   Metrics will auto-save every 5 seconds")
    print("\n" + "=" * 60)

if __name__ == "__main__":
    main()
