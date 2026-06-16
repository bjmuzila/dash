# Data Flow Analysis: Greeks → Proxy → Calcs → Page

## Overview
Your system has **three data paths** that often overlap and create race conditions:
1. **REST Endpoints** (on-demand, 100–500ms)
2. **WebSocket Relay** (real-time, 10–50ms)
3. **Scheduled Calculations** (batch, every 30s?)

The inconsistency comes from uncertainty about **which path is active when** and **how data is synchronized**.

---

## Path 1: REST Endpoint `/proxy/api/tt/chains/{symbol}`

### Request Flow
```
Browser → GET /proxy/api/tt/chains/SPX?awaitDX=1 → Proxy
```

### Proxy Processing (proxy-tastytrade.js:2971–3189)

1. **Fetch from TastyTrade REST**
   ```
   ttGet(`/option-chains/${rootSymbol}/nested`)  // get expirations
   ttGet(`/option-chains/${rootSymbol}?expiration-date=${expDate}`)  // get all strikes
   ```
   - Returns: `{ symbol, strike, bid/ask, open-interest }`
   - ⚠️ TT REST OI is always 0 (source: line 3116 comment)

2. **Subscription to dxLink** (lines 3078–3090)
   ```javascript
   const newSyms = streamerSyms.filter(sym => !subscriptions.has(sym));
   newSyms.forEach(sym => {
     addAutoSubscription(sym, ['Quote','Greeks','Summary','Trade']);
     queueAutoSubscription({ type: 'Quote',   symbol: sym });
     queueAutoSubscription({ type: 'Greeks',  symbol: sym });
     // ... etc
   });
   sendSubscriptionsRateLimited();
   ```
   - Adds to dxLink subscription queue (not immediate!)
   - If `?awaitDX=1` → waits for live Greeks to populate (line 3093–3096)
   - Without it → returns immediately with cached/fallback values

3. **Enrichment from dxLink Caches** (lines 3129–3173)
   ```javascript
   const greeks  = dxGreeksCache[streamerSym]  || {};
   const summary = dxSummaryCache[streamerSym] || {};
   const quote   = dxQuoteCache[streamerSym]   || {};
   const trade   = dxTradeCache[streamerSym]   || {};
   
   // Fallback to estimate if not in cache
   const fallbackGreeks = estimateOptionGreekFallback(opt, underlyingPrice, side);
   
   const liveDelta = finiteNumber(greeks.delta, opt.delta, opt['delta']);
   const liveGamma = finiteNumber(greeks.gamma, opt.gamma, opt['gamma']);
   ```
   - **Priority chain**: dxLink cache → REST field → fallback estimate
   - If cache miss → returns estimated Greeks (less accurate)

4. **Return Response** (line 3188)
   ```javascript
   return sendJSON(res, 200, { 
     data: { items, underlyingPrice, symbol: sym, rootSymbol }, 
     context: '/option-chains/' + sym + '/nested' 
   });
   ```
   - Format: `{ items: [ { expiration-date, strikes: [ { strike-price, call: {...}, put: {...} } ] } ] }`
   - Each option has calculated Greeks and OI

### Problems with Path 1
- ❌ **No wait guarantee**: Without `?awaitDX=1`, returns stale cache immediately
- ❌ **TT REST OI always 0**: Must wait for dxLink Summary event
- ❌ **Fallback estimates inaccurate**: If symbol never subscribed before
- ❌ **Subscription queue is async**: `queueAutoSubscription()` doesn't guarantee immediate dxLink delivery

---

## Path 2: WebSocket Relay `/ws/dxlink`

### Connection & Subscription

**Browser connects** (proxy-tastytrade.js:3814–3822)
```javascript
wss.on('connection', ws => {
  dxClients.add(ws);
  
  // Send cached quotes immediately
  setTimeout(() => {
    ['SPX','VIX','/ES:XCME', ...].forEach(sym => {
      if (dxQuoteCache[sym]) {
        ws.send(JSON.stringify({ 
          type:'FEED_DATA', 
          data:['Quote',[sym, q.bidPrice, q.askPrice, q.bidSize, q.askSize]] 
        }));
      }
      // Also send Summary, Trade, Greeks...
    });
  }, 200);
});
```

