# SPX GEX Dashboard Refactor — Complete Setup Guide

## Problem
Editing one page breaks the proxy and other pages. Need hard boundaries between infrastructure and consumers.

## Solution
**Proxy = Read-Only Infrastructure | Pages = Independent Consumers**

---

## File Structure

```
spx-gex-dashboard-tt-fixed/
├── proxy-tastytrade.js          ← UNTOUCHABLE (core subscriptions only)
├── pages/
│   ├── quotes/
│   │   ├── quotes.html
│   │   └── quotes.js
│   ├── estimated-moves/
│   │   ├── estimated-moves.html
│   │   └── estimated-moves.js
│   ├── overview/
│   │   ├── overview.html
│   │   └── overview.js
│   ├── bzila/
│   │   ├── bzila.html
│   │   └── bzila.js
│   ├── insights/
│   │   ├── insights.html      ← tab shell only
│   │   ├── exposure/
│   │   │   ├── exposure.html
│   │   │   └── exposure.js
│   │   ├── options-chain/
│   │   │   ├── options-chain.html
│   │   │   └── options-chain.js
│   │   ├── initial-balance/
│   │   │   ├── initial-balance.html
│   │   │   └── initial-balance.js
│   │   └── top-10/
│   │       ├── top-10.html
│   │       └── top-10.js
│   ├── database/
│   │   ├── database.html
│   │   └── database.js
│   └── personal/
│       ├── personal.html
│       └── personal.js
├── shared/
│   ├── styles.css
│   ├── api.js
│   ├── calculations.js
│   └── utils.js
├── index.html               ← main shell, navigation
└── serve.js                 ← static server (port 8080)
```

---

## Core Proxy Setup

**File: `proxy-tastytrade.js`**

### Define Core Subscriptions (IMMUTABLE)
```javascript
const CORE_SUBSCRIPTIONS = {
  spx: {
    '0DTE': {
      all: true  // Quote, Summary, Trade, Greeks
    }
  },
  indices: ['$SPX', '$NDX', '$VIX']  // Quote + Summary only
};

// On proxy startup, ONLY subscribe to CORE
// Never modify this list after initialization
```

### Define Core Caches (Read-Only from Pages)
```javascript
const dxGreeksCache = new Map();     // SPX 0DTE Greeks {strikePrice, callPut} → greeks data
const dxQuoteCache = new Map();      // All symbols → {bid, ask, lastPrice}
const dxSummaryCache = new Map();    // All symbols → {lastPrice, prevDayClose, openPrice, volume, ...}
const dxTradeCache = new Map();      // All symbols → {price, size, side, timestamp}
```

### Add Proxy Endpoints

```javascript
// GET /proxy/api/spx-core
// Returns all core subscription data
app.get('/proxy/api/spx-core', (req, res) => {
  const response = {
    greeks: Array.from(dxGreeksCache.values()),
    quotes: Array.from(dxQuoteCache.values()),
    summaries: Array.from(dxSummaryCache.values()),
    trades: Array.from(dxTradeCache.values()),
    timestamp: Date.now()
  };
  res.json(response);
});

// GET /proxy/api/spx-chain?expiration=YYMMDD&type=call|put|both
// Returns SPX chain for specific expiry
app.get('/proxy/api/spx-chain', (req, res) => {
  const { expiration, type } = req.query;
  // Query TastyTrade REST for chain data
  // Filter by type (call/put/both)
  // Enrich with cached Greeks
  res.json(chainData);
});

// GET /proxy/api/spx-prevclose
// Returns SPX previous day close (for quotes page)
app.get('/proxy/api/spx-prevclose', (req, res) => {
  const prevClose = dxSummaryCache.get('$SPX')?.prevDayClose;
  res.json({ prevDayClose: prevClose, timestamp: Date.now() });
});

// POST /proxy/api/subscribe-additional
// Request additional symbol subscriptions (NOT core)
app.post('/proxy/api/subscribe-additional', (req, res) => {
  const { symbols } = req.body; // ['/ESM26', '/NQM26', ...]
  
  // Add to dxLink subscription (separate from CORE)
  symbols.forEach(symbol => {
    subscribeToSymbol(symbol);
  });
  
  res.json({ subscribed: symbols, message: 'Additional symbols subscribed' });
});
```

