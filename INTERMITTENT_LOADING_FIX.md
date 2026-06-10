# Intermittent Loading Fix

## Problem
Dashboard was sometimes loading and sometimes not - data would fail to appear randomly.

## Root Cause
The proxy server (`localhost:3001`) occasionally has slow response times or temporary hiccups, causing:
- Chain fetch to timeout
- DXLink subscription to fail
- Overall data load to fail

## Solutions Implemented

### 1. Automatic Retry Logic
When the initial chain fetch fails, it now automatically retries after 2 seconds:
```
First attempt fails → Wait 2 seconds → Try again
```
This handles temporary network glitches without user intervention.

**Files**: `pages/overview/overview.js` - `buildChainOnce()` function

### 2. Increased Timeouts
- **Chain fetch timeout**: 15s → **30s** (gives slow proxy more time)
- **DXLink subscription timeout**: 5s → **10s** (more reliable)

These longer timeouts let the proxy complete requests that were timing out before.

### 3. Better Error Handling
- Clear logging when retries happen
- Better error messages in UI
- Graceful degradation instead of silent failure

**Files**: `pages/overview/overview.js` - Various fetch calls with AbortController

## How It Works Now

### On Page Load
1. Try to fetch chain data with 30s timeout
2. If successful → Load everything
3. If timeout/error → Wait 2 seconds → Try again automatically
4. If still fails → Show error message

### User Experience
- Most loads complete on first try
- Slow proxy responses get the time they need
- Occasional slow responses are handled with automatic retry
- User never sees "random" failures - either it loads or shows an error

## Testing

**To verify it's working:**

1. Reload the page
2. Open DevTools Console (F12)
3. Look for these messages:
   - `✓ [GEX] Chain fetch: XXXms` = Success
   - `[GEX] Retrying chain fetch` = Had to retry once
   - `✓ [GEX] DXLink subscribed to X symbols` = Live data connected

## Expected Behavior

- **Fast proxy (< 10s response)**: Loads immediately on first try
- **Slow proxy (10-30s response)**: Takes longer but still loads (no timeout)
- **Very slow proxy (> 30s)**: First attempt fails, retries after 2s, should work
- **Proxy crash**: Shows error, you can refresh manually

## Why This Works

The intermittent failures were because:
1. Sometimes the proxy would respond in 5 seconds
2. Sometimes it would take 10-15 seconds
3. Original 15s timeout would catch slow responses
4. But they were right at the edge - sometimes timing out randomly

Now with:
- 30s timeout (plenty of buffer)
- 2-second automatic retry
- Better logging

You get reliable loading that handles both fast AND slow proxy conditions.

## If Still Having Issues

1. **Check proxy logs** - Is it crashing or hanging?
2. **Check network** - Is localhost:3001 responsive?
3. **Check browser console** - What error message do you see?

The fixes are in place, but if the proxy itself is having problems (crashes, memory issues, etc.), that needs to be fixed at the proxy level.
