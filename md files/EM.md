# Estimated Moves Dashboard Guide

## Overview
The Estimated Moves (EM) dashboard calculates expected price moves for indices and futures based on options market pricing. It uses three calculation methods (Daily, Weekly, Monthly) and derives futures moves from their corresponding indices.

---

## Getting Close Prices

### Daily Close
**Method:** Previous trading day's 4:00 PM ET regular session close

**Data Sources (in order):**

2. **TastyTrade API** (fallback) — `/tt/candles/{symbol}` endpoint
3. **Live Quote** (fallback if both fail) — Most recent available price

**How It Works:**
- Dashboard walks back calendar days to find the most recent completed trading day
- Fetches 5-minute candles in a 5-minute window around 4:00 PM ET (19:45–20:05 UTC in EDT)
- Takes the **last candle** in that window as the 4 PM close
- Logs: `[EM] {TICKER} Friday close: {PRICE}`

**Note:** The base close price is displayed in the table and used to calculate Up/Down targets.

---

## Weekly Expiration Dropdown

### How the Dropdown Populates
1. **On Page Load:** `prefetchExpirations()` automatically fetches all available option expirations for the selected index (SPX or NDX)
2. **Data Source:** TastyTrade API — `GET /proxy/api/tt/expirations/{SYMBOL}`
   - Example: `http://localhost:3001/proxy/api/tt/expirations/SPX`
3. **Response Shape:**
   ```json
   {
     "data": {
       "expirations": [
         "2026-06-05",
         "2026-06-12",
         "2026-06-19",
         ...
       ]
     }
   }
   ```

### Auto-Selection Logic
On load, the dashboard **automatically selects**:
- **Weekly Period:** The nearest future weekly expiration (typically Friday of next week)
- **Monthly Period:** The nearest future monthly expiration (typically 3rd Friday of next month)

### Manual Override
Click the dropdown under "Exp" to manually select any available expiration date. Your selection persists for that period until you switch periods or change the selection.

**Stored As:**
- `weeklyExpOverride` — manually selected weekly expiration (YYYY-MM-DD)
- `monthlyExpOverride` — manually selected monthly expiration (YYYY-MM-DD)

---

## How EM Calculation Works: SPX/NDX (Indices)

### Formula
```
EM = 0.84 × Average IV × Close Price × √(DTE / 365)
```

Where:
- **IV** = Implied Volatility from the options chain (weighted across strikes)
- **Close Price** = Base close at 4:00 PM ET on Friday (for weekly) or previous trading day (for daily)
- **DTE** = Days to expiration
- **0.84** = Scaling factor (approximately 1 standard deviation)

### Step-by-Step Example
**Scenario:**
- SPX close: **5,100**
- Average IV: **18%** (0.18)
- DTE to expiration: **7 days**

**Calculation:**
```
EM = 0.84 × 0.18 × 5,100 × √(7/365)
EM = 0.84 × 0.18 × 5,100 × 0.1386
EM ≈ 108 points
```

**Up Target:** 5,100 + 108 = **5,208**
**Down Target:** 5,100 − 108 = **4,992**

### Data Source
- **Options Chain:** TastyTrade API — `GET /proxy/api/tt/chains/{SYMBOL}?expiration=YYYY-MM-DD`
- Response includes bid/ask prices and implied volatility for each strike
- Dashboard calculates weighted IV across all available strikes

### What Happens If IV = 0
If the options chain returns 0 IV (rare, usually after-hours for stocks):
- Fallback to **straddle mid** = `(call + put price) / 2`
- Uses this as a proxy for expected move in points
- Less accurate but prevents blank rows

---

## How EM Works: ES/NQ (Futures)

### The Basis Concept
ES and SPX trade at different prices due to:
- **Dividends** paid during the holding period
- **Interest rates** (cost of carry)
- **Supply/demand imbalances**

The difference between them is called the **basis**.

```
Basis = ES Close − SPX Close
```

### Why This Matters
The options market prices moves in SPX (the cash index). When you apply that move to ES, you must account for the basis gap to get the correct targets.

### Calculation Steps

**Step 1: Get the Basis**
Find the close prices for both at the same point in time (Friday 4 PM ET or previous day 4 PM ET):
```
ES Friday Close:   5,120
SPX Friday Close:  5,100
Basis = 5,120 − 5,100 = +20 points
```

**Step 2: Calculate SPX Expected Move**
Use the IV formula (shown above) on SPX option chain:
```
SPX EM = 108 points
SPX Up = 5,100 + 108 = 5,208
SPX Down = 5,100 − 108 = 4,992
```

**Step 3: Add Basis to SPX Targets**
```
ES Up = SPX Up + Basis = 5,208 + 20 = 5,228
ES Down = SPX Down + Basis = 4,992 + 20 = 5,012
```

