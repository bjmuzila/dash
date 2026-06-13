# Subscription Manager Implementation

## The Problem

Pages hardcode arbitrary waits hoping dxLink data arrives:

```javascript
// estimated-moves.js line 509
await new Promise(r=>setTimeout(r, 4000));  // "Wait 4 seconds and pray"
```

```javascript
// mult-greek.js
fetch('/proxy/api/tt/chains/SPX?expiration=...&noSubscribe=1')
// Returns immediately with stale cache, zeros, or estimates
```

**Result**: Inconsistent load times, race conditions, unpredictable behavior.

---

## Solution: Subscription Manager with State Notifications

### Architecture

```
Browser Page                 Proxy Server
─────────────────────────────────────────────

1. fetch(chain)  ────────→   GET /proxy/api/chains/SPX
                                ├─ Check cache
                                ├─ Return structure
                                └─ Call subscriptionManager.request('SPX', symbols)

2. await ready  ←────────    POST /proxy/api/subscription-ready
                                Wait for state change
                                (return when 60% of symbols have data)

3. render()                  Update DOM with live data
                             Listen to dxlink-update events

dxLink tick     ────────→    broadcast({ type: 'dxlink-update', ... })
                             ├─ Send to all pages
                             └─ Update window.dxGreeksCache
```

---

## Implementation

### 1. Subscription Manager State Machine

**In proxy-tastytrade.js:**

```javascript
// ─── Subscription Manager ─────────────────────────────────────────────────
const subscriptionManager = {
  // All symbols currently subscribed to dxLink
  activeSubscriptions: new Set(),
  
  // What's being requested by pages: sym → { dataReady: boolean, waiters: [callbacks] }
  subscriptionState: new Map(),
  
  // Track which page requested what: pageId → { symbols, requested: Date, lastCheck: Date }
  pageRequests: new Map(),
  
  /**
   * Register a page's interest in symbols
   * Returns: promise that resolves when data is ready
   */
  request(pageId, symbols, options = {}) {
    const { timeout = 5000, threshold = 0.6 } = options;
    
    // Register this page's interest
    this.pageRequests.set(pageId, {
      symbols: new Set(symbols),
      requested: Date.now(),
      lastCheck: Date.now(),
      threshold
    });
    
    // Subscribe any NEW symbols to dxLink
    const newSymbols = symbols.filter(sym => !this.activeSubscriptions.has(sym));
    if (newSymbols.length > 0) {
      log(`[SubscriptionMgr] Adding ${newSymbols.length} new subscriptions for page ${pageId}`);
      newSymbols.forEach(sym => {
        addAutoSubscription(sym, ['Quote','Greeks','Summary','Trade']);
      });
      sendSubscriptionsRateLimited();
    }
    
    // Return promise that resolves when ready or timeout
    return this.waitForReady(symbols, timeout, threshold);
  },
  
  /**
   * Wait for symbols to have data in cache
   */
  async waitForReady(symbols, timeoutMs, threshold = 0.6) {
    const started = Date.now();
    const requiredCount = Math.max(1, Math.floor(symbols.length * threshold));
    
    while (Date.now() - started < timeoutMs) {
      let readyCount = 0;
      
      for (const sym of symbols) {
        // Symbol is ready if it has Greeks OR Summary data
        const greeks = dxGreeksCache[sym];
        const summary = dxSummaryCache[sym];
        const hasData = (greeks && Object.keys(greeks).length > 0) ||
                       (summary && Object.keys(summary).length > 0);
        if (hasData) readyCount++;
      }
      
      if (readyCount >= requiredCount) {
        log(`[SubscriptionMgr] Ready: ${readyCount}/${symbols.length} symbols have data`);
        return { ready: true, count: readyCount, total: symbols.length };
      }
      
      await sleep(100);
    }
    
    // Timeout — return what we have
    let readyCount = 0;
    for (const sym of symbols) {
      const greeks = dxGreeksCache[sym];
      const summary = dxSummaryCache[sym];
      const hasData = (greeks && Object.keys(greeks).length > 0) ||
                     (summary && Object.keys(summary).length > 0);
      if (hasData) readyCount++;
    }
    
    log(`[SubscriptionMgr] Timeout: ${readyCount}/${symbols.length} symbols have data (returning anyway)`);
    return { ready: false, timeout: true, count: readyCount, total: symbols.length };
  },
  
  /**
   * Called when dxLink data arrives, updates state
   */
  onDataArrival(symbol) {
    // Update internal tracking
    const state = this.subscriptionState.get(symbol);
    if (state) {
      state.dataReady = true;
      state.arrivedAt = Date.now();
    }
  },
  
  /**
   * Clean up stale page requests (no request in 5 minutes)
   */
  cleanup() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000;
    
    for (const [pageId, data] of this.pageRequests) {
      if (now - data.lastCheck > timeout) {
        log(`[SubscriptionMgr] Removing stale page: ${pageId}`);
        this.pageRequests.delete(pageId);
      }
    }
    
    // Optionally: unsubscribe symbols that no page needs
    // (implement if memory becomes an issue)
  }
};

setInterval(() => subscriptionManager.cleanup(), 60000);  // every minute
```

