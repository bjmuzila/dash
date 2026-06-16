# Diagnostic Guide - Loading Issues

## What's Required for the Dashboard to Load

The dashboard has multiple layers of dependencies:

### 1. **Backend Proxy Server** (CRITICAL)
- **Required**: `http://localhost:3001` must be running
- **Provides**: 
  - `/token` - Authentication token
  - `/proxy/api/tt/chains/$SPX` - Options chain data
  - `/proxy/dxlink/subscribe` - Real-time quote subscriptions
  - Other API proxies

**Status Check**: Open DevTools Console (F12) and look for these messages:
- ✓ `[GEX] Starting buildChainOnce...` - Proxy server detected
- ✗ `[buildChainOnce] No accessToken - cannot proceed` - Proxy server NOT running

### 2. **TastyTrade/Schwab Account Data**
- Dashboard requires live options chain data from your broker
- If proxy is running but returning no data, your API credentials may need refresh

### 3. **DOM Elements** 
- Page waits for `#overview-canvas` to exist before loading data
- Has 5-second fallback timeout

---

## What to Check if Data Isn't Loading

### Step 1: Open Browser Console (F12)
Press `F12` → Click "Console" tab

### Step 2: Look for These Log Messages
```
✓ GOOD - You should see:
[GEX] Starting buildChainOnce...
[GEX] Chain fetch: 1234ms (5 expiries)
✓ Overview DOM ready — initiating first TastyTrade fetch

✗ BAD - You'll see:
[buildChainOnce] No accessToken - cannot proceed
(This means proxy server isn't running)

OR

Fetch error / Network timeout
(This means proxy server is running but unreachable)
```

### Step 3: Check Proxy Server Status
```bash
# If you're running the proxy locally:
# Check if process is running on port 3001
lsof -i :3001    # macOS/Linux
netstat -an | findstr 3001  # Windows

# Try accessing it directly:
curl http://localhost:3001/token
# Should return JSON with token info, not a connection error
```

### Step 4: Check Each Component Loading
The dashboard tries to load several things on page load:

1. **GEX Chart** - Needs `buildChainOnce()` success
2. **Economic Calendar** - Needs `startEconCalendar()` and ECON_EVENTS array
3. **Signal Feed** - Needs `initSignalFeed()` (has fallback messages)
4. **ES Stats** - Needs Google Sheets fetch OR cached data
5. **Heatmap** - Depends on GEX chain data

---

## Recent Improvements Made

1. **Added timeouts** - Prevents indefinite hanging on slow connections
   - Chain fetch: 15 seconds
   - Token fetch: 2 seconds
   - DXLink subscribe: 5 seconds

2. **Added better logging** - Console now shows:
   - What's attempting to load
   - How long each fetch takes
   - Where failures occur

3. **Fallback messages** - Signal feed shows placeholder messages if empty

4. **Debounced chart updates** - Chart now updates every 500ms instead of 150ms (less flicker)

---

## Common Issues & Fixes

### "No signals yet"
- **Normal** on first page load (waiting for market events to generate signals)
- **Fixed**: Now shows "Signal feed is online..." message immediately

### "Economic calendar not showing"
- **Cause**: Quote-of-day fetch was blocking calendar render
- **Fixed**: Calendar now renders immediately, quote loads in background

### "Chart keeps changing constantly"
- **Cause**: Updating every 150ms on every data tick
- **Fixed**: Now updates every 500ms (batched updates)

### "Nothing loads at all"
- **Cause**: Proxy server not running at localhost:3001
- **Fix**: Start your proxy server
  ```bash
  npm start  # or whatever starts your proxy
  ```

---

## How to Debug Further

### Enable Debug Logging
Add this to browser console:
```javascript
// See all network requests
fetch = (function(originalFetch) {
  return function(...args) {
    console.log('[FETCH]', args[0]);
    return originalFetch.apply(this, args);
  };
})(fetch);
```

### Check Network Tab
1. Open DevTools → Network tab
2. Reload page
3. Look for failed requests (red X marks)
4. Click each failed request to see status code and error message

### Check localStorage
```javascript
// In console:
localStorage.getItem('signalFeedItems')  // Signal feed cache
// Should return a JSON array if items are stored
```

---

## Status Indicators

Look for the status tag in the top-right of the page:
- **● TT LIVE** - Connected, loading data
- **● Error: ...** - Something failed (hover to see message)
- **No tag** - Still initializing

---

## Still Having Issues?

If data still won't load after checking proxy server:

1. **Check proxy logs** - What errors is the proxy showing?
2. **Check browser console** - Paste any error messages
3. **Verify API credentials** - Are your TastyTrade/Schwab credentials valid?
4. **Network connectivity** - Can you reach localhost:3001 from browser?

Test with:
```javascript
// In console:
fetch('http://localhost:3001/token')
  .then(r => r.json())
  .then(d => console.log('Token fetch succeeded:', d))
  .catch(e => console.error('Token fetch failed:', e))
```