**Browser sends subscription** (line 3862–3869)
```javascript
ws.on('message', async raw => {
  const msg = JSON.parse(raw);
  if (msg.type === 'subscribe' && Array.isArray(msg.symbols)) {
    // ⚠️ DISABLED! 
    log(`[WS] Browser subscribe IGNORED — use REST POST instead`);
    return;
  }
});
```

**Actual subscription via REST POST** (line 3191–3215)
```
POST /proxy/dxlink/subscribe
{ symbols: [...], feedTypesBySymbol: {...} }

→ Proxy queues subscriptions
→ dxLink gets them asynchronously
```

### Live Data Broadcast

When dxSocket receives FEED_DATA (pseudo-code, actual integration in line 74–110):
```javascript
if (msg.type === 'FEED_DATA' && browserClients.size > 0) {
  const feedEvent = {
    type: 'FEED_DATA',
    eventSymbol: msg.eventSymbol,
    price: msg.price,
    bid: msg.bid,
    ask: msg.ask,
    // ...
  };
  
  browserClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(feedEvent));
    }
  });
}
```

### Problems with Path 2
- ❌ **Raw FEED_DATA, not calculated**: Sends `Quote`, `Trade`, `Greeks` separately
- ❌ **No aggregation at proxy**: Browser must correlate Greeks with Quote
- ❌ **Symbol subscription unclear**: Which symbols stay subscribed? When unsubscribe?
- ❌ **Relay integration unclear**: Where exactly does dxSocket broadcast hook in? (proxy-websocket-relay.js comment suggests lines 74–110, but not clear if actually used)

---

## Path 3: Scheduled Intraday Greeks Calculations

### Snapshot Collection (proxy-tastytrade.js:4137+)
```javascript
// "Intraday Greeks snapshot every 30 seconds"
// Every 30 seconds, compute snapshot from dxGreeksCache:
intradayGreeksHistory = [
  { time, ts, gex, dex, chex, vex, buyPct, spot }
];
```

### REST Endpoint `/proxy/api/greeks-intraday` (line 3740–3747)
```
GET /proxy/api/greeks-intraday
→ Returns intradayGreeksHistory filtered by time range
→ Browser renders as chart
```

### WebSocket Push (line 3854–3856)
```javascript
if (intradayGreeksHistory.length > 0) {
  ws.send(JSON.stringify({ 
    type: 'GREEKS_INTRADAY_HISTORY', 
    data: intradayGreeksHistory 
  }));
}
```

### Problems with Path 3
- ❌ **Computation trigger unclear**: Where is the 30-second timer? (Not visible in proxy-tastytrade.js)
- ❌ **Which symbols are included?**: Only 0DTE? All subscribed symbols?
- ❌ **Data source**: Computed from `dxGreeksCache` only? When is this recalculated?
- ❌ **Timing of sends**: When is it pushed to browsers vs. pulled via REST?

---

## Core Subscriptions (Known)

These symbols are **always subscribed** (line 190–202):
```
SPX, VIX, NDX, /ES:XCME, /NQ:XCME, US10Y, 2YY, 2Y, /2YY, TNX, ...
```

When user opens **options chain for a symbol**:
```
1. GET /proxy/api/tt/chains/SPX?awaitDX=1
2. Proxy extracts all streamer-symbols from TT REST response
3. Filters to only NEW symbols (not already subscribed)
4. Calls addAutoSubscription() → queueAutoSubscription() → sendSubscriptionsRateLimited()
5. If awaitDX=1: waits for dxLink Greeks to arrive in cache
```

---

## The Missing Piece: Data Routing Table

**You need to document:**

| Scenario | Trigger | Path | Calculation | Timing | Response |
|----------|---------|------|-----------|--------|----------|
| User clicks "Options" tab | Browser: `API.getSpxChain()` | REST `/proxy/api/tt/chains/{sym}?awaitDX=1` | In proxy: enrich TT REST with dxGreeksCache | 500ms–2s | JSON: nested chain + Greeks |
| User is on page, market updates | dxLink FEED_DATA (Quote, Greeks, Trade, Summary) | WebSocket `/ws/dxlink` | None (raw broadcast) | 10–50ms per event | JSON: single Quote/Greeks/Trade event |
| Browser updates Greeks chart | Browser polls or WS receives | REST `/proxy/api/greeks-intraday` OR WS `GREEKS_INTRADAY_HISTORY` | Proxy computes every 30s (?) | 30s batches (?) | JSON: history array with GEX/DEX |
| GEX levels sent to MotiveWave | Browser calls `pushGexLevels()` | REST `/proxy/api/gex-levels?callWall=X&putWall=Y` | None (just write CSV) | On-demand | CSV file for MotiveWave |