### 2. REST Endpoint: `/proxy/api/subscription-ready`

**In proxy-tastytrade.js request handler:**

```javascript
if (req.method === 'POST' && p === '/proxy/api/subscription-ready') {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body);
      const { pageId, symbols, timeout = 5000, threshold = 0.6 } = parsed;
      
      const result = await subscriptionManager.request(
        pageId,
        symbols,
        { timeout, threshold }
      );
      
      return sendJSON(res, 200, {
        ready: result.ready,
        timeout: result.timeout || false,
        readyCount: result.count,
        totalCount: result.total,
        symbols
      });
    } catch (e) {
      return sendJSON(res, 400, { error: e.message });
    }
  });
  return;
}
```

### 3. Update `/proxy/api/tt/chains/{symbol}` Endpoint

**Modify to use subscription manager:**

```javascript
if (req.method === 'GET' && p.startsWith('/proxy/api/tt/chains/')) {
  let sym = decodeURIComponent(p.slice('/proxy/api/tt/chains/'.length).split('?')[0]);
  const pageId = u.searchParams.get('pageId') || 'unknown';
  const subscribe = u.searchParams.get('subscribe') !== '0';
  const timeout = parseInt(u.searchParams.get('timeout') || '5000', 10);
  
  // ... existing chain fetch logic ...
  
  // Tell subscription manager we need these
  const streamerSyms = subscribeOptions.map(o => o['streamer-symbol']).filter(Boolean);
  
  if (subscribe && streamerSyms.length > 0) {
    // Register interest and wait for data
    const { ready, count, total } = await subscriptionManager.request(
      pageId,
      streamerSyms,
      { timeout, threshold: 0.5 }
    );
    
    log(`[chains] pageId=${pageId} requested=${streamerSyms.length}, ready=${count}/${total}`);
  }
  
  // Build and return response
  // (enriched with whatever data is in cache, even if not all ready)
  return sendJSON(res, 200, { data: { items, underlyingPrice, symbol: sym, rootSymbol } });
}
```

---

## Browser Side Changes

### Before (scattered waits)

```javascript
// estimated-moves.js
await fetch('/proxy/dxlink/subscribe', { body: JSON.stringify({ symbols: [...] }) });
await new Promise(r=>setTimeout(r, 4000));  // Random hardcoded wait
```

### After (coordinated)

