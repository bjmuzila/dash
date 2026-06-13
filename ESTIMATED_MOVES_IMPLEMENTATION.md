# Estimated Moves - Complete Implementation Guide

## Files Created

1. **estimated-moves.html** - Page structure (flex layout, sidebar, table)
2. **estimated-moves.js** - Core logic (EM calculation, data fetching, UI binding)
3. **SQLITE_API_ENDPOINTS.md** - Backend API requirements
4. **ESTIMATED_MOVES_ANALYSIS.md** - Detailed logic breakdown

---

## Quick Start

### Frontend Integration
1. Add to your dashboard router/loader:
```javascript
// In your page loader or router
import { loadPage } from './path-to-loader';
loadPage('estimated-moves', {
  html: 'estimated-moves.html',
  js: 'estimated-moves.js'
});
```

2. Or directly in HTML:
```html
<link rel="stylesheet" href="styles.css">
<div id="app"></div>
<script src="estimated-moves.js"></script>
```

### Backend Setup (Node.js/Express)
```javascript
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();

const db = new sqlite3.Database('./snapshots.db');

// Create table on startup
db.run(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    period TEXT NOT NULL DEFAULT 'weekly',
    tableHtml TEXT NOT NULL,
    expirations TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// POST /api/snapshots - Save snapshot
app.post('/api/snapshots', express.json(), (req, res) => {
  const { timestamp, date, time, period, tableHtml, expirations } = req.body;
  const sql = `INSERT INTO snapshots (timestamp, date, time, period, tableHtml, expirations)
               VALUES (?, ?, ?, ?, ?, ?)`;
  db.run(sql, [timestamp, date, time, period, tableHtml, JSON.stringify(expirations)], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({
      id: this.lastID,
      timestamp, date, time, period, tableHtml,
      expirations: expirations || []
    });
  });
});

// GET /api/snapshots - List snapshots
app.get('/api/snapshots', (req, res) => {
  const period = req.query.period || null;
  let sql = 'SELECT * FROM snapshots';
  const params = [];
  if (period) {
    sql += ' WHERE period = ?';
    params.push(period);
  }
  sql += ' ORDER BY id DESC';
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const parsed = rows.map(r => ({
      ...r,
      expirations: r.expirations ? JSON.parse(r.expirations) : []
    }));
    res.json(parsed);
  });
});

// DELETE /api/snapshots/:id
app.delete('/api/snapshots/:id', (req, res) => {
  db.run('DELETE FROM snapshots WHERE id = ?', req.params.id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ id: req.params.id, message: 'Deleted' });
  });
});

// POST /api/discord-webhook
app.post('/api/discord-webhook', express.json(), async (req, res) => {
  // Implementation depends on your Discord setup
  // See SQLITE_API_ENDPOINTS.md for details
});

app.listen(3000, () => console.log('Server running on :3000'));
```

---

## Key Changes from Original

### IndexedDB → SQLite
- **Before**: Client-side IndexedDB storage (browser-only, limited to ~50MB)
- **After**: Server-side SQLite (persistent, unlimited, queryable)

### API Endpoints
- `POST /api/snapshots` - Save
- `GET /api/snapshots?period=weekly` - List all
- `GET /api/snapshots/:id` - Get one
- `DELETE /api/snapshots/:id` - Delete one
- `POST /api/discord-webhook` - Discord sharing

### Removed
- `EM.initDB()` - No longer needed
- IndexedDB transaction logic
- Local storage constraints

### Added
- `EM.deleteSnapshot(id)` - Delete via API
- `emDeleteSnapshot(id)` - UI handler with confirm
- Delete button in drawer (×)

---

## Core Calculation Logic (Unchanged)

### EM Formula
```
EM = 0.84 × avgIV × close × √(DTE/365)
```
- **When IV available**: Use this formula (most accurate)
- **When IV=0**: Fall back to straddle mid × 0.85

### Move Calculation
```
Up = (indexClose + EM) + basis
Down = (indexClose - EM) - basis
```

**Futures Handling**:
- Use index's stable Friday 4pm prevClose (not real-time mark)
- Calculate basis = future_close - index_close
- Apply basis to final up/down levels

### Strike Selection
1. Sort all strikes by ATM distance
2. Find first strike with both CALL + PUT
3. Check IV, fallback to marks if IV=0
4. Validate EM is 0.2%–25% of underlying

---

## Data Flow

### Refresh Cycle (Click "Start")
```
1. Clear caches (quotes, chains, marks)
2. Subscribe to all 21 symbols (bulk)
3. Process 4 symbols at a time, 300ms between batches
   - fetchQuoteDetail(ticker)
   - getTargetExpiration()
   - fetchChain(chainSym, exp)
   - normalizeOptions()
   - Find ATM strike
   - Calculate EM (IV formula or straddle)
4. Render table
5. Ready to "Save" snapshot
```

### Save Snapshot
```
1. Capture table HTML
2. POST to /api/snapshots
3. Backend inserts into SQLite
4. Refresh sidebar drawer
5. User can load/delete/export
```

### Export CSV
```
1. Fetch all snapshots from /api/snapshots
2. Parse each table HTML
3. Flatten to rows: [date, time, period, ticker, close, exp, em, up, down]
4. Generate CSV, download
```

---

## UI Components

### Header
- **Status**: Real-time feedback (Ready / Syncing / Live / Error)
- **Date**: Target expiration (auto-Friday)
- **Dropdown**: Manual expiration override
- **Buttons**: Start, Save, Export, Screenshot, Share (X/Discord)

