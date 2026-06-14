# Estimated Moves (Weekly) - Complete Code Logic Analysis

## Overview
The Estimated Moves page calculates the expected price range (up/down) for weekly options based on implied volatility and market data. It's a real-time dashboard showing weekly expiration moves for SPX index and major equities/futures.

---

## Core Data Flow

### 1. **Initialization** (`init_database`)
- Runs on page load
- Initializes IndexedDB for snapshot storage
- Fetches available option expirations from the API
- Sets up UI with symbol list and date labels
- Calls `prefetchExpirations()` to populate dropdown with Friday dates

### 2. **Refresh Cycle** (`refreshEstimatedMoves`)
When user clicks "Start":
1. **Bulk Subscribe** - Subscribe to all 21 symbols via proxy
2. **Batch Processing** - Process 4 symbols at a time (parallel safety)
3. **Per-Symbol Calculation** - Call `estimateMove()` for each ticker
4. **Render Results** - Display table with up/down moves
5. **Snapshot Ready** - User can save to IndexedDB

---

## Key Calculations & Logic

### EM Formula (Estimated Move)
Two methods, in priority order:

#### **Method 1: IV Formula** (Primary)
```
EM = 0.84 × avgIV × close × √(DTE/365)
```
- `0.84` = statistical conversion factor (1σ)
- `avgIV` = average of call + put implied volatility
- `close` = underlying closing price (Friday 4pm)
- `DTE` = days to expiration
- Best when IV data is available

#### **Method 2: Straddle Price Fallback**
```
EM = (callMid + putMid) × 0.85
```
- Used when IV=0 but bid/ask available
- `callMid` = (bid + ask) / 2 or mark or last
- `putMid` = same for put
- `0.85` = conversion from straddle width to 1σ move
- Fallback when subscription data returns IV=0

### Move Calculation
```
Up = (indexClose + EM) + basis
Down = (indexClose - EM) + basis
```
- `indexClose` = closing price (special handling for futures)
- `basis` = ESM/NQM future basis (close - indexClose), else 0
- Futures use SPX/NDX prevClose for stability (not fluctuating last)

---

## Close Price Selection Logic

| Ticker | Logic | Source |
|--------|-------|--------|
| **ESM/NQM** (Futures) | dayClose if > 0, else em-closes cache | dxLink dayClosePrice (RTH 4pm) |
| **SPX/NDX** (Indices) | prevClose if > 0 (Friday 4pm) | Not real-time midpoint |
| **Equities** (AAPL, etc.) | last, mark, or (bid+ask)/2 | Real-time quotes |

**Key insight**: Futures use the *index's* stable prevClose for EM calculation, not the future's current mark. This prevents EM from fluctuating if the future price moves away from RTH close.

---

## Strike Selection Process

1. **ATM Strike**: Sorted by distance from `indexClose`
2. **First Valid ATM**: Find strike with both CALL and PUT
3. **IV Priority**: Check IV values first
4. **Fetch Marks**: If no IV data, call `/option-marks` endpoint
5. **Sanity Check**: Reject if EM is outside 0.2%–25% of underlying

**Example**:
```
Strikes sorted: [4600, 4605, 4610, ...] (by proximity to 4605.50)
Pick first strike with both C and P → check IV
If avgIV > 0 → use IV formula
Else → get marks, use straddle formula
```

---

## Data Fetching Strategy

### Quotes (Real-time)
- **Endpoint**: `/proxy/api/tt/quotes-batch`
- **Symbols**: All 21 at once
- **Cache**: 5s (5000ms)
- **Aliases**: ESM→/ES, NQM→/NQ, SPX→$SPX, etc.

### Options Chain
- **Primary**: `/proxy/api/tt/chains/{symbol}?expiration={date}&noSubscribe=1&forceSub=1`
- **Timeout**: 10s (Promise.race)
- **Fallback**: Direct REST fetch if subscription returns IV=0
- **Cache**: Per (chainSym, expiration) pair

### Implied Volatility (if missing)
- **Endpoint**: `/proxy/api/tt/option-marks?symbols={list}`
- **When**: If bid/ask are both 0
- **Data**: Mark prices and IV from alternate source

### Expirations
- **Primary**: `/proxy/api/tt/expirations/SPX`
- **Fallback**: Extract from `/chains/SPX?daysToExpiration=90`
- **Filter**: Friday expirations only for weekly view

---

## UI Components

### Header (Controls)
- **Date Display**: Next Friday by default
- **Expiration Dropdown**: Friday options, filtered from known expirations
- **Status**: Real-time (Live / Syncing / Error)
- **Buttons**: Start, Save, Export, Share (X/Discord)