```javascript
// All pages: shared initialization
const pageId = 'estimated-moves-' + Date.now();

async function loadChainWithData(symbol, expiration) {
  try {
    // 1. Fetch chain structure
    const chainResp = await fetch(`/proxy/api/tt/chains/${symbol}?expiration=${expiration}&pageId=${pageId}`);
    const chain = await chainResp.json();
    
    // 2. Wait for subscription to be ready
    const readyResp = await fetch('/proxy/api/subscription-ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageId,
        symbols: chain.data.items.flatMap(exp => exp.strikes.map(s => s.call?.['streamer-symbol'] || s.put?.['streamer-symbol'])),
        timeout: 5000,
        threshold: 0.6
      })
    });
    
    const ready = await readyResp.json();
    console.log(`Ready: ${ready.readyCount}/${ready.totalCount} symbols have data`, ready.timeout ? '(timeout)' : '');
    
    // 3. Render with whatever data we have
    renderChain(chain);
    
    // 4. Listen for updates (Greeks will arrive and update UI)
    window.addEventListener('dxlink-update', (e) => {
      if (chain.data.items.some(exp => 
        exp.strikes.some(s => 
          (s.call?.['streamer-symbol'] === e.detail.eventSymbol) ||
          (s.put?.['streamer-symbol'] === e.detail.eventSymbol)
        )
      )) {
        updateStrikeRow(e.detail.eventSymbol, e.detail.greeks);
      }
    });
    
  } catch (e) {
    console.error('Failed to load chain:', e);
  }
}

// Usage
await loadChainWithData('SPX', '2026-06-20');
```

---

## Benefits

✅ **No more hardcoded waits** (4000ms, 2000ms, guessing)  
✅ **Deterministic ready state** (subscription manager tells you when data arrives)  
✅ **Shared subscriptions** (multiple pages don't duplicate)  
✅ **Clear state tracking** (debug which pages need what)  
✅ **Automatic cleanup** (stale requests removed)  
✅ **Timeout safety** (returns what you have, doesn't hang forever)  
✅ **Observable** (log which symbols are ready, which timed out)

---

## Debugging

Enable verbose logging:

```javascript
// proxy-tastytrade.js
const SUBSCRIPTION_DEBUG = process.env.SUBSCRIPTION_DEBUG === '1';

if (SUBSCRIPTION_DEBUG) {
  log(`[SubscriptionMgr] request from ${pageId}: ${symbols.join(', ')}`);
  log(`[SubscriptionMgr] waiting for ${requiredCount}/${symbols.length} symbols`);
  // etc
}
```

Browser DevTools to monitor:

```javascript
// In console on page
window.addEventListener('dxlink-update', (e) => {
  console.log('[dxlink-update]', e.detail.eventSymbol, e.detail);
});

// Monitor network
// Watch POST /proxy/api/subscription-ready requests and responses
```

---

## Rollout Plan

### Phase 1: Infrastructure (no visible changes)
- [ ] Add subscriptionManager code to proxy
- [ ] Add cleanup timer
- [ ] Add POST /proxy/api/subscription-ready endpoint
- [ ] Test with curl/Postman

### Phase 2: Update First Page
- [ ] Pick one page (mult-greek easiest, it doesn't currently wait)
- [ ] Add `pageId` to chain fetch
- [ ] Add subscriptionManager.request() call
- [ ] Remove hardcoded waits
- [ ] Test loading speed
- [ ] Test that Greeks arrive live

### Phase 3: Update Remaining Pages
- [ ] estimated-moves: replace 4000ms wait with subscriptionManager
- [ ] options-chain page
- [ ] insights pages
- [ ] others

### Phase 4: Optimize
- [ ] Monitor subscription state in production
- [ ] Tune `threshold` (how many symbols must be ready before returning)
- [ ] Tune `timeout` values
- [ ] Add metrics/logging

---

## Expected Behavior After Implementation

**Page 1 (mult-greek):**
- Click "GO"
- Waits 100-300ms for Greeks to arrive
- Renders with live data
- Continues updating as market ticks arrive

**Page 2 (estimated-moves):**
- Click "Start"
- Waits 100-300ms for Greeks to arrive (not 4 seconds!)
- Renders with live data
- Both pages share same subscriptions

**Both Pages Simultaneously:**
- Open both at once
- Single subscription to dxLink for all symbols
- Both get data at same time
- No redundant API calls