**Result:**
- ES EM = 108 (same as SPX, basis cancels out in the delta)
- ES Close = 5,120
- ES Up = 5,228
- ES Down = 5,012

### Key Insight
The **EM percentage is the same** for both ES and SPX, but the **point targets shift by the basis** to reflect the actual futures price level.

### Data Sources
- **SPX/NDX Closes & EM:** Calculated as shown above
- **ES/NQ Closes:** Schwab API — `/marketdata/v1/pricehistory` with `needExtendedHoursData=true` (futures trade 24/5)
- **Basis Calculation:** `futureFriClose − indexFriClose`
- Logs: `[EM] ESM basis: +20.50 (fut=5120 idx=5099.50)`

---

## Daily vs. Weekly vs. Monthly Periods

| Period | Close Used | DTE Calculation | Expiration | Use Case |
|--------|-----------|-----------------|-----------|----------|
| **Daily** | Previous trading day 4 PM | 1 day (fixed) | Not displayed | Intraday expectations |
| **Weekly** | Friday 3:55 PM | Days until selected weekly exp | User selects from dropdown | Standard week outlook |
| **Monthly** | Friday 3:55 PM | Days until selected monthly exp | User selects from dropdown | Month-long outlook |

---

## Error Handling & Hidden Rows

### Daily Mode: Hidden Error Rows
If a ticker **fails to fetch** or returns **zero EM** in **Daily** mode:
- The entire row is hidden from the table
- No error message is shown
- The ticker is silently skipped

### Weekly/Monthly Modes: Visible Rows
Error rows remain visible and show the error message in the Close column (red text).

### Common Failure Reasons
- **Quote endpoint down** — Close price fetch fails, EM cannot be calculated
- **Options chain not available** — IV data missing (rare after-hours for stocks)
- **Network timeout** — Proxy server or upstream API unreachable
- **Symbol mismatch** — Ticker not found in database

Check the browser console (`F12` → Console tab) for detailed logs:
```
[EM] quote SPY: 545.30 from /proxy/api/quote/
[EM] chain sample SPY: IV=18.5, strike=545, call bid=2.30
[EM] ESM basis: +12.50 (fut=7590 idx=7577.50)
```

---

## Snapshots & Export

### Saving Snapshots
Click **[Save]** to store the current table state with:
- Date & time
- Period (Daily/Weekly/Monthly)
- Full table HTML

Snapshots are stored in **IndexedDB** and persist indefinitely.

### Loading Snapshots
Left sidebar shows collapsible drawers for each period. Click an entry to restore that snapshot's table.

### Exporting
Click **[Export]** to download a CSV file with columns:
```
Date, Period, Ticker, Close, Exp, EM, Up, Down
```

One row per ticker per snapshot.

---

## Keyboard & UI Tips

### Period Tabs
- Click **Daily**, **Weekly**, or **Monthly** to switch periods
- Active period shows cyan highlight
- Table re-fetches EM data when you switch (if data already exists)

### Expiration Dropdown
- Only visible in Weekly/Monthly modes
- Shows all available expirations from TastyTrade
- Changes update the EM calculation immediately

### Share Buttons
- **[COPY SHOT]** — Copy screenshot to clipboard (dark theme, stripped columns)
- **[X]** — Copy screenshot + open Twitter intent to share
- **[DISCORD]** — Post screenshot directly to Discord webhook

### Snapshot Sidebar
- Click entry to load snapshot
- Click red **×** to delete that entry
- Counts (1, 5, 0) show number of saved snapshots per period

---

## Troubleshooting

### "ESM shows $1"
- **Cause:** Quote endpoint failing or returning stale `previousClose` field
- **Fix:** Ensure proxy is running and `/proxy/api/marketdata/v1/quotes` is responding
- **Check:** Browser console for `[EM] quote ESM:` logs

### "No expirations in dropdown"
- **Cause:** `prefetchExpirations()` failed or returned empty array
- **Fix:** Check that TastyTrade API is accessible at `/proxy/api/tt/expirations/{SYMBOL}`
- **Check:** Browser console for fetch errors

### "Daily mode shows no rows"
- **Cause:** All tickers errored (missing IV, quote fetch failed)
- **Fix:** Switch to Weekly mode to see error messages, debug individual tickers
- **Check:** Console logs for `[EM] quote {TICKER}:` and `[EM] chain sample {TICKER}:`

### "Snapshot not loading"
- **Cause:** IndexedDB quota exceeded or browser cleared storage
- **Fix:** Try **Export** CSV as backup, clear old snapshots with red **×** buttons
- **Check:** Browser DevTools → Application → IndexedDB → EM_Dashboard

---

## Architecture Notes