---

## Answers to Key Questions

### ✅ 1. Intraday Greeks: 30-Second Snapshot (FOUND)

**Location**: `proxy-tastytrade.js:4144–4183` (in `server.listen()` callback)

```javascript
setInterval(() => {
  // Only during market hours (9:30 AM – 4:15 PM ET, Mon–Fri)
  if (etTime < 9 * 60 + 30 || etTime > 16 * 60 + 15) return;
  
  const spot = firstFiniteNumber(
    dxTradeCache['SPX']?.price,
    dxTradeCache['/ESM6']?.price,
    gexLevelCache.spot, 0
  );
  
  const snapshot = computeIntradaySnapshot(spot);
  intradayGreeksHistory.push(snapshot);
  
  // Keep last 800 points (~6.5 hours at 30s intervals)
  if (intradayGreeksHistory.length > 800) intradayGreeksHistory.shift();
  
  // Broadcast to all browser clients
  broadcast({ type: 'GREEKS_INTRADAY', data: snapshot });
}, 30 * 1000);  // ← 30 seconds exactly
```

**Key Points**:
- ✅ Runs every **30 seconds** exactly
- ✅ Only during market hours (Mon–Fri, 9:30 AM–4:15 PM ET)
- ✅ Uses `computeIntradaySnapshot(spot)` to calculate GEX/DEX/CHEX/VEX
- ✅ Saves to disk every 5 snapshots
- ✅ Broadcasts to all connected WebSocket clients
- ✅ Keeps rolling window of 800 points (≈6.5 hours)

**Data Source**: Computed from `dxGreeksCache` and `spot` price

---

### ✅ 2. Broadcast Function (FOUND)

**Location**: `proxy-tastytrade.js:1694–1697`

```javascript
function broadcast(msg) {
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
  dxClients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(s); });
}
```

**How it's used**:
- Line 4178: `broadcast({ type: 'GREEKS_INTRADAY', data: snapshot });`
- Sends every 30 seconds to all connected browser WebSockets

---

## Questions to Answer

1. **Intraday Greeks**: What triggers the 30-second snapshot? Where is the timer? 
   - ✅ **ANSWERED**: `server.listen()` callback, line 4144, every 30 seconds during market hours

2. **Subscription Lifecycle**: When is a symbol removed from dxLink subscriptions?
   - ❓ **NOT FOUND**: No unsubscribe logic visible
   - Symbols are added but never removed
   - Subscriptions accumulate over the session (potential memory leak)

3. **dxLink Integration**: Is `proxy-websocket-relay.js` actually integrated?
   - ⚠️ **UNCLEAR**: File appears to be a template, not integrated
   - The actual relay is implemented differently (see broadcast function above)
   - But note: `proxy-websocket-relay.js` describes broadcast pattern that matches `broadcast()` function

4. **Fallback Greeks**: When are estimated Greeks used instead of live?
   - Line 3133: `const fallbackGreeks = estimateOptionGreekFallback(opt, underlyingPrice, side);`
   - Used only if dxLink cache miss: `liveDelta !== null && Math.abs(liveDelta) > 0`
   - So: estimated if cache is empty OR cache value is 0 or null

5. **Race Condition**: What happens if:
   - Browser calls `/proxy/api/tt/chains/SPX?awaitDX=1` 
   - But dxLink subscription is queued and not sent yet?
   - Line 3093–3096: calls `waitForOptionData(streamerSyms, 0)`
   - Waits with timeout (likely 5s, see `ensureDxLinkReady()` at line 1709)
   - If timeout → returns with cached/fallback values

---

## Intraday Snapshot Computation Details

**Function**: `computeIntradaySnapshot(spot)` (line 526–584)

**Computes**:
- **GEX** (Gamma Exposure): Sum of `|gamma| × contracts × spot²` per contract
  - Calls: positive
  - Puts: negative
  - Units: billions
  
- **DEX** (Delta Exposure): Sum of `|delta| × contracts × spot × 100`
  - Calls: positive
  - Puts: negative
  - Units: billions

- **CHEX** (Charm Exposure): Sum of `-theta × contracts × spot × 100`
  - Proxies time decay impact
  - Units: millions

