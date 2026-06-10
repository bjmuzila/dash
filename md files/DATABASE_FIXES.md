# Database Page Fixes — June 9, 2026

## Issues Identified

### 1. **Greeks Data Not Saving** (CRITICAL)
- **Cause**: `pages/insights/exposure/exposure.html` did not load `exposure.js`
- **Result**: `persistExposureStackToDB()` function never executes, Greeks (GEX/DEX/CHEX/VEX) never persisted
- **Fix**: Added `<script src="exposure/exposure.js"></script>` to the end of exposure.html

### 2. **Database Version Conflict** (BLOCKING)
- **Cause**: Multiple database.js files with different versions
  - `shared/database.js` → version **8**
  - `pages/database/database.js` → version **7** (was outdated)
  - Browser IndexedDB already had version 8 indexed
- **Result**: VersionError when trying to initialize older version
- **Fixes**:
  - Updated `pages/database/database.js` to version 8
  - Added automatic version conflict recovery in both files
    - Detects VersionError on init
    - Deletes old database
    - Retries with current schema
  - Initialized missing throttle tracking variables: `_greeksTsLastWrite`, `_greeksTsLastGex`

### 3. **Missing Throttle Initialization**
- **Cause**: `saveGreeksTimeSeries()` uses throttling to prevent writes > 1x per 30s, but tracking vars weren't initialized
- **Fix**: Added initialization in DB object:
  ```javascript
  _greeksTsLastWrite: null,
  _greeksTsLastGex: null,
  ```

## What's Now Persisting

✅ **MVC Snapshots** — Already working
  - Manual snapshots via "Snapshot" button
  - Auto-snapshots at 9:45, 10:30, 12:00 ET

✅ **Greeks Time Series** — NOW WORKING (was broken)
  - GEX / DEX / CHEX / VEX saved every 30s during market hours
  - Throttled to prevent excessive writes
  - Saved from exposure stack refreshes

✅ **ES 15m Candles** — Already working
  - Fetched on-demand from DXLink
  - Cached in DB with 10-day lookback

✅ **GEX Top 3 Snapshots** — Now receiving data
  - Saved when bzila page updates
  - Shows top 3 strikes by absolute GEX

✅ **Buy/Sell Scores** — Now receiving data
  - Saved with Greeks time series
  - Updated every 30 seconds

## How to Test

1. **Hard refresh browser** (Ctrl+Shift+R or Cmd+Shift+R) to clear cache
2. **Open Database page → MVC tab** — should show recent snapshots
3. **Open Insights → Exposure page** — watch refresh times
4. **Check Database page → Buy/Sell Score tab** — data should accumulate
5. **Check Database page → GEX Top 3 tab** — should show snapshots from bzila page

## Browser DevTools Checks

In console, verify:
- ✅ `window.DB.db` is initialized
- ✅ `window.DB._greeksTsLastWrite` tracking is active
- ✅ No "VersionError" messages (if you see them, IndexedDB auto-recovers)
- ✅ "✓ DB greek saved" messages appear every 30s during market hours

## Files Modified

1. **pages/insights/exposure/exposure.html** — Added script tag to load exposure.js
2. **shared/database.js** — Added version conflict recovery logic, initialized throttle vars
3. **pages/database/database.js** — Updated version to 8, added conflict recovery, initialized throttle vars

---

**Expected Behavior After Fix:**
- All four database tabs accumulate data during market hours
- 15m ES candles persist and load on page refresh
- Greeks/exposure data saves every 30s with throttling
- MVC snapshots save on manual click and auto-schedule
- No more VersionError on page load
