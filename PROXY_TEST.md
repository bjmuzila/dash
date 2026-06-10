# Proxy Server Test Guide

## Quick Test - Run These in Browser Console

### Test 1: Check if Proxy is Responding
```javascript
fetch('http://localhost:3001/health')
  .then(r => r.text())
  .then(d => console.log('✓ Proxy responsive:', d))
  .catch(e => console.error('✗ Proxy not responding:', e.message))
```

### Test 2: Try the Chain Endpoint (What the Page Actually Uses)
```javascript
fetch('http://localhost:3001/proxy/api/tt/chains/$SPX?range=all')
  .then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .then(d => console.log('✓ Chain data available:', d.data?.items?.length, 'expiries'))
  .catch(e => console.error('✗ Chain fetch failed:', e.message))
```

### Test 3: Check What Endpoints Exist
```javascript
// Try common endpoints
const endpoints = [
  '/health',
  '/proxy/health',
  '/proxy/api/tt/chains/$SPX',
  '/proxy/token',
  '/api/health'
];

for (const ep of endpoints) {
  fetch(`http://localhost:3001${ep}`)
    .then(r => console.log(`${ep}: ${r.status}`))
    .catch(e => console.log(`${ep}: FAIL (${e.message})`));
}
```

---

## Understanding the 404 Error

**What you saw:**
```
GET http://localhost:3001/token 404 (Not Found)
```

**Why:** The endpoint is actually at `/proxy/token` not `/token`. This has been fixed in the code.

**Is this a problem?** 
- **NO** for automatic loading - that endpoint is only used for OAuth flow
- The page sets `accessToken = 'tastytrade-via-proxy'` directly without needing the token endpoint

---

## What the Page Actually Needs

On page load, these endpoints MUST work:

1. **Chain Data** (Required for GEX)
   ```
   http://localhost:3001/proxy/api/tt/chains/$SPX?range=all
   ```
   - Should return: `{ data: { items: [ {...}, {...} ] } }`
   - Status: 200 OK

2. **Quote Data** (Optional but nice to have)
   ```
   http://localhost:3001/proxy/api/tt/quotes-batch?symbols=SPX,NDX
   ```
   - Should return: Quote data for symbols

3. **DXLink Subscribe** (For live updates)
   ```
   POST http://localhost:3001/proxy/dxlink/subscribe
   ```
   - Should return: 200 OK or websocket connection

---

## If Chains Endpoint Returns 404

Your proxy server exists but doesn't have the TastyTrade connector set up. Options:

1. **Use Demo/Mock Mode** - Modify the code to use hardcoded mock data
2. **Configure Proxy** - Set up the TastyTrade API keys in your proxy server
3. **Check Proxy Logs** - What does the proxy server show?

---

## Quick Diagnostic

Run this in console and share the results:

```javascript
async function diagnose() {
  console.log('=== PROXY DIAGNOSTIC ===');
  
  const tests = [
    { name: '/health', url: 'http://localhost:3001/health' },
    { name: '/proxy/api/tt/chains/$SPX', url: 'http://localhost:3001/proxy/api/tt/chains/$SPX' },
    { name: '/proxy/token', url: 'http://localhost:3001/proxy/token' },
  ];
  
  for (const test of tests) {
    try {
      const r = await fetch(test.url);
      console.log(`${test.name}: ${r.status} ${r.statusText}`);
      if (r.ok) {
        const data = await r.json();
        console.log(`  Response keys: ${Object.keys(data).join(', ')}`);
      }
    } catch (e) {
      console.log(`${test.name}: ERROR - ${e.message}`);
    }
  }
}

diagnose();
```

---

## Expected Results if Everything Works

```
=== PROXY DIAGNOSTIC ===
/health: 200 OK
  Response keys: status, version, timestamp
/proxy/api/tt/chains/$SPX: 200 OK
  Response keys: data, success, timestamp
/proxy/token: 401 Unauthorized (expected - needs auth)
✓ Page should now load data!
```

---

## Next Steps

1. **Run the diagnostic above** and share the results
2. **Check proxy server logs** - What errors is it showing?
3. **Verify proxy has credentials** - TastyTrade/Schwab API keys configured?

The 404 on `/token` endpoint is a minor issue (already fixed). The real question is whether `/proxy/api/tt/chains/$SPX` returns data or 404.