---

## Shared API Layer

**File: `shared/api.js`**

```javascript
// All proxy calls go through here
// Pages import and use these functions

export const API = {
  // Core data (read-only)
  async getSpxCore() {
    return fetch('/proxy/api/spx-core').then(r => r.json());
  },

  async getSpxPrevClose() {
    return fetch('/proxy/api/spx-prevclose').then(r => r.json());
  },

  async getSpxChain(expiration, type = 'both') {
    return fetch(`/proxy/api/spx-chain?expiration=${expiration}&type=${type}`)
      .then(r => r.json());
  },

  // Page-specific subscriptions
  async subscribeAdditional(symbols) {
    return fetch('/proxy/api/subscribe-additional', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols })
    }).then(r => r.json());
  }
};

export default API;
```

---

## Page Implementation Examples

### Quotes Page

**File: `pages/quotes/quotes.html`**
```html
<div id="quotes-container">
  <h2>Quotes</h2>
  <div id="spx-price">Loading...</div>
  <div id="spx-prevclose">Loading...</div>
</div>

<script type="module" src="quotes.js"></script>
```

**File: `pages/quotes/quotes.js`**
```javascript
import API from '../../shared/api.js';

async function init() {
  try {
    const { prevDayClose } = await API.getSpxPrevClose();
    const { summaries } = await API.getSpxCore();
    
    const spxSummary = summaries.find(s => s.symbol === '$SPX');
    
    document.getElementById('spx-price').textContent = `Current: ${spxSummary.lastPrice}`;
    document.getElementById('spx-prevclose').textContent = `Prev Close: ${prevDayClose}`;
  } catch (err) {
    console.error('Quotes init failed:', err);
  }
}

init();
```

---

### Estimated Moves Page

**File: `pages/estimated-moves/estimated-moves.html`**
```html
<div id="estimated-moves-container">
  <h2>Daily Estimated Moves</h2>
  <div id="estimated-move-value">Loading...</div>
</div>

<script type="module" src="estimated-moves.js"></script>
```

**File: `pages/estimated-moves/estimated-moves.js`**
```javascript
import API from '../../shared/api.js';

async function calculateEstimatedMove() {
  try {
    const { prevDayClose } = await API.getSpxPrevClose();
    
    // Get today's 0DTE chain
    const todayExpiry = getTodayExpiry(); // YYMMDD format
    const chain = await API.getSpxChain(todayExpiry, 'both');
    
    // Find ATM straddle
    const atmStrike = Math.round(prevDayClose / 10) * 10;
    const atmCall = chain.find(o => o.strike === atmStrike && o.type === 'call');
    const atmPut = chain.find(o => o.strike === atmStrike && o.type === 'put');
    
    // Straddle mid × 0.84
    const stradleMid = ((atmCall.bid + atmCall.ask) / 2 + (atmPut.bid + atmPut.ask) / 2) / 2;
    const estimatedMove = stradleMid * 0.84;
    
    document.getElementById('estimated-move-value').textContent = estimatedMove.toFixed(2);
  } catch (err) {
    console.error('Estimated move calc failed:', err);
  }
}

function getTodayExpiry() {
  // Return today's date in YYMMDD format
}

calculateEstimatedMove();
```

---

### Insights (Multi-Tab) Page

**File: `pages/insights/insights.html`** (Shell only)
```html
<div id="insights-container">
  <div class="tab-nav">
    <button data-tab="exposure" class="tab-button active">Exposure</button>
    <button data-tab="options-chain" class="tab-button">Options Chain</button>
    <button data-tab="initial-balance" class="tab-button">Initial Balance</button>
    <button data-tab="top-10" class="tab-button">Top 10</button>
  </div>
  
  <div id="tab-content"></div>
</div>

<script type="module" src="insights.js"></script>
```