- **VEX** (Vega Exposure): Sum of `vega × contracts × spot × 100`
  - Call vega: positive
  - Put vega: negative
  - Units: millions

**Data Source**:
- `dxGreeksCache[sym]` — live Greeks from dxLink
- `dxSummaryCache[sym]` — open interest + daily volume
- Filters to **0DTE SPXW symbols only** (today's expiration)

**Sent via WebSocket** (line 4178):
```javascript
broadcast({ type: 'GREEKS_INTRADAY', data: snapshot });
```

---

## Complete Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    BROWSER                                               │
├─────────────────────────────────────────────────────────────────────────┤
│  1. User action (click tab, request data)                               │
│  2. Three possible triggers:                                            │
│     A) API.getSpxChain() → REST /proxy/api/tt/chains/{symbol}          │
│     B) Subscribe to /ws/dxlink → REST POST /proxy/dxlink/subscribe     │
│     C) Page connected → receives broadcast messages every 30s           │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┬───────────────┐
        │              │              │               │
    ┌───v───┐      ┌───v───┐     ┌───v───┐      ┌───v───┐
    │REST A │      │REST B │     │WS Open│      │WS Msg │
    └───┬───┘      └───┬───┘     └───┬───┘      └───┬───┘
        │              │             │              │
┌───────v──────────────v─────────────v──────────────v────────┐
│                     PROXY SERVER                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ Subscription Queue (async) ─────────────────────┐      │
│  │ 1. addAutoSubscription(sym, types)               │      │
│  │ 2. queueAutoSubscription({ type, symbol })       │      │
│  │ 3. sendSubscriptionsRateLimited() [batch+delay]  │      │
│  │ 4. dxSocket sends to dxLink                      │      │
│  └──────────────────┬───────────────────────────────┘      │
│                     │                                       │
│  ┌─ dxLink Feed Listener ───────────────────────────┐      │
│  │ 1. dxSocket receives FEED_DATA                   │      │
│  │ 2. Parse Quote/Trade/Greeks/Summary              │      │
│  │ 3. Update caches:                                │      │
│  │    - dxGreeksCache[sym] = { delta, gamma, ... }  │      │
│  │    - dxQuoteCache[sym] = { bid, ask, ... }       │      │
│  │    - dxSummaryCache[sym] = { OI, dayVol, ... }   │      │
│  │ 4. Broadcast to all browser clients              │      │
│  └──────────────────────────────────────────────────┘      │
│                                                              │
│  ┌─ /proxy/api/tt/chains/{sym} Endpoint ─────────────┐    │
│  │ 1. Fetch from TastyTrade REST                     │    │
│  │ 2. Subscribe option symbols to dxLink (async)     │    │
│  │ 3. If ?awaitDX=1: wait for dxGreeksCache[sym]     │    │
│  │    (5s timeout, see ensureDxLinkReady)            │    │
│  │ 4. Enrich with live Greeks:                       │    │
│  │    - Priority: dxGreeksCache → REST → estimate    │    │
│  │ 5. Enrich with OI/Vol:                            │    │
│  │    - OI: dxSummaryCache.openInterest → REST → 0   │    │
│  │    - Vol: REST → dxTradeCache.dayVolume           │    │
│  │ 6. Build nested response                          │    │
│  │ 7. Return JSON                                    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─ Intraday Snapshot (every 30 seconds) ──────────────┐   │
│  │ 1. ONLY during market hours (9:30–4:15 PM ET)      │   │
│  │ 2. computeIntradaySnapshot(spot):                  │   │
│  │    - Loop over 0DTE SPXW symbols in dxGreeksCache  │   │
│  │    - Calculate GEX, DEX, CHEX, VEX using formulas  │   │
│  │ 3. Save snapshot to intradayGreeksHistory[ ]       │   │
│  │ 4. Broadcast to all browser clients                │   │
│  │ 5. Save to disk every 5 snapshots                  │   │
│  └────────────────────┬─────────────────────────────────┘   │
│                       │                                      │
└───────────────────────┼──────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
    ┌───v────────┐  ┌──v───┐      ┌───v────┐
    │ /ws/dxlink │  │REST  │      │Broadcast
    │ (WS relay) │  │JSON  │      │(WS only)
    └─────────────┘  └──────┘      └─────────┘
        │               │             │
    ┌───v───────────────v─────────────v──┐
    │         BROWSER PAGE                 │
    ├──────────────────────────────────────┤
    │ Updates DOM/React with:              │
    │ • Greeks (delta, gamma, theta, vega) │
    │ • Quotes (bid, ask, price)           │
    │ • Options chain (strikes + spreads)  │
    │ • Intraday charts (GEX/DEX/CHEX/VEX) │
    └──────────────────────────────────────┘