### Data Flow
1. User selects period (Daily/Weekly/Monthly)
2. `setEstimatedMovePeriod()` updates `activePeriod`
3. Click **[Start]** or **[Refresh]** → `refreshEstimatedMoves()`
4. For each ticker in list:
   - Fetch quote (close price)
   - Fetch options chain (IV)
   - Fetch Friday close (if Weekly/Monthly)
   - Calculate EM using formula
   - Render row in table
5. Click **[Save]** → store table to IndexedDB
6. Click **[Export]** → download CSV from all snapshots

### Files
- **estimated-moves.html** — Standalone page, all logic included
- **database.js** — IndexedDB schema & helper methods
- **proxy-tastytrade.js** — Node proxy server (TastyTrade API relay)

### Proxy Endpoints Used
```
GET /proxy/api/marketdata/v1/quotes?symbols=SPX,%2FESM6
GET /proxy/api/tt/expirations/SPX
GET /proxy/api/tt/chains/SPX?expiration=2026-06-12
GET /proxy/api/tt/candles/SPX?start={ms}&end={ms}&interval=5&unit=minute
GET /proxy/api/marketdata/v1/pricehistory?symbol=SPX&...
```

---

## Daily Est. Moves Nav Panel

### What It Is
A compact panel in the left sidebar of `index.html` (not the full EM page). Shows ESM6 and NQM6 estimated moves for the **next trading day's 0DTE expiration**. Updates live during market hours, caches at 4pm for weekend/overnight use.

**File:** `index.html` — wrapped in `(function() { ... })()` starting around the `// DAILY ESTIMATED MOVES PANEL` comment. All logic is self-contained in that IIFE.

---

### Data Sources (in priority order)

1. **Proxy EM cache** — `GET /proxy/api/em/:date` — values saved to `data/em-cache.json` on disk. Survives proxy restarts and browser refreshes.
2. **Browser localStorage** — key `nav_daily_em_v1` — faster on same-session reload. Lost if browser storage is cleared.
3. **Live option chains** — `GET /proxy/api/tt/chains/SPX?expiration=YYYY-MM-DD&noSubscribe=1` — fetched during market hours only.
4. **Option marks fallback** — `GET /proxy/api/tt/option-marks?symbols=...` — used if chain returns zero bid/ask.

**Close prices** always come from `GET /proxy/api/tt/em-closes` (Yahoo Finance). Returns `{ data: { spx, es, ndx, nq } }`. Works on weekends (returns last Friday close).

---

### EM Calculation

```
straddle = callMid + putMid
EM = straddle × 0.85
```

Mid price priority per leg: `bid/ask average → mark → last`

If chain prices are all zero → fetch from `/proxy/api/tt/option-marks`
If marks also zero → IV fallback: `EM = 0.84 × avgIV × close × √(1/365)`

---

### Date & Cache Key Logic

The cache key is always the **target expiration date** (next trading day for the EM being shown):

| When | Cache key | What happens |
|------|-----------|--------------|
| Weekday morning (4am–9:30am) | Today | Fetch live, cache under today |
| Market hours (9:30am–4pm) | Today | Fetch live, cache under today |
| **4–6pm ET (EM window)** | **Next trading day** | Fetch tomorrow's chain, cache under tomorrow |
| Saturday / Sunday | **Next Monday** | No live fetch — load from cache only |

`getCacheKeyDate()` in the code handles all of this. On weekends and in the 4–6pm window it calls `nextWeekday(now)`.

**Key insight:** Friday at 4pm saves Monday's EM under Monday's date key. Saturday and Monday morning both look up Monday's key — data flows through without recalculation.

---

### Startup Flow

```
Page loads
  ↓
loadCachedEM()           — localStorage, keyed to getCacheKeyDate()
  ↓
fetch /proxy/api/em/{today}           — try today's date
  ↓ (if weekend, also try)
fetch /proxy/api/em/{nextMonday}      — try next Monday
  ↓ (if still nothing)
fetch /proxy/api/em/latest            — most recently saved entry (any date)
  ↓
if savedEM found → render it, stop
  ↓
if weekend → renderWaitingState(), stop   (no live chains on weekends)
  ↓
if weekday but outside all windows → use localStorage cache or waiting
  ↓
fetch /proxy/api/tt/em-closes         — get Yahoo close prices
  ↓
getStraddle('SPX') + getStraddle('NDX')  — parallel fetch of option chains
  ↓
render + save to localStorage + POST /proxy/api/em/{getCacheKeyDate()}
```

---

### Expiration Candidates (inside `getStraddle`)

```js
if (weekend) → [nextTradingDay()]
if (4–6pm EM window) → [nextTradingDay()]
else → [today, tomorrow, nextMonday]   // tries in order, uses first valid
```

The proxy-saved EM path inside `getStraddle` is tried first (before fetching chains). It fetches `GET /proxy/api/em/{today}` — if data exists and both `spx > 0` and `ndx > 0`, returns immediately without hitting the chain.

