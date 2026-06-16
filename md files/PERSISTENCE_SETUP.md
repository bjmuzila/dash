# SQLite Data Persistence Setup

## Overview
Your dashboard now syncs all critical data to SQLite on the backend. This means data survives server restarts.

## Changes Made

### 1. Backend Endpoints (proxy-tastytrade.js)
Added 6 new REST endpoints:

- **POST /api/mvc/save** — Save MVC snapshots
- **GET /api/mvc/all** — Retrieve all MVC snapshots
- **POST /api/buy_sell/save** — Save buy/sell scores
- **GET /api/buy_sell/date** — Retrieve buy/sell scores by date
- **POST /api/gex/levels** — Save GEX levels (call wall, put wall, zero gamma)
- **GET /api/gex/levels** — Retrieve GEX levels by date

### 2. Frontend Sync (pages/database/database.js)
Updated 2 methods to dual-write (IndexedDB + SQLite):

- `saveMVCSnapshot()` — Now POSTs to `/api/mvc/save` after IndexedDB write
- `saveBuySellScore()` — Now POSTs to `/api/buy_sell/save` after IndexedDB write

### 3. GEX Levels Persistence (index.html)
Updated `gexTakeSnapshot()` to POST GEX levels to `/api/gex/levels` whenever a snapshot is taken.

### 4. Data Recovery on Startup (index.html)
Added `loadPersistedDataFromSQLite()` which runs during dashboard init:
- Loads recent MVC snapshots
- Loads today's buy/sell scores
- Loads today's GEX levels
- Populates `window.AppState` with recovered data

## Testing

### 1. Start the server
```bash
cd Vanilla
npm run dev  # or node proxy-tastytrade.js
```

### 2. Open the dashboard
```
http://localhost:8080
```

### 3. Take a snapshot
Click "⊕ SNAP" button in the topbar. You should see "✓ Snapshot saved!"

### 4. Check console
Open DevTools (F12) and look for:
```
[DB] MVC snapshot saved: { date, triggerType, strike }
[Sync] Posted to SQLite...
```

### 5. Restart the server
Kill the Node process (Ctrl+C) and restart it:
```bash
node proxy-tastytrade.js
```

### 6. Reload the dashboard
Refresh the page. You should see:
```
[Init] Loading persisted data from SQLite...
[Init] Loaded X MVC snapshots from SQLite
[Init] Loaded X buy/sell scores for today
[Init] Loaded X GEX levels for today
[Init] ✓ SQLite data loaded successfully
```

### 7. Verify data persisted
- Topbar should show the GEX peak strikes you saved
- The Database page should show historical snapshots

## Database Location
```
/Vanilla/data/trading.db
```

This is a SQLite3 database with full schema. You can inspect it:
```bash
sqlite3 Vanilla/data/trading.db ".tables"
sqlite3 Vanilla/data/trading.db "SELECT COUNT(*) FROM mvc;"
```

## What's Persisted
- ✅ MVC snapshots (with OI+Vol breakdown, Greeks, price)
- ✅ Buy/sell scores (with GEX/DEX/CHEX/VEX)
- ✅ GEX levels (call wall, put wall, zero gamma)
- ✅ All timestamped and indexed by date

## What's NOT Persisted (yet)
- Premium flow (1-min buckets)
- Chain snapshots
- Greeks time series
- Multi-stock flow
- ES candles

These can be added following the same pattern if needed.

## Error Handling
If SQLite is unavailable:
- Snapshots still save to IndexedDB (offline mode)
- Console shows `[Sync] ... failed` but doesn't crash the app
- Next successful sync writes to DB

## Offline Support
- IndexedDB is still your primary store for offline browsing
- SQLite is the secondary persistent layer for server restart survival
- If backend is down, IndexedDB keeps working for that session