**File: `pages/insights/insights.js`**
```javascript
// Tab switching logic only
// Each tab is loaded as a separate page

document.querySelectorAll('.tab-button').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const tabName = e.target.dataset.tab;
    
    // Load tab as separate page
    const response = await fetch(`insights/${tabName}/${tabName}.html`);
    const html = await response.text();
    
    document.getElementById('tab-content').innerHTML = html;
    
    // Execute tab's JS
    const script = document.createElement('script');
    script.type = 'module';
    script.src = `insights/${tabName}/${tabName}.js`;
    document.body.appendChild(script);
  });
});
```

**File: `pages/insights/options-chain/options-chain.html`**
```html
<div id="options-chain-table">Loading...</div>
<script type="module" src="options-chain.js"></script>
```

**File: `pages/insights/options-chain/options-chain.js`**
```javascript
import API from '../../../shared/api.js';

async function init() {
  try {
    // Request additional subscriptions if needed
    await API.subscribeAdditional(['/ESM26', '/NQM26']);
    
    // Load chain data
    const chain = await API.getSpxChain('0DTE', 'both');
    
    // Render table
    renderChainTable(chain);
  } catch (err) {
    console.error('Options Chain init failed:', err);
  }
}

function renderChainTable(chain) {
  // Your existing chain rendering logic
}

init();
```

---

## Implementation Checklist

### Phase 1: Setup Infrastructure
- [ ] Create folder structure above
- [ ] Add proxy endpoints (`/spx-core`, `/spx-chain`, `/spx-prevclose`, `/subscribe-additional`)
- [ ] Create `shared/api.js` with all API calls
- [ ] Update `index.html` nav to load new page paths

### Phase 2: Migrate Core Pages (One at a Time)
- [ ] Quotes page (simplest, validates pattern)
- [ ] Estimated Moves page
- [ ] Overview page
- [ ] Bzila page
- [ ] Database page

### Phase 3: Migrate Multi-Tab Pages
- [ ] Insights shell
- [ ] Exposure tab
- [ ] Options Chain tab
- [ ] Initial Balance tab
- [ ] Top 10 tab
- [ ] Personal page

### Phase 4: Lock Down Proxy
- [ ] Document CORE_SUBSCRIPTIONS as immutable
- [ ] Add comments to proxy blocking edits to core logic
- [ ] Create `PROXY_API.md` documenting all endpoints
- [ ] Test that page edits don't affect other pages

---

## Key Rules

1. **Proxy is Infrastructure**
   - Only core subscriptions live here
   - Never add page-specific logic to proxy
   - All endpoints are read-only from pages

2. **Each Page is Independent**
   - Page HTML + JS are a pair
   - Each tab gets its own HTML + JS
   - No page can modify proxy globals
   - No page can break another page

3. **API Layer is Contract**
   - All proxy calls go through `shared/api.js`
   - Pages never fetch directly from proxy
   - API changes are breaking changes (coordinate)

4. **Data Flows One Direction**
   - Proxy → Cache → API → Page
   - Pages never write back to proxy or cache
   - IndexedDB for page-specific persistence only

---

## Testing

After migrating each page:
1. Start proxy: `$env:LOG_LEVEL="debug"; node proxy-tastytrade.js`
2. Start server: `node serve.js`
3. Edit one page's JS
4. Verify other pages still work
5. Check browser console for errors

If editing page X breaks page Y, the coupling still exists—find it and isolate it.

---

## Notes

- Keep `proxy-tastytrade.js` version-controlled separately; treat it like a library
- Document all proxy API changes in `PROXY_API.md`
- Use `import`/`export` in page JS; avoid globals bleeding into window
- Test each migration thoroughly before moving to next page
