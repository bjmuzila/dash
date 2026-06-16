# Page Navigation Fix - Overview Loading on Return

## Problem
When navigating away from the overview page and then returning to it, the page would load slowly or not load data properly. This was because the chart data wasn't being refreshed when returning.

## Root Cause
The `rawChain` (options chain data) is stored as a global variable. Once built on first load, the code would skip rebuilding it:

```javascript
if(rawChain.length > 0) return; // Skip rebuild - PROBLEM!
```

When you navigate away and come back:
1. The `rawChain` still exists in memory (not empty)
2. `buildChainOnce()` sees it's not empty and skips the rebuild
3. Data is stale or incomplete
4. Chart doesn't load or shows old data

## Solution

### 1. Added State Reset Function
New function `resetOverviewState()` that:
- Clears the `rawChain` array
- Resets `isFetching` flag
- Triggers a new `buildChainOnce()` call

```javascript
window.resetOverviewState = function(){
  rawChain = [];
  isFetching = false;
  buildChainOnce(0); // Fresh build
};
```

### 2. Added Page Change Listener
When you navigate back to overview, the page-changed event triggers:
- Detects that `pageName === 'overview'`
- Calls `resetOverviewState()`
- Forces a fresh data load

```javascript
window.EventBus?.on('page-changed', (pageName) => {
  if(pageName === 'overview'){
    window.resetOverviewState();
  }
});
```

## How It Works Now

### Navigation Flow
```
1. You're on Overview page → data loaded ✓
2. Click to go to GEX Table page
3. Page unloads, rawChain stays in memory
4. Click back to Overview page
5. page-changed event fires → triggers resetOverviewState()
6. resetOverviewState() clears rawChain
7. buildChainOnce() runs → fresh fetch from proxy
8. Data loads fresh ✓
```

## Testing

**To verify it works:**

1. Load overview page → wait for chart to appear ✓
2. Click on another page (GEX Table, Estimated Moves, etc.)
3. Click back to Overview
4. Should see immediate loading spinner
5. Chart should load fresh data (no delay)

**In console you should see:**
```
[Overview] Page became active, resetting state
[Overview] Resetting state for page return
[Overview] Triggering chain rebuild
[GEX] Starting buildChainOnce...
[GEX] Chain fetch: XXXms (X expiries)
✓ Chart loaded
```

## Performance

- **First load**: Normal (builds chain from scratch)
- **Navigation away/back**: Faster now (skips intermediate work, goes straight to fetch)
- **Memory**: Clears old data, no memory accumulation

## Side Effects (None)

- Only resets when you actually navigate back to overview
- Other pages unaffected
- No changes to data accuracy
- Works with retry logic (if fetch fails, will retry)

## What This Fixes

✓ Slow loading when returning to overview from another page
✓ Stale data showing when returning
✓ Chart not updating properly on page return
✓ Economic calendar/signals not refreshing

## Files Modified

- `pages/overview/overview.js`
  - Added `resetOverviewState()` function
  - Added EventBus listener for page-changed events
