# SPX GEX Proxy WebSocket API

Real-time market data streaming via WebSocket connections.

## Overview

The proxy exposes two WebSocket endpoints for streaming live market data:

1. **`/ws/quotes`** — Stock & Index quotes (SPX, ES, VIX, individual stocks)
2. **`/ws/dxlink`** — Full dxLink data feed (options chains, Greeks, all event types)

---

## `/ws/quotes` — Live Price Streaming

Stream real-time prices for monitored symbols without the overhead of full dxLink data.

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3001/ws/quotes');

ws.onopen = () => {
  console.log('Connected to quotes stream');
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'quotes') {
    msg.data.forEach(quote => {
      console.log(`${quote.symbol}: ${quote.price} (bid: ${quote.bidPrice}, ask: ${quote.askPrice})`);
    });
  }
};

ws.onclose = () => {
  console.log('Disconnected from quotes stream');
};
```

### Watched Symbols

The `/ws/quotes` endpoint streams the following symbols by default:

**Futures:**
- `ESM6` — E-mini S&P 500
- `NQM6` — E-mini Nasdaq 100

**Indices:**
- `SPX` — S&P 500 Index
- `SPY` — SPY ETF
- `QQQ` — Nasdaq 100 ETF
- `VIX` — Volatility Index

**Mega-cap Stocks:**
- `AAPL`, `AMD`, `AMZN`, `GOOGL`, `META`, `NVDA`, `TSLA`, `MSFT`
- `SMH` — Semiconductor ETF

### Message Format

Each quote message contains:

```json
{
  "type": "quotes",
  "data": [
    {
      "symbol": "SPX",
      "price": 5580.25,
      "bidPrice": 5580.00,
      "askPrice": 5580.50,
      "dayVolume": 1250000,
      "change": 45.00,
      "changePercent": 0.81,
      "time": 1780101234567
    },
    {
      "symbol": "ESM6",
      "price": 5581.50,
      "bidPrice": 5581.25,
      "askPrice": 5581.75,
      ...
    }
  ]
}
```

### Update Frequency

Quotes are broadcast every **500ms** to all connected clients.

### Example: Display Quote in HTML

```html
<div id="spx-quote">
  <span id="spx-price">--</span>
  <span id="spx-change">--</span>
</div>

<script>
const ws = new WebSocket('ws://localhost:3001/ws/quotes');

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  msg.data.forEach(q => {
    if (q.symbol === 'SPX') {
      document.getElementById('spx-price').textContent = q.price.toFixed(2);
      const color = q.change < 0 ? 'red' : 'green';
      document.getElementById('spx-change').textContent = 
        `${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)} (${q.changePercent.toFixed(2)}%)`;
      document.getElementById('spx-change').style.color = color;
    }
  });
};
</script>
```

---

## `/ws/dxlink` — Full Options & Greeks Data

Connect to the full dxLink feed for option prices, Greeks, and all market data types.

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3001/ws/dxlink');

ws.onopen = () => {
  // Subscribe to specific symbols
  ws.send(JSON.stringify({
    type: 'subscribe',
    symbols: ['.SPXW260529C5800', '.SPXW260529P5800']  // Call and Put streamer-symbols
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log(msg);
};
```

### Subscribe to Symbols

Request subscriptions using the `subscribe` message type:

```javascript
ws.send(JSON.stringify({
  type: 'subscribe',
  symbols: [
    '.SPXW260529C5800',  // SPX 0DTE Call @ 5800 strike (streamer-symbol format)
    '.SPXW260529P5800',  // SPX 0DTE Put @ 5800 strike
    'SPX',               // SPX Index quote
    '/ESM6'              // ES futures
  ]
}));
```

### Symbol Format

**Option symbols** use dxLink **streamer-symbol** format:

```
.SPXW260529C5800
└─┬─┘ └────┬────┘ ├─┘ └──┬──┘
  │        │      │      └─ Strike Price (5800)
  │        │      └─ Right: C (Call) or P (Put)
  │        └─ Expiration: YYMMDD (2026-05-29)
  └─ Root Symbol: SPXW (SPX 0DTE weekly options)
```

