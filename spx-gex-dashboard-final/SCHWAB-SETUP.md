# SPX GEX Dashboard - Schwab Setup Guide

Your dashboard is now configured with **provider switching** and ready to use with Schwab!

## 📁 Directory Structure

```
/home/claude/spx-gex-dashboard/
├── index.html              # Main shell - loads everything
├── README.md               # Original documentation
├── SCHWAB-SETUP.md         # This file
├── pages/
│   ├── overview.html       # Overview page
│   ├── gex.html           # GEX Strike Ladder
│   ├── bzila.html         # Bzila Flow
│   ├── database.html      # Database
│   ├── trading.html       # Trading/Journaling
│   ├── stats.html         # Stats
│   └── insights.html      # Insights
└── shared/
    ├── api.js             # ✨ Provider switching layer (Schwab configured!)
    ├── app.js             # Global state & utilities
    ├── calculations.js    # GEX/DEX calculations
    └── styles.css         # All CSS
```

## 🔌 Current Provider Configuration

**File:** `shared/api.js`  
**Line 12:** `ACTIVE_PROVIDER: 'schwab'`  
**Line 18:** `USE_PROXY: true` ← Routes through `/proxy/api`

## ✅ Schwab is Already Configured!

The Schwab adapter is set up to use your **local proxy** at `/proxy/api`. This matches your TastyTrade setup.

### What's Configured:
- ✅ Schwab adapter loaded
- ✅ Proxy mode enabled (`/proxy/api`)
- ✅ Quote endpoint: `/proxy/api/schwab/quote/{symbol}`
- ✅ Chain endpoint: `/proxy/api/schwab/chains/{symbol}`

## 🚀 How to Test

### 1. Start Your Web Server

You need a local web server (browser security blocks `file://` URLs):

```bash
# Python 3 (easiest)
cd /home/claude/spx-gex-dashboard
python3 -m http.server 8000

# OR Node.js
npx http-server . -p 8000
```

### 2. Open in Browser

Navigate to: `http://localhost:8000`

### 3. Check Console

Open browser DevTools (F12) and look for:

```
🔌 Loading API provider layer...
🔌 Initializing API provider: Schwab
✓ Schwab adapter initialized
  Mode: Local Proxy (/proxy/api)
✅ Schwab adapter ready
✅ API ready to use
```

### 4. Test an API Call

In the browser console, try:

```javascript
// Test quote fetch
const quote = await window.API.fetchQuote('SPX');
console.log(quote);

// Test options chain fetch
const chain = await window.API.fetchOptionsChain('SPX');
console.log(chain);
```

## 🔧 Adjusting Schwab Response Format

Your Schwab API might return data in a slightly different format than I've assumed. If you get errors or see `undefined` values, you'll need to adjust the transformation functions in `shared/api.js`.

### Finding the Right Fields

1. Open `shared/api.js`
2. Find the `SchwabAdapter` section (starts around line 32)
3. Look at the `transformQuote()` function (line 88)
4. Look at the `transformOptionsChain()` function (line 110)

### Common Adjustments

**If quote data is wrong:**
```javascript
// In transformQuote(), around line 91
const quote = data[symbol] || data.quote || data;

// Adjust these field names to match your Schwab response:
price: quote.lastPrice || quote.last || 0,
change: quote.netChange || quote.change || 0,
// etc.
```

**If options chain is wrong:**
```javascript
// In transformOptionsChain(), around line 121
// Schwab typically uses callExpDateMap and putExpDateMap
// But your format might be different - adjust as needed
const callMap = data.callExpDateMap || {};
const putMap = data.putExpDateMap || {};
```

### Debug Mode

To see exactly what Schwab is returning:

```javascript
// Add this to transformOptionsChain() around line 116:
console.log('Raw Schwab response:', JSON.stringify(data, null, 2));
```

Then check your browser console to see the actual structure.

## 🔄 Switching Between Providers

Edit `shared/api.js` line 12:

**Use Schwab (current setting):**
```javascript
ACTIVE_PROVIDER: 'schwab',
```

**Use Mock data (for testing UI):**
```javascript
ACTIVE_PROVIDER: 'mock',
```

**Use TastyTrade (when ready on Tuesday):**
```javascript
ACTIVE_PROVIDER: 'tastytrade',
```

**Use Polygon (requires API key):**
```javascript
ACTIVE_PROVIDER: 'polygon',
POLYGON_API_KEY: 'your_key_here',
```

Just change that one line, refresh the page, done!

## 📊 What the Adapters Return

All adapters return the same standardized format, so your dashboard code doesn't need to change:

### Quote Format:
```javascript
{
  symbol: 'SPX',
  price: 7425.50,
  change: 15.25,
  changePercent: 0.21,
  bid: 7425.25,
  ask: 7425.75,
  volume: 1234567,
  timestamp: 1234567890
}
```

### Options Chain Format:
```javascript
{
  symbol: 'SPX',
  underlying: {
    price: 7425.50,
    change: 15.25,
    changePercent: 0.21
  },
  options: [
    {
      strike: 7400,
      expiration: '2026-05-17',
      callOI: 1000,
      callVolume: 500,
      callBid: 25.50,
      callAsk: 26.00,
      callLast: 25.75,
      callDelta: 0.52,
      callGamma: 0.001,
      callVega: 0.05,
      callTheta: -0.02,
      callIV: 0.15,
      putOI: 1200,
      putVolume: 600,
      // ... put data
    },
    // ... more strikes
  ],
  expiryMap: {
    '2026-05-17': [ /* options for this date */ ],
    '2026-05-18': [ /* options for this date */ ]
  },
  timestamp: 1234567890
}
```

## 🐛 Troubleshooting

### "API not initialized"
- Check console for initialization errors
- Make sure `shared/api.js` is loaded in `index.html`
- Try refreshing the page

### "Schwab API Error: 404"
- Your proxy server isn't running or isn't routing `/proxy/api/schwab/*`
- Check that your proxy is configured for Schwab endpoints
- Try switching to `mock` to test UI without API

### "Cannot read property 'price' of undefined"
- Schwab response format doesn't match expectations
- Add `console.log` to `transformQuote()` to see raw response
- Adjust field names in transformation functions

### Proxy Not Found
If your proxy uses a different path than `/proxy/api`, change line 18 in `api.js`:
```javascript
PROXY_BASE_URL: '/your/proxy/path'
```

## 📝 Next Steps

1. **Start web server** (Python or Node.js)
2. **Open dashboard** at `http://localhost:8000`
3. **Check console** for successful initialization
4. **Test API calls** in console
5. **Adjust transformations** if needed to match your Schwab format
6. **Switch to TastyTrade on Tuesday** by changing one line!

## 🎯 Benefits of This Setup

✅ **Switch providers with one line** - no code changes needed  
✅ **Works with your local proxy** - same setup as TastyTrade  
✅ **Mock data for testing** - develop UI without API calls  
✅ **Future-proof** - add new providers easily  
✅ **All your pages work** - overview, GEX, bzila, etc.

## 💡 Pro Tips

1. **Start with Mock** to test UI layout and styling
2. **Switch to Schwab** when ready for real data
3. **Keep console open** to see what the API is doing
4. **Use browser DevTools Network tab** to see actual HTTP requests

---

Need help? Check the console logs or let me know what error you're seeing!