### Sidebar
- **Last Sync**: Timestamp of last refresh
- **Weekly Drawer**: Click to toggle, shows all saved snapshots
  - Click to load
  - × button to delete
- **Symbol List**: All 21 tickers being tracked

### Table
| Column | Meaning |
|--------|---------|
| Ticker | Symbol |
| Close | Current closing price (Friday 4pm for indices) |
| Exp | Expiration date (m/d format) |
| EM | Estimated move (0.84 × avgIV × √DTE or straddle) |
| Up | High expected move |
| Down | Low expected move |

---

## Configuration

### Symbols (EM.SYMBOLS)
```javascript
['ESM','NQM','SPY','QQQ','SPX','AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA','COIN','HOOD','IWM','NDX','NFLX','SMH','PLTR']
```
Edit this array to change which tickers are tracked.

### API Symbol Mappings
```javascript
EM.API_SYMBOL = { ESM:'/ES:XCME', NQM:'/NQ:XCME', SPX:'$SPX', NDX:'$NDX' };
EM.CHAIN_SYMBOL = { SPX:'$SPX', NDX:'$NDX' };
EM.FUTURE_PROXY = { ESM:'SPX', NQM:'NDX' };
```
Adjust these if your quote/chain endpoints use different symbol formats.

### Proxy Base
Default: `${location.protocol}//${location.hostname}:3001`

Override via:
- Query param: `?proxy=http://example.com:3000`
- Window var: `window.EM_PROXY_BASE = 'http://example.com:3000'`

---

## Caching Strategy

### Quotes (5s)
- Batch fetch all 21 tickers once per refresh
- Cache results for 5s to avoid refetch per symbol
- **Clear on refresh**: Ensures fresh prices

### Option Chains (Per expiration)
- Direct chain fetch cached by `chainSym:expiration` key
- Only fetches once if IV=0 on first attempt
- **Clear on refresh**: Prevents stale IV=0 results

### Quote Cache Aliases
- Maps ESM → /ES, NQM → /NQ, SPX → $SPX, NDX → $NDX
- Handles multiple symbol formats from API

---

## Error Handling

### Graceful Degradation
- Single symbol error doesn't stop refresh (Promise.allSettled)
- Error rows shown muted (opacity 55%) in table
- Status shows "Live" even if 1-2 symbols fail

### Fallback Chain
1. Subscription fetch (10s timeout)
2. Direct REST fetch if IV=0
3. Straddle mid (× 0.85) if IV still missing
4. Mark the row as error

### Validation Checks
- EM must be 0.2%–25% of underlying (rejects outliers)
- DTE must be > 0
- Close must be > 0 and finite
- Strike must have both CALL and PUT

---

## Performance Notes

### Batch Size: 4
- 21 symbols ÷ 4 = ~6 batches
- 300ms delay between batches
- Total time: ~6-10 seconds

### Payload Sizes
- Snapshot HTML: ~8-15KB per snapshot
- SQLite DB: Grows ~100KB per 50 snapshots
- Consider cleanup after 30 days

### API Calls per Refresh
1. quotes-batch (1)
2. subscription-ready (1)
3. chains/SPX (1 + fallback if IV=0)
4. chains per symbol (up to 21 if IV=0)
5. option-marks (1-5 if IVs missing)
6. **Total**: ~5-30 calls (30s timeout)

---

## Troubleshooting

### "No options for expiration"
- Check if expirations are being fetched correctly
- Verify `/proxy/api/tt/expirations/SPX` is returning valid dates
- Check browser console for error logs

### All IV = 0
- Subscription may not be ready (wait 4s)
- Direct chain fetch may be timing out (10s)
- Check if `/proxy/api/tt/chains/{symbol}?noSubscribe=1` works manually

### Snapshots not saving
- Verify backend `/api/snapshots` endpoint is responding
- Check CORS if backend is on different domain
- Look for 400/500 errors in Network tab

### Screenshot failing
- Ensure `html2canvas` library is loaded
- Check if table contains external images (CORS issue)
- Try refreshing page and capturing again

### Discord post failing
- Verify webhook URL is valid and recent
- Check if webhook has "File" permission
- Try manually posting to webhook URL

---

## Browser Support

- **Chrome/Edge**: Full support (html2canvas, fetch, FormData)
- **Firefox**: Full support
- **Safari**: Full support (iOS may have clipboard issues)

### Requirements
- Fetch API
- Promise/async-await
- ES6+ (arrow functions, template literals, destructuring)
- FormData for file uploads
- html2canvas library (for screenshots)

---

## Future Enhancements

1. **Daily Moves**: Add daily, monthly periods
2. **Historical Graphs**: Chart EM changes over time
3. **Alert Thresholds**: Notify if EM exceeds X%
4. **Backtest**: Compare predicted vs actual move
5. **Options Chain View**: See all strikes for ATM
6. **IV Tracking**: Chart IV changes per symbol
7. **Mobile**: Responsive layout for phones
8. **API Integration**: Pull from TradingView, Polygon, etc.

---

## Files Summary

| File | Purpose |
|------|---------|
| estimated-moves.html | Page structure (flex, sidebar, table) |
| estimated-moves.js | Logic (EM calc, API calls, UI binding) |
| SQLITE_API_ENDPOINTS.md | Backend API spec (SQLite schema, endpoints) |
| ESTIMATED_MOVES_ANALYSIS.md | Detailed technical breakdown |
| ESTIMATED_MOVES_IMPLEMENTATION.md | This file (quick start & overview) |

All files are ready to integrate into your bzila-dashboard project.