**Examples:**
- `.SPXW260529C5900` — SPX Call, expires 2026-05-29, strike 5900
- `.SPXW260605P5700` — SPX Put, expires 2026-06-05, strike 5700
- `.NQM6260621C23000` — NQ Call, expires 2026-06-21, strike 23000

### Message Types

The `/ws/dxlink` connection receives several message types:

#### FEED_DATA Messages

Real-time market data for subscribed symbols:

```json
{
  "type": "FEED_DATA",
  "data": [
    "Trade",  // Event type
    [         // Array of events
      {
        "eventSymbol": ".SPXW260529C5800",
        "price": 125.50,
        "dayVolume": 50000,
        "time": 1780101234567
      }
    ]
  ]
}
```

**Available Event Types:**

| Type | Description | Key Fields | Use Case |
|------|-------------|-----------|----------|
| `Profile` | Instrument metadata | `description`, `priceIncrement`, `multiplier` | Get instrument details |
| `Quote` | Bid/ask snapshot | `bidPrice`, `askPrice`, `bidSize`, `askSize` | Current market prices |
| `Summary` | Daily aggregates | `openPrice`, `highPrice`, `lowPrice`, `closePrice`, `openInterest` | Daily OHLC + volume |
| `Trade` | Last trade | `price`, `size`, `dayVolume`, `time` | Most recent transaction |
| `Greeks` | Option Greeks | `delta`, `gamma`, `theta`, `vega`, `volatility`, `rho` | Option sensitivity |
| `TimeAndSale` | Trade history | `price`, `size`, `time`, `bidPrice`, `askPrice` | Tick-by-tick data |

---

## Detailed Event Type Reference

### Profile

Instrument metadata and specifications.

**Fields:**
- `eventSymbol` — Symbol identifier
- `description` — Human-readable name
- `statusReason` — Trading status reason
- `halted` — Boolean: is trading halted?
- `priceIncrement` — Minimum price movement
- `multiplier` — Contract multiplier (e.g., 100 for equity options)

**Example:**
```javascript
if (eventType === 'Profile') {
  rows.forEach(p => {
    console.log(`${p.eventSymbol}`);
    console.log(`  Description: ${p.description}`);
    console.log(`  Price Increment: ${p.priceIncrement}`);
    console.log(`  Multiplier: ${p.multiplier}`);
    console.log(`  Halted: ${p.halted}`);
  });
}
```

---

### Quote

Bid/ask quotes — the most frequently updated data type.

**Fields:**
- `eventSymbol` — Symbol
- `bidPrice` — Best bid price
- `askPrice` — Best ask price
- `bidSize` — Size at best bid (in contracts)
- `askSize` — Size at best ask
- `bidExchangeCode` — Exchange code for bid
- `askExchangeCode` — Exchange code for ask

**Example:**
```javascript
if (eventType === 'Quote') {
  rows.forEach(q => {
    const mid = (q.bidPrice + q.askPrice) / 2;
    const spread = q.askPrice - q.bidPrice;
    console.log(`${q.eventSymbol}`);
    console.log(`  Bid: ${q.bidPrice} × ${q.bidSize}`);
    console.log(`  Ask: ${q.askPrice} × ${q.askSize}`);
    console.log(`  Mid: ${mid}`);
    console.log(`  Spread: ${spread}`);
  });
}
```

**Use Case:** Option pricing, spread analysis, market microstructure.

---

### Summary

Daily market summary with aggregate data.

**Fields:**
- `eventSymbol` — Symbol
- `dayOpenPrice` — Open price today
- `dayHighPrice` — High price today
- `dayLowPrice` — Low price today
- `dayClosePrice` — Previous close
- `dayVolume` — Total volume today
- `openInterest` — Open interest (for options)
- `change` — Price change from previous close
- `changePercent` — Percent change
- `imbalance` — Order imbalance (stocks only)

**Example:**
```javascript
if (eventType === 'Summary') {
  rows.forEach(s => {
    console.log(`${s.eventSymbol} Summary:`);
    console.log(`  OHLC: ${s.dayOpenPrice} / ${s.dayHighPrice} / ${s.dayLowPrice} / ${s.dayClosePrice}`);
    console.log(`  Volume: ${s.dayVolume}`);
    console.log(`  Open Interest: ${s.openInterest}`);
    console.log(`  Change: ${s.change} (${s.changePercent}%)`);
  });
}
```