---

### Render Function

```js
render(pfx, futClose, em, debugText)
```

- `pfx` = `'es'` or `'nq'`
- `futClose` = close price from Yahoo (used for UP/DN/% calculation)
- `em` = estimated move in points
- `debugText` = shown in the DBG line (format: `cls: 7400.25 | strike 7400 | call 35.50 + put 34.75`)

`showClose = futClose > 0 && em > 0` — UP, DN, %MOVE only display when both are valid.

---

### COPY SNAP Button

Clones `#daily-em-panel`, then:
- Removes: `#em-es-ref` (cls line), `#em-nq-ref` (cls line), `#em-es-debug` (DBG line), both buttons
- Injects: `exp: YYYY-MM-DD` at bottom (from `window._dailyEMExpDate`)
- Renders via `html2canvas` at 2× scale, copies PNG to clipboard

`window._dailyEMExpDate` is set every time `render()` is called with real data (from `esData.exp` on live calc, or `savedEM.date` / `rec.date` from cache).

---

### Key Variables & IDs

| ID / Variable | Purpose |
|---|---|
| `#daily-em-panel` | The whole panel DOM element |
| `#em-es-ref` | Shows `cls: 7400.25` (close price) |
| `#em-es-1up` / `#em-es-1dn` | UP / DN targets |
| `#em-es-range` | EM in points |
| `#em-es-pct` | EM as % of close |
| `#em-es-debug` | Debug line (hidden in snapshot) |
| `nav_daily_em_v1` | localStorage cache key |
| `data/em-cache.json` | Proxy disk cache (persists restarts) |
| `window._dailyEMExpDate` | Expiration date shown in COPY SNAP |
| `EM_CACHE_KEY` | Constant = `'nav_daily_em_v1'` |

---

### Common Failures & Fixes

**All values show X**
- Check `data/em-cache.json` — if empty or no entry for today/Monday, no data was saved at 4pm
- On a weekend: proxy must have saved an entry. Run `fetch('/proxy/api/em/latest').then(r=>r.json()).then(console.log)` in console to check
- Fix: wait for a weekday 4pm session, or manually POST to `/proxy/api/em/{date}`

**ESM6 UP/DN show X, NQM6 fine**
- `showClose` in `render()` is false for `pfx='es'`
- Check that `futClose` (closes.es from Yahoo) is > 0
- Run `fetch('/proxy/api/tt/em-closes').then(r=>r.json()).then(console.log)` — verify `data.es` is non-zero

**`[NavEM] failed: no valid straddle for NDX in [YYYY-MM-DD]`**
- The option chain for that expiration date returned no usable prices
- On a weekend this error should NOT appear (the weekend guard prevents live chain fetches)
- If it does appear on a weekend: `forceRefresh` may have been called. Check the RECALC button isn't auto-clicking
- On a weekday: chain prices may be all zero pre-market — the marks fallback should catch it. Check `/proxy/api/tt/option-marks` is responding

**Proxy EM data not found for correct date**
- Check what keys exist: `fetch('/proxy/api/em/latest').then(r=>r.json()).then(d=>console.log(d.date, d))`
- If saved under wrong date (e.g., Friday instead of Monday), `getCacheKeyDate()` was not returning next-weekday during the 4–6pm save
- Verify `isInEmWindow()` returns true between 4:00–6:00pm ET on weekdays

**`nextTradingDay()` returning a Sunday**
- Date arithmetic bug: always use UTC methods (`getUTCDay`, `setUTCDate`) anchored to `today + 'T12:00:00Z'`
- Never mix `getDate()`/`getDay()` (local) with `toISOString()` (UTC) — timezone offset causes off-by-one near midnight

---

### Proxy Endpoints Used by This Panel

```
GET  /proxy/api/tt/em-closes               — Yahoo Finance closes (spx, es, ndx, nq)
GET  /proxy/api/tt/em-closes?closeDate=YYYY-MM-DD  — specific date close
GET  /proxy/api/tt/chains/SPX?expiration=YYYY-MM-DD&noSubscribe=1
GET  /proxy/api/tt/option-marks?symbols=...
GET  /proxy/api/em/:date                   — load saved EM from disk
GET  /proxy/api/em/latest                  — most recently saved EM entry
POST /proxy/api/em/:date                   — save EM to disk (called at 4pm)
```

**Saved EM POST body:**
```json
{
  "spx": 30.5,
  "ndx": 205.0,
  "spxStrike": 7585,
  "ndxStrike": 30400,
  "spxCall": 16.5,
  "spxPut": 19.2,
  "ndxCall": 118.0,
  "ndxPut": 123.0
}
```

**Disk cache location:** `data/em-cache.json` (relative to proxy root). Keyed by date string `YYYY-MM-DD`.
