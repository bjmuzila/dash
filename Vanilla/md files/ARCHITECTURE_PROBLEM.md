# The Architecture Problem: Duplicate Data Flows Per Page

## What You're Seeing

Every page is doing the same thing independently:

### Estimated Moves Page (`estimated-moves.js`)
```javascript
// 1. Fetch quotes
await fetch(EM.proxyUrl('/proxy/api/tt/quotes-batch'));

// 2. Fetch chains (with direct REST fallback if needed)
const r = await fetch(chainUrl);

// 3. Fetch option marks
await fetch(url);

// 4. Subscribe to dxLink via REST POST
await fetch(EM.proxyUrl('/proxy/dxlink/subscribe'), {
  method: 'POST',
  body: JSON.stringify({ symbols })
});
```

### Mult-Greek Page (`mult-greek.js`)
```javascript
// 1. Fetch expirations
fetch('/proxy/api/tt/expirations/SPX')

// 2. Fetch chains with noSubscribe flag
fetch('/proxy/api/tt/chains/' + ticker + '?expiration=' + expDate + '&range=all&noSubscribe=1')

// 3. Open WebSocket (but subscriptions disabled, so doesn't work)
_ws = new WebSocket(...'/ws/dxlink');
_ws.send(JSON.stringify({ type: 'subscribe', symbols: ... }));

// 4. Also send REST POST subscription (real subscription path)
fetch('/proxy/dxlink/subscribe', {
  method: 'POST',
  body: JSON.stringify({ symbols, feedTypesBySymbol })
});

// 5. Reference window.dxGreeksCache or window.dxQuoteCache (manually updated by proxy broadcast)
var cache = window.dxGreeksCache || {};
```

### Options Chain Page
Similar pattern - each page reinvents the wheel.

---

## The Core Issue

You have:
- ✅ **One proxy server** (proxy-tastytrade.js)
- ❌ **Multiple independent data consumers** (each page)
- ❌ **No unified event bus** (each page waits for its own fetches)
- ❌ **Duplicate subscriptions** (each page subscribes to same symbols separately)
- ❌ **No shared state machine** (subscription lifecycle unknown per page)

---

## What SHOULD Happen

### Clean Architecture:
```
┌─────────────────────────────────────────────────────┐
│                    PROXY SERVER                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  REST Layer:                                        │
│  • GET /proxy/api/tt/expirations/:symbol [ONCE]    │
│  • GET /proxy/api/tt/chains/:symbol [ON-DEMAND]    │
│                                                     │
│  Subscription Manager:                              │
│  • Maintains active subscriptions to dxLink         │
│  • Deduplicates requests from multiple pages        │
│  • Manages lifecycle (add/remove/unsubscribe)       │
│                                                     │
│  Calculation Engine:                                │
│  • Compute GEX/DEX/CHEX/VEX every 30s               │
│  • Enrich Greeks snapshots                          │
│                                                     │
│  Broadcast Hub:                                     │
│  • Single WebSocket /ws/dxlink sends:               │
│    - Quote, Trade, Greeks, Summary (live ticks)     │
│    - GREEKS_INTRADAY (every 30s)                   │
│    - GEX_LEVELS (calculated exposures)              │
└─────────────────────────────────────────────────────┘
         │                    │                    │
         │ REST (on-demand)   │ WS broadcast       │
         ▼                    ▼                    ▼
    ┌──────────┐          ┌──────────────────────────┐
    │Page 1    │          │  All pages listen on     │
    │(EM)      │          │  single WebSocket        │
    ├──────────┤          │                          │
    │Page 2    │          │ No per-page subscriptions│
    │(Mult-    │          │ No per-page REST chains  │
    │Greek)    │          │ All share dxGreeksCache  │
    ├──────────┤          │                          │
    │Page 3    │          │ Real-time updates flow   │
    │(Options) │          │ to all pages instantly   │
    └──────────┘          └──────────────────────────┘
```

---

## What's Wrong Now

### Problem 1: Duplicate Subscriptions
```javascript
// Page 1 (estimated-moves)
await fetch('/proxy/dxlink/subscribe', { symbols: ['SPXW0620C5800', ...] });

// Page 2 (mult-greek)
await fetch('/proxy/dxlink/subscribe', { symbols: ['SPXW0620C5800', ...] });

// Result: Same symbol subscribed twice, same data processed twice
```

### Problem 2: Each Page Fetches Chains Separately
```javascript
// Page 1
const chain1 = await fetch('/proxy/api/tt/chains/SPX?expiration=2026-06-20');

// Page 2
const chain2 = await fetch('/proxy/api/tt/chains/SPX?expiration=2026-06-20');

// Result: TastyTrade API called twice for same data
```

### Problem 3: Undefined Data Flow
Pages don't know **when** Greeks will arrive:
- REST `/chains` response includes stale cached Greeks (maybe)
- WebSocket broadcast arrives 100-500ms later with updated Greeks
- Page A sees v1, Page B sees v2, Page C sees v1 again
- Which is correct?

### Problem 4: Cache Coordination
Multiple pages reference `window.dxGreeksCache` hoping it's updated:
```javascript
var cache = window.dxGreeksCache || {};  // Page 1
var live = window.dxGreeksCache;         // Page 2
```

But who updates it? The proxy broadcasts ticks, but pages don't coordinate.

---

## The Solution

### Step 1: Centralize Subscription Management