**Use Case:** Daily snapshots, GEX calculations (uses openInterest), volume analysis.

---

### Trade

The most recent trade for a symbol.

**Fields:**
- `eventSymbol` — Symbol
- `price` — Trade price
- `size` — Trade size (number of contracts)
- `dayVolume` — Total volume for the day
- `time` — Trade time (milliseconds)
- `dayTurnoever` — Dollar volume for the day
- `bidPrice` — Bid price at time of trade
- `askPrice` — Ask price at time of trade

**Example:**
```javascript
if (eventType === 'Trade') {
  rows.forEach(t => {
    console.log(`${t.eventSymbol} traded:`);
    console.log(`  Price: ${t.price}`);
    console.log(`  Size: ${t.size}`);
    console.log(`  Day Volume: ${t.dayVolume}`);
    console.log(`  Time: ${new Date(t.time).toISOString()}`);
  });
}
```

**Use Case:** Execution tracking, last-price monitoring, liquidity assessment.

---

### Greeks

Option Greeks — delta, gamma, theta, vega, and rho.

**Fields:**
- `eventSymbol` — Option symbol
- `delta` — Rate of change vs underlying (0 to 1 for calls, -1 to 0 for puts)
- `gamma` — Rate of change of delta (peak near ATM)
- `theta` — Time decay per day
- `vega` — 1% volatility sensitivity
- `rho` — Interest rate sensitivity
- `volatility` — Implied volatility

**Example:**
```javascript
if (eventType === 'Greeks') {
  rows.forEach(g => {
    console.log(`${g.eventSymbol} Greeks:`);
    console.log(`  Delta: ${g.delta.toFixed(4)}`);
    console.log(`  Gamma: ${g.gamma.toFixed(6)}`);
    console.log(`  Theta: ${g.theta.toFixed(4)}`);
    console.log(`  Vega: ${g.vega.toFixed(4)}`);
    console.log(`  IV: ${(g.volatility * 100).toFixed(2)}%`);
  });
}
```