### Sidebar (Left)
- **Last Sync**: Timestamp of last refresh
- **Snapshots Drawer**: Weekly snapshots stored in IndexedDB
- **Symbol List**: All 21 tickers being tracked

### Table (Center)
| Column | Meaning |
|--------|---------|
| Ticker | Symbol |
| Close | Current closing price |
| Exp | Expiration date (m/d format) |
| EM | Calculated estimated move |
| Up | High expected move (close + EM) |
| Down | Low expected move (close - EM) |

---

## Snapshot & Export Logic

### Save Snapshot
1. Capture table HTML from `#em-table-body`
2. Timestamp + period info stored in IndexedDB
3. Sidebar drawer auto-updates with count
4. Click to load previous snapshot

### Export CSV
1. Fetch all snapshots from IndexedDB
2. Parse each table HTML
3. Flatten to CSV: `Date, Time, Period, Ticker, Close, Exp, EM, Up, Down`
4. Auto-download as `.csv`

### Screenshots & Sharing
- **Full Table**: `html2canvas()` of entire table (Save button)
- **Share Table**: Simplified 3-column (Ticker, Up, Down) with divider at TSLA
- **X/Twitter**: Opens intent tweet + copies image to clipboard
- **Discord**: Posts image + text via webhook

---

## Error Handling & Caching

### Cache Clearing
- On each refresh: `_directChainCache`, `_quoteCache` cleared
- Prevents stale IV=0 results from persisting
- 5s quote cache allows quick consecutive calls

### Fallback Chain
1. Try subscription fetch (10s timeout)
2. If IV=0 across all options → direct REST fetch
3. If IV still 0 → try straddle mid fallback
4. If still failing → mark as error row (muted 55% opacity)

### Sanity Checks
- EM must be 0.2%–25% of underlying (rejects outliers)
- DTE must be finite and > 0
- Close must be finite and > 0
- Strike must have both CALL and PUT

---

## State Management

### Global State (EM object)
```javascript
EM.activePeriod = 'weekly'           // Current view period
EM.refreshBusy = false               // Prevent double-clicks
EM.expOverride = ''                  // Manual expiration override
EM.knownExpirations = []             // All available expirations
EM.bulkSubscribed = false            // Subscription flag
EM.DB = null                         // IndexedDB connection
```

### Cache Objects
```javascript
EM._quoteCache = {}                  // Quote batch cache
EM._quoteCacheTime = 0               // Cache timestamp
EM._directChainCache = {}            // Direct chain fetches
EM._emClosesCache = null             // Yahoo EM-closes
```

---

## Key Functions Summary

| Function | Purpose |
|----------|---------|
| `estimateMove(ticker)` | Core calculation per symbol |
| `fetchQuoteDetail(ticker)` | Get current close price |
| `fetchAllQuotes()` | Batch fetch all tickers |
| `fetchChainDirect(sym, exp)` | Fallback chain fetch |
| `normalizeOptions(chain)` | Flatten option chain to array |
| `prefetchExpirations()` | Load available dates |
| `refreshEstimatedMoves()` | Main refresh workflow |
| `saveSnapshot(tableHtml)` | Store to IndexedDB |
| `getSnapshots()` | Retrieve from IndexedDB |
| `exportSnapshots()` | CSV download all snapshots |

---

## Threading & Batching

### Batch Size: 4
- Process 4 symbols in parallel per batch
- 300ms delay between batches (API throttle)
- Total: ~21 symbols ÷ 4 = 6 batches × (1-2s each) = ~6-10s total

### Promise.allSettled
- Rejects don't stop pipeline
- One symbol error doesn't fail entire refresh
- Shows error row in table (muted display)

---

## Notable Details

1. **Friday Stability**: Futures close uses stable Friday 4pm index close, not real-time mark
2. **Straddle Fallback**: When IV data missing, uses option prices × 0.85
3. **DTE Calculation**: `Math.ceil((new Date(exp+'T16:00:00') - now) / 86400000)`
4. **Subscription Manager**: New endpoint `/subscription-ready` for waiting on Greeks
5. **No IIFE**: Global scope (EM namespace) for cross-page access
6. **Screenshot Format**: Share version is simplified (no Close/Exp), adds divider at TSLA

---

## Building the Page

To implement this in your dashboard:
1. Copy HTML structure (flex layout + sidebar + table)
2. Inline or link the JS (EM object needs global scope)
3. Ensure proxy endpoints exist: `/proxy/api/tt/quotes-batch`, `/proxy/api/tt/chains/...`, etc.
4. Load `html2canvas` library for screenshot sharing
5. Initialize with `window.init_database()` on page load