```

---

## Known Issues & Gaps

| Issue | Location | Impact | Severity |
|-------|----------|--------|----------|
| **No unsubscribe logic** | proxy-tastytrade.js | Subscriptions accumulate; memory leak over time | 🟡 Medium |
| **TT REST OI always 0** | Line 3116 | Options chain OI from REST is wrong; must wait for dxLink Summary | 🔴 High |
| **Fallback Greeks estimates** | Line 3133 | If symbol never subscribed, Greeks are estimated (less accurate) | 🟡 Medium |
| **awaitDX timeout unclear** | Line 3095 | `waitForOptionData()` timeout not explicitly documented | 🟡 Medium |
| **Subscription queue async** | Line 3086 | No guarantee subscription sent to dxLink before response | 🔴 High |
| **0DTE only for snapshots** | Line 539 | Intraday history doesn't include multi-DTE expirations | 🟡 Medium |
| **No subscription lifecycle** | — | When is a symbol removed? Never? | 🔴 High |

---

## Recommendations

### 1. Document the Guarantee
Add comments to REST endpoints specifying:
```javascript
// GET /proxy/api/tt/chains/{symbol}?awaitDX=1
// GUARANTEE: Returns live Greeks from dxLink (if available within 5 seconds)
// FALLBACK: Returns estimated Greeks if subscription pending or timeout
// NOTE: Open-interest requires dxLink Summary (not available in TT REST)
```

### 2. Subscription Lifecycle State Machine
```javascript
const subscriptionState = new Map();  // sym → { status, since, waiters: [] }

addAutoSubscription(sym, types) {
  if (!subscriptionState.has(sym)) {
    subscriptionState.set(sym, { 
      status: 'queued', 
      since: Date.now(), 
      types,
      waiters: [] 
    });
  }
}

// In dxSocket message handler, when Greeks arrive:
dxGreeksCache[sym] = greeks;
const state = subscriptionState.get(sym);
if (state && state.status === 'queued') {
  state.status = 'ready';
  state.waiters.forEach(resolve => resolve());
  state.waiters = [];
}
```

### 3. Explicit Unsubscribe
Add timer to remove symbols after they're not requested for 5 minutes:
```javascript
const lastRequestedTime = new Map();  // sym → Date.now()

setInterval(() => {
  const now = Date.now();
  const stale = [...subscriptionState.entries()]
    .filter(([sym, state]) => now - lastRequestedTime.get(sym) > 5 * 60 * 1000)
    .map(([sym]) => sym);
  
  if (stale.length > 0) {
    // Unsubscribe from dxLink
    removeAutoSubscription(stale);
    stale.forEach(sym => subscriptionState.delete(sym));
  }
}, 30 * 1000);  // check every 30 seconds
```

### 4. Add Calculation History
Document which calculations happen where:
```
GEX/DEX/CHEX/VEX:
  - Path A: computeIntradaySnapshot() every 30 seconds
  - Path B: Inferred in options chain response? (check if /chains computes or uses snapshot)
  - Path C: /proxy/api/tt/gex endpoint? (find and document)

Greeks enrichment:
  - Path A: /proxy/api/tt/chains endpoint (waits for dxLink or uses fallback)
  - Path B: /ws/dxlink broadcasts raw Quote/Greeks/Trade/Summary
  - Path C: Browser must correlate and calculate?
```

---

## Testing Checklist

- [ ] Verify `/proxy/api/tt/chains/SPX?awaitDX=1` waits for live Greeks
- [ ] Confirm WebSocket `/ws/dxlink` broadcasts Quote, Greeks, Summary in real-time
- [ ] Check intraday snapshot runs exactly every 30 seconds during market hours
- [ ] Verify intraday history includes all 0DTE SPXW symbols
- [ ] Test race condition: does chain endpoint hang if dxLink subscription pending?
- [ ] Verify subscription queue doesn't flood dxLink with duplicates
- [ ] Check memory usage: do subscriptions ever remove old symbols?
- [ ] Confirm OI comes from dxLink Summary, not TT REST