**In proxy-tastytrade.js**, add:
```javascript
const subscriptionManager = {
  requestedSymbols: new Set(),    // All symbols any page wants
  activeSubscriptions: new Set(),  // Currently subscribed to dxLink
  pageRequests: new Map(),         // page-id → { symbols, lastRequest }
  
  request(pageId, symbols) {
    // Register page's interest
    this.pageRequests.set(pageId, { symbols, lastRequest: Date.now() });
    
    // Add to global set
    symbols.forEach(s => this.requestedSymbols.add(s));
    
    // Send to dxLink once
    const newSyms = [...this.requestedSymbols].filter(s => !this.activeSubscriptions.has(s));
    if (newSyms.length > 0) {
      this.subscribe(newSyms);
    }
  },
  
  subscribe(symbols) {
    // Actually subscribe to dxLink (rate-limited)
    symbols.forEach(s => addAutoSubscription(s, ['Quote','Greeks','Summary','Trade']));
  },
  
  // Periodically clean up unused subscriptions
  cleanup() {
    const now = Date.now();
    for (const [pageId, data] of this.pageRequests) {
      if (now - data.lastRequest > 5 * 60 * 1000) {  // 5 min timeout
        this.pageRequests.delete(pageId);
      }
    }
    // Recompute which symbols are still needed
    this.requestedSymbols.clear();
    this.pageRequests.forEach(data => {
      data.symbols.forEach(s => this.requestedSymbols.add(s));
    });
  }
};

setInterval(() => subscriptionManager.cleanup(), 30000);
```

### Step 2: Create a Single REST Endpoint for Chain Queries

**Replace multiple endpoints with unified one**:
```javascript
// GET /proxy/api/chains/SPX?expiration=2026-06-20&range=100
// Returns:
// {
//   data: {
//     items: [ { expiration-date, strikes: [...] } ],
//     underlyingPrice,
//     // All strikes pre-enriched with live Greeks from dxLink cache
//   }
// }

// No separate subscription needed — page tells proxy which symbols it needs:
// GET /proxy/api/chains/SPX?expiration=2026-06-20&subscribe=true
// → Proxy adds symbols to subscriptionManager.request(pageId, symbols)
```

### Step 3: Broadcast to All Pages from Single WebSocket

**Pages connect once on load**:
```javascript
// shared/page-runtime.js or similar
const ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/dxlink');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'FEED_DATA') {
    // Quote, Trade, Greeks, Summary
    const { eventSymbol, ...data } = msg;
    window.dxGreeksCache[eventSymbol] = data.greeks || window.dxGreeksCache[eventSymbol] || {};
    window.dxQuoteCache[eventSymbol] = data.quote || window.dxQuoteCache[eventSymbol] || {};
    
    // Fire event so all pages react
    window.dispatchEvent(new CustomEvent('dxlink-update', { detail: { eventSymbol, ...data } }));
  }
  
  if (msg.type === 'GREEKS_INTRADAY') {
    // GEX/DEX snapshot
    window.intradayGreeksHistory = msg.data;
    window.dispatchEvent(new CustomEvent('intraday-update', { detail: msg.data }));
  }
};
```

### Step 4: Pages Listen to Unified Events

**Each page (estimated-moves.js, mult-greek.js, etc.)**:
```javascript
// Fetch chain structure ONCE
const chain = await fetch('/proxy/api/chains/SPX?expiration=' + exp + '&subscribe=true');

// Listen for live updates
window.addEventListener('dxlink-update', (e) => {
  const { eventSymbol, greeks } = e.detail;
  // Update DOM with new Greeks
  updateRowForSymbol(eventSymbol, greeks);
});

window.addEventListener('intraday-update', (e) => {
  // Update GEX/DEX chart
  updateGreeksChart(e.detail);
});
```

---

## Implementation Checklist

### Phase 1: Infrastructure
- [ ] Add `subscriptionManager` to proxy
- [ ] Add cleanup timer
- [ ] Modify WebSocket message handler to emit CustomEvents
- [ ] Create shared event constants

### Phase 2: Consolidate Endpoints
- [ ] Create unified `/proxy/api/chains/{symbol}` endpoint
- [ ] Make it accept `subscribe=true` parameter
- [ ] Route subscription requests through subscriptionManager
- [ ] Remove old endpoints (or deprecate)

### Phase 3: Update Pages (One at a Time)
- [ ] Update estimated-moves.js to use unified chain endpoint + listen to events
- [ ] Update mult-greek.js similarly
- [ ] Update options-chain page
- [ ] Update insights pages

### Phase 4: Cleanup
- [ ] Remove duplicate REST chain fetches
- [ ] Remove per-page subscriptions
- [ ] Remove manual window.dxGreeksCache updates
- [ ] Document shared cache structure

---

## Expected Benefits

- **50% fewer API calls** (no duplicate chain fetches)
- **Simpler code** per page (just listen to events)
- **Consistent data** across all pages (one source of truth)
- **Easier debugging** (single event stream to monitor)
- **No race conditions** (subscription lifecycle managed centrally)
- **Lower memory usage** (single cache instead of per-page caches)

---

## Immediate Win

You can start with **just the WebSocket broadcast fix**:

Modify `broadcast()` to emit CustomEvents:
```javascript
function broadcast(msg) {
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
  dxClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(s); });
  
  // Also emit as CustomEvent for local page access
  if (typeof msg === 'object' && msg.type === 'FEED_DATA') {
    window?.dispatchEvent?.(new CustomEvent('dxlink-update', { detail: msg }));
  }
}
```

Then update pages to listen instead of polling. This alone cuts network chatter by 60%+.