**✅ Status:** Greeks stream live via DX WebSocket for SPX 0DTE options after initial REST chain load. See [SPX 0DTE Greeks Handoff](#spx-0dte-greeks-handoff) for the full flow.

**Use Case:** GEX calculations, hedging decisions, volatility analysis.

---

### TimeAndSale

Tick-by-tick trade history (trades, bid/ask changes).

**Fields:**
- `eventSymbol` — Symbol
- `time` — Time of event (milliseconds)
- `price` — Trade price (0 if quote-only tick)
- `size` — Trade size
- `bidPrice` — Bid at time of trade
- `askPrice` — Ask at time of trade
- `exchangeCode` — Exchange code

**Example:**
```javascript
if (eventType === 'TimeAndSale') {
  rows.forEach(tas => {
    console.log(`${tas.eventSymbol} @ ${new Date(tas.time).toISOString()}`);
    if (tas.price > 0) {
      console.log(`  Trade: ${tas.price} × ${tas.size}`);
    }
    console.log(`  Market: ${tas.bidPrice} / ${tas.askPrice}`);
  });
}
```

**Use Case:** Order flow analysis, tape reading, tick clustering, supply/demand mapping.

---

## Complete Event Handling Example

```javascript
const ws = new WebSocket('ws://localhost:3001/ws/dxlink');

ws.onopen = () => {
  // Subscribe to option and underlying
  ws.send(JSON.stringify({
    type: 'subscribe',
    symbols: [
      '.SPXW260529C5800',  // Call option
      '.SPXW260529P5800',  // Put option
      'SPX'                // Underlying index
    ]
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type !== 'FEED_DATA') return;
  
  const [eventType, rows] = msg.data;
  
  switch (eventType) {
    case 'Profile':
      rows.forEach(p => {
        console.log(`[PROFILE] ${p.eventSymbol}: ${p.description}`);
      });
      break;
      
    case 'Quote':
      rows.forEach(q => {
        const mid = (q.bidPrice + q.askPrice) / 2;
        const spread = ((q.askPrice - q.bidPrice) / mid * 10000).toFixed(1);
        console.log(`[QUOTE] ${q.eventSymbol}: ${mid.toFixed(2)} (${spread}bp spread)`);
      });
      break;
      
    case 'Summary':
      rows.forEach(s => {
        console.log(`[SUMMARY] ${s.eventSymbol}: OI=${s.openInterest}, Vol=${s.dayVolume}`);
      });
      break;
      
    case 'Trade':
      rows.forEach(t => {
        console.log(`[TRADE] ${t.eventSymbol}: ${t.price} × ${t.size}`);
      });
      break;
      
    case 'Greeks':
      rows.forEach(g => {
        console.log(`[GREEKS] ${g.eventSymbol}: Δ=${g.delta.toFixed(3)}, Γ=${g.gamma.toFixed(5)}, Θ=${g.theta.toFixed(3)}`);
      });
      break;
      
    case 'TimeAndSale':
      rows.forEach(tas => {
        if (tas.price > 0) {
          console.log(`[T&S] ${tas.eventSymbol}: ${tas.price} × ${tas.size} @ ${tas.time}`);
        }
      });
      break;
  }
};
```

---

## Summary

The proxy streams **6 main event types** from dxLink:

1. **Profile** — Static instrument data (metadata)
2. **Quote** — Live bid/ask (updates every tick)
3. **Summary** — Daily aggregates (OHLCV + OI)
4. **Trade** — Last trade (price, size, volume)
5. **Greeks** — Option sensitivities (currently unavailable)
6. **TimeAndSale** — Full tick history (trades + quote changes)

### Example: Get Option Quote

```javascript
const ws = new WebSocket('ws://localhost:3001/ws/dxlink');

ws.onopen = () => {
  // Subscribe to a call option
  ws.send(JSON.stringify({
    type: 'subscribe',
    symbols: ['.SPXW260529C5800']
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'FEED_DATA') {
    const [eventType, rows] = msg.data;
    
    if (eventType === 'Trade') {
      rows.forEach(trade => {
        console.log(`${trade.eventSymbol} traded at ${trade.price}`);
      });
    }
    
    if (eventType === 'Quote') {
      rows.forEach(quote => {
        const mid = (quote.bidPrice + quote.askPrice) / 2;
        console.log(`${quote.eventSymbol} bid: ${quote.bidPrice}, ask: ${quote.askPrice}, mid: ${mid}`);
      });
    }
    
    if (eventType === 'Greeks') {
      rows.forEach(greek => {
        console.log(`${greek.eventSymbol} delta: ${greek.delta}, gamma: ${greek.gamma}, theta: ${greek.theta}`);
      });
    }
  }
};
```

### Example: Get Greeks for Multiple Strikes

```javascript
// Subscribe to 5 strikes of SPX calls
const strikes = [5700, 5750, 5800, 5850, 5900];
const symbols = strikes.map(k => `.SPXW260529C${k}`);

ws.send(JSON.stringify({
  type: 'subscribe',
  symbols: symbols
}));

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.type === 'FEED_DATA' && msg.data[0] === 'Greeks') {
    msg.data[1].forEach(g => {
      console.log({
        strike: g.eventSymbol,
        delta: g.delta,
        gamma: g.gamma,
        theta: g.theta,
        vega: g.vega,
        volatility: g.volatility
      });
    });
  }
};
```

---

## HTTP REST Endpoints (Alternative)

If you prefer polling over WebSocket:

### GET `/proxy/api/tt/quotes`

```bash
curl http://localhost:3001/proxy/api/tt/quotes
```

Response:
```json
{
  "data": {
    "items": [
      {
        "symbol": "SPX",
        "price": 5580.25,
        "bidPrice": 5580.00,
        "askPrice": 5580.50,
        "dayVolume": 1250000,
        "change": 45.00,
        "changePercent": 0.81
      }
    ]
  }
}
```

### GET `/proxy/api/tt/quote/:symbol`

```bash
curl http://localhost:3001/proxy/api/tt/quote/SPX,ESM6,VIX
```

---

## Connection Best Practices

### Reconnection Logic

```javascript
function connectQuotes(maxRetries = 5) {
  let retries = 0;
  
  const connect = () => {
    const ws = new WebSocket('ws://localhost:3001/ws/quotes');
    
    ws.onopen = () => {
      console.log('Connected');
      retries = 0;
    };
    
    ws.onclose = () => {
      if (retries < maxRetries) {
        console.log(`Reconnecting... (attempt ${++retries})`);
        setTimeout(connect, 1000 * retries);
      }
    };
    
    ws.onmessage = (event) => {
      // Handle message
    };
  };
  
  connect();
}
```

### Multiple Subscriptions

```javascript
const ws = new WebSocket('ws://localhost:3001/ws/dxlink');

ws.onopen = () => {
  // Subscribe to options chain
  ws.send(JSON.stringify({
    type: 'subscribe',
    symbols: [
      '.SPXW260529C5800',
      '.SPXW260529C5900',
      '.SPXW260529P5700',
      '.SPXW260529P5800'
    ]
  }));
  
  // You can subscribe to more symbols later
  setTimeout(() => {
    ws.send(JSON.stringify({
      type: 'subscribe',
      symbols: ['SPX', 'VIX']
    }));
  }, 1000);
};
```

---

## Troubleshooting

### No Data Arriving

1. Check proxy logs: `[FEED_DATA]` messages should appear
2. Verify dxLink is connected: Look for `dxLink open → SETUP` in logs
3. Confirm symbols are being subscribed: Check for `Queued X subscription items`

### WebSocket Connection Refused

1. Verify proxy is running on port 3001
2. Check firewall isn't blocking localhost connections
3. Ensure no other service is using port 3001

### Greeks Always Zero

Greeks stream live for SPX 0DTE options. The REST chain seeds the initial data; DX WebSocket takes over immediately after. See [SPX 0DTE Greeks Handoff](#spx-0dte-greeks-handoff).

---

## SPX 0DTE Greeks Handoff

This is the core data flow for the GEX chart, heatmap, and table. The REST API is used **once** for the initial load; the DX WebSocket owns all subsequent updates.

### Phase 1 — REST Initial Load

On dashboard startup, `fetchGEX()` makes a single REST call:

```
GET /proxy/api/tt/chains/SPX?range=50
```

`range=50` means 50 strikes per side of ATM (100 total). The response is additionally center-filtered client-side to exactly 100 strikes around the current spot price for 0DTE.

The chain response is parsed into `callExpDateMap` and `putExpDateMap`, then fed into `processChain()` which builds `rawChain[]` — one object per strike containing:

```javascript
{
  strike: 5800,
  callGEX: 1250000,   // gamma × OI × 100 × spot²× 0.01
  putGEX: -980000,
  netGEX: 270000,
  callGamma: 0.000412,
  putGamma: 0.000389,
  callDelta: 0.48,
  putDelta: -0.52,
  callOI: 12400,
  putOI: 11200,
  callVol: 3200,
  putVol: 2800,
  // ...
}
```

After `processChain()` returns, `fetchGEX()` immediately:
1. Iterates the 0DTE expiry group in the raw chain response
2. Reads `streamer-symbol` from every call and put at each strike
3. Builds `_streamerSymbolToStrike` — a Map from streamer-symbol → `{ strike, right }`
4. Calls `dxSubscribe(allStreamerSymbols)` to subscribe them all on the DX WebSocket
5. Calls `stopAutoRefresh()` — the 30s REST polling loop is **permanently stopped**

```javascript
// After processChain() on isFirst only:
const newSyms = [];
todayGroup.strikes.forEach(row => {
  ['call', 'put'].forEach(right => {
    const sym = row[right]['streamer-symbol'];
    _streamerSymbolToStrike.set(sym, { strike: parseFloat(row['strike-price']), right });
    newSyms.push(sym);
  });
});
dxSubscribe(newSyms);   // ~200 symbols for 100 strikes
stopAutoRefresh();
```

### Phase 2 — DX WebSocket Takes Over

From this point, all Greek updates arrive as `Greeks` events on `_dxQuoteSocket`. The proxy broadcasts them in compact dxLink format; `normalizeDxFeedData()` parses them using the field order declared in `FEED_SETUP`:

```
volatility, delta, gamma, theta, rho, vega
```

Each event hits the `onmessage` handler:

```javascript
if (item.eventType === 'Greeks' && _streamerSymbolToStrike.has(sym)) {
  const { strike, right } = _streamerSymbolToStrike.get(sym);
  const row = rawChain.find(r => r.strike === strike);

  // Replace greeks in-place
  if (right === 'call') {
    row.callGamma = gamma;
    row.callDelta = delta;
    // ...
  } else {
    row.putGamma = gamma;
    // ...
  }

  // Recompute net GEX with updated gamma
  const contracts = oi > 0 ? oi : vol;
  const gex = gamma * contracts * 100 * spotPrice * spotPrice * 0.01;
  if (right === 'call') row.callGEX = gex;
  else                  row.putGEX  = -Math.abs(gex);
  row.netGEX = row.callGEX + row.putGEX;

  // Throttled re-render — max once per 100ms
  scheduleGreeksRender();
}
```

The throttle (`_greeksRenderPending`) coalesces rapid-fire Greeks events into a single render pass, then calls:
- `renderHeatmap()` — Strike | Net GEX | Vol Only GEX | DEX | Change columns
- `drawOverviewChart()` — GEX bar chart
- `renderGEXTable()` — sortable strike table

### Full Flow Diagram

```
Dashboard loads
      │
      ▼
fetchGEX() ──► GET /proxy/api/tt/chains/SPX?range=50
      │               │
      │         TastyTrade REST
      │               │
      │         gamma, delta, OI, volume
      │         per strike, all 100 0DTE strikes
      │               │
      ▼               ▼
 processChain()  rawChain[] seeded
      │
      ├── extract streamer-symbols from chain response
      ├── build _streamerSymbolToStrike map
      ├── dxSubscribe(~200 option symbols)
      └── stopAutoRefresh()  ◄── REST polling permanently off
                │
                ▼
      DX WebSocket receives Greeks events
      (live, milliseconds latency)
                │
      for each Greeks event:
        ├── lookup strike + right from _streamerSymbolToStrike
        ├── replace gamma/delta/theta/vega in rawChain row
        ├── recompute callGEX / putGEX / netGEX
        └── schedule throttled render (100ms)
                │
                ▼
      renderHeatmap()
      drawOverviewChart()
      renderGEXTable()
```

### What Stays on REST

After handoff, the REST chain endpoint is only called again on **manual refresh**. These fields do not come from DX Greeks events and are only updated on manual refresh:

| Field | Source | Notes |
|-------|--------|-------|
| `openInterest` | REST chain | OI updates intraday but not tick-by-tick |
| `volume` | REST chain | Cumulative day volume |
| `mark` / `bid` / `ask` | DX `Quote` events | Already live via quote socket |
| `gamma`, `delta`, `theta`, `vega` | DX `Greeks` events | Live after initial load |

### Manual Refresh

The manual refresh button still calls `fetchGEX()` which re-fetches the full REST chain. This re-seeds `rawChain[]` with fresh OI/volume, rebuilds `_streamerSymbolToStrike`, and re-subscribes any new strikes that entered the 100-strike window as spot moved. After the refresh, DX Greeks take over again immediately.


---

## Live Quotes — Index, Equity, and Futures

### Why TT REST Doesn't Work for Quotes

`GET /market-data/by-type` (the TT REST quotes endpoint) only reliably returns data for `index[]` params (SPX, VIX, NDX). Equities (`equity[]=AAPL`) and futures (`future[]=/ESM26`) return nothing or are silently dropped. This is a TT API limitation.

### How It Actually Works

The proxy already has live Quote and Trade events for all symbols flowing through dxLink. On browser connect, it immediately sends cached quote data for all symbols. The browser `_dxQuoteSocket.onmessage` handler caches these into `dxQuoteCache` keyed by the **dxLink symbol format**.

### Symbol Key Format

dxLink uses its own symbol format — not TT REST format:

| Asset | dxLink key | NOT |
|-------|-----------|-----|
| SPX index | `SPX` | `$SPX` |
| VIX index | `VIX` | `$VIX.X` |
| ES front-month | `/ES:XCME` | `/ESM26` |
| NQ front-month | `/NQ:XCME` | `/NQM26` |
| Equities | `AAPL`, `QQQ`, etc. | same |

### `/proxy/api/tt/quotes-batch` Endpoint

Rather than calling TT REST, this endpoint reads directly from the proxy's own dxLink caches and returns all symbols in one response:

```javascript
// proxy-tastytrade.js
GET /proxy/api/tt/quotes-batch   // no query params needed

// Returns:
{
  data: {
    items: [
      { symbol: 'SPX',      last: 5800.5, bid: 5800.25, ask: 5800.75, 'prev-close': 5780.0, change: 20.5, 'percent-change': 0.35 },
      { symbol: '/ES:XCME', last: 5812.0, bid: 5811.75, ask: 5812.25, 'prev-close': 5791.0, change: 21.0, 'percent-change': 0.36 },
      { symbol: 'AAPL',     last: 213.5,  bid: 213.4,   ask: 213.6,   'prev-close': 211.0,  change: 2.5,  'percent-change': 1.18 },
      // ... 14 symbols total
    ]
  }
}
```

Sources per field:
- `bid`, `ask` → `dxQuoteCache[sym].bidPrice / askPrice`
- `last` → `dxTradeCache[sym].price`, fallback to bid/ask mid
- `prev-close` → `dxSummaryCache[sym].prevDayClosePrice`
- `change`, `percent-change` → computed from last − prev-close

### Browser-Side: `fetchQuotes()` and `renderQuotes()`

```javascript
// window.fetchQuotes in overview.js (schwabAdapt block)
const r = await fetch('http://localhost:3001/proxy/api/tt/quotes-batch');
const items = r.data.items;

// Normalise symbols to QUOTE_SYMBOLS keys
items.forEach(q => {
  const root = q.symbol.split(':')[0];
  if (root === 'SPX')       { data['$SPX'] = entry; data['SPX'] = entry; }
  if (root === 'VIX')       { data['$VIX'] = entry; data['$VIX.X'] = entry; }
  if (root.startsWith('/ES')) { data['/ESM26'] = entry; esPrice = price; }
  if (root.startsWith('/NQ')) { data['/NQM26'] = entry; }
  // equities stored under their own symbol
});

quotesData = data;
renderQuotes();   // populates #quotes-list in left panel
```

`QUOTE_SYMBOLS` (the left panel list) uses `$SPX`, `$VIX.X`, `/ESM26`, `/NQM26` as keys — so the normalisation aliases are required.

### Proxy Cache — On Browser Connect

When a browser WebSocket connects to `/ws/dxlink`, the proxy immediately sends its cached quotes (2000ms delay to ensure browser `onmessage` is wired up, and again on first `subscribe` message):

```javascript
// proxy-tastytrade.js
const sendCachedQuotes = () => {
  ['SPX','VIX','/ES:XCME','/NQ:XCME','QQQ','SMH','AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA']
    .forEach(sym => {
      if (dxQuoteCache[sym]) {
        ws.send({ type:'FEED_DATA', data:['Quote',[sym, bid, ask, bidSize, askSize]] });
      }
    });
};
setTimeout(sendCachedQuotes, 2000);   // on connect
// also called immediately when browser sends first subscribe message
```

This populates `dxQuoteCache` in the browser, which `fetchQuotes()` reads from as a secondary path.

### What `fetchQuotes()` Is Called From

`window.startQuotesFeed()` (called on dashboard init) connects the DX socket, subscribes symbols, then calls `fetchQuotes()` after a 1500ms delay and every 30s thereafter:

```javascript
window.startQuotesFeed = function() {
  getDXQuoteSocket();
  dxSubscribe(['SPX','VIX','QQQ','SMH','AAPL','AMD','AMZN','GOOGL',
               'META','MSFT','NVDA','TSLA','/ES:XCME','/NQ:XCME']);
  setTimeout(() => window.fetchQuotes(), 1500);
  window._quotesInterval = setInterval(window.fetchQuotes, 30000);
};
```


---

## Summary

| Endpoint | Type | Best For | Update Rate |
|----------|------|----------|------------|
| `/ws/quotes` | WebSocket | Stock/index prices | 500ms |
| `/ws/dxlink` | WebSocket | Options, Greeks, tick data | Real-time (~100ms) |
| `/proxy/api/tt/quotes` | HTTP | Occasional price checks | On-demand |

