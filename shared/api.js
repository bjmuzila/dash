// ============================================================================
// API PROVIDER SWITCHING LAYER
// Switch between TastyTrade, Schwab, Polygon, or Mock with one line change
// ============================================================================

console.log('🔌 Loading API provider layer...');

// ============================================================================
// CONFIGURATION - CHANGE PROVIDER HERE
// ============================================================================
const API_CONFIG = {
  // Change this line to switch providers ↓
  ACTIVE_PROVIDER: 'tastytrade',
  PROXY_BASE_URL: 'http://localhost:3001/proxy/api',
  
  // API Keys (only needed for the provider you're using)
  POLYGON_API_KEY: 'f9HaOLUqCWGMI8u119tBpABe5dIZlZRm',
  SCHWAB_API_KEY: '',  // Not needed if using proxy
  
  // Proxy configuration
  USE_PROXY: true,  // true = use /proxy/api, false = direct API calls
  PROXY_BASE_URL: 'http://localhost:3001/proxy/api',  // TastyTrade proxy on :3001
  DXLINK_WS_URL:  'ws://localhost:3001/ws/dxlink'     // dxLink WebSocket bridge
};

// ============================================================================
// SCHWAB ADAPTER
// ============================================================================
const SchwabAdapter = {
  name: 'Schwab',
  
  async init() {
    console.log('✓ Schwab adapter initialized');
    console.log(`  Mode: ${API_CONFIG.USE_PROXY ? 'Local Proxy (/proxy/api)' : 'Direct API'}`);
    return true;
  },
  
  async fetchQuote(symbol) {
    console.log(`Schwab: fetching quote for ${symbol}`);
    
    const url = API_CONFIG.USE_PROXY 
      ? `${API_CONFIG.PROXY_BASE_URL}/schwab/quote/${symbol}`
      : `https://api.schwabapi.com/marketdata/v1/quotes?symbols=${symbol}`;
    
    const headers = API_CONFIG.USE_PROXY 
      ? { 'Content-Type': 'application/json' }
      : { 
          'Authorization': `Bearer ${API_CONFIG.SCHWAB_API_KEY}`,
          'Content-Type': 'application/json'
        };
    
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Schwab API Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      return this.transformQuote(data, symbol);
    } catch (error) {
      console.error('Schwab quote fetch error:', error);
      throw error;
    }
  },
  
  async fetchOptionsChain(symbol, expirations = []) {
    console.log(`Schwab: fetching options chain for ${symbol}`, expirations);
    
    const url = API_CONFIG.USE_PROXY
      ? `${API_CONFIG.PROXY_BASE_URL}/schwab/chains/${symbol}`
      : `https://api.schwabapi.com/marketdata/v1/chains?symbol=${symbol}`;
    
    const headers = API_CONFIG.USE_PROXY
      ? { 'Content-Type': 'application/json' }
      : { 
          'Authorization': `Bearer ${API_CONFIG.SCHWAB_API_KEY}`,
          'Content-Type': 'application/json'
        };
    
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Schwab API Error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const transformed = this.transformOptionsChain(data);
      // Empty chain after hours is normal — return gracefully
      if (!transformed.options || !transformed.options.length) {
        console.log('Schwab: empty chain (market closed or no data)');
        return transformed;
      }
      return transformed;
    } catch (error) {
      console.error('Schwab chain fetch error:', error);
      throw error;
    }
  },
  
  transformQuote(data, symbol) {
    // Schwab quote format: { "SYMBOL": { quote: { lastPrice, ... } } }
    const entry = data[symbol] || data[symbol.replace('$','')] || Object.values(data)[0] || {};
    const quote = entry.quote || entry;
    return {
      symbol: symbol,
      price: quote.lastPrice || quote.last || quote.mark || 0,
      change: quote.netChange || quote.regularMarketNetChange || 0,
      changePercent: quote.netPercentChange || 0,
      bid: quote.bidPrice || quote.bid || 0,
      ask: quote.askPrice || quote.ask || 0,
      volume: quote.totalVolume || quote.volume || 0,
      timestamp: quote.quoteTime || Date.now()
    };
  },
  
  transformOptionsChain(data) {
    // Schwab options chain format transformation
    // Adjust this based on your actual Schwab API response structure
    console.log('Transforming Schwab options chain data...');
    
    const options = [];
    const expiryMap = {};
    
    // Schwab typically returns callExpDateMap and putExpDateMap
    const callMap = data.callExpDateMap || {};
    const putMap = data.putExpDateMap || {};
    
    // Process all expiration dates
    Object.keys(callMap).forEach(expDate => {
      const strikeMap = callMap[expDate];
      
      Object.keys(strikeMap).forEach(strikeKey => {
        const strike = parseFloat(strikeKey);
        const callOptions = strikeMap[strikeKey];
        const putOptions = putMap[expDate]?.[strikeKey] || [];
        
        const callData = callOptions[0] || {};
        const putData = putOptions[0] || {};
        
        const option = {
          strike: strike,
          expiration: expDate,
          
          // Call data
          callOI: callData.openInterest || 0,
          callVolume: callData.totalVolume || 0,
          callBid: callData.bid || 0,
          callAsk: callData.ask || 0,
          callLast: callData.last || 0,
          callDelta: callData.delta || 0,
          callGamma: callData.gamma || 0,
          callVega: callData.vega || 0,
          callTheta: callData.theta || 0,
          callIV: callData.volatility || 0,
          
          // Put data
          putOI: putData.openInterest || 0,
          putVolume: putData.totalVolume || 0,
          putBid: putData.bid || 0,
          putAsk: putData.ask || 0,
          putLast: putData.last || 0,
          putDelta: putData.delta || 0,
          putGamma: putData.gamma || 0,
          putVega: putData.vega || 0,
          putTheta: putData.theta || 0,
          putIV: putData.volatility || 0
        };
        
        options.push(option);
        
        // Build expiry map
        if (!expiryMap[expDate]) {
          expiryMap[expDate] = [];
        }
        expiryMap[expDate].push(option);
      });
    });
    
    return {
      symbol: data.symbol,
      underlying: {
        price: data.underlyingPrice || 0,
        change: data.underlyingChange || 0,
        changePercent: data.underlyingChangePercent || 0
      },
      options: options,
      expiryMap: expiryMap,
      timestamp: Date.now()
    };
  }
};

// ============================================================================
// TASTYTRADE ADAPTER
// ============================================================================
const TastyTradeAdapter = {
  name: 'TastyTrade',
  dxSocket: null,
  dxHandlers: {},
  dxConnected: false,

  async init() {
    try {
      const res = await fetch('http://localhost:3001/proxy/api/auto-connect');
      const d   = await res.json();
      if (d.connected) {
        console.log('✓ TastyTrade session active (proxy auto-connected)');
        this._startDxLink();
        return true;
      }
    } catch(e) {
      console.warn('TastyTrade proxy not reachable — is proxy-tastytrade.js running?');
    }
    console.error('✗ TastyTrade not connected — run: node proxy-tastytrade.js');
    return false;
  },

  _startDxLink() {
    if (this.dxSocket && this.dxSocket.readyState === WebSocket.OPEN) return;
    const wsUrl = (typeof API_CONFIG !== 'undefined' && API_CONFIG.DXLINK_WS_URL) || 'ws://localhost:3001/ws/dxlink';
    console.log('TastyTrade: connecting dxLink bridge');
    this.dxSocket = new WebSocket(wsUrl);
    this.dxSocket.onopen = () => { this.dxConnected = true; console.log('✓ dxLink bridge connected'); };
    this.dxSocket.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'FEED_DATA' && Array.isArray(msg.data)) this._processFeedData(msg.data);
      } catch(e) {}
    };
    this.dxSocket.onclose = () => { this.dxConnected = false; setTimeout(() => this._startDxLink(), 5000); };
    this.dxSocket.onerror = (e) => console.error('dxLink WS error:', e);
  },

  _processFeedData(events) {
    for (const event of events) {
      if (!Array.isArray(event)) continue;
      const [eventType, ...fields] = event;
      if (typeof eventType !== 'string') continue;
      const symbol = fields[0];
      const handlers = this.dxHandlers[symbol] || [];
      handlers.forEach(h => h({ type: eventType, symbol, fields }));
    }
  },

  subscribe(symbols, onData) {
    if (!Array.isArray(symbols)) symbols = [symbols];
    symbols.forEach(sym => {
      if (!this.dxHandlers[sym]) this.dxHandlers[sym] = [];
      this.dxHandlers[sym].push(onData);
    });
    if (this.dxSocket && this.dxSocket.readyState === WebSocket.OPEN) {
      this.dxSocket.send(JSON.stringify({ type: 'SUBSCRIBE', symbols }));
    } else {
      fetch('http://localhost:3001/proxy/dxlink/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols })
      }).catch(() => {});
    }
  },

  unsubscribe(symbols, onData) {
    if (!Array.isArray(symbols)) symbols = [symbols];
    symbols.forEach(sym => {
      if (this.dxHandlers[sym] && onData) {
        this.dxHandlers[sym] = this.dxHandlers[sym].filter(h => h !== onData);
      } else { delete this.dxHandlers[sym]; }
    });
  },

  async fetchQuote(symbol) {
    const response = await fetch(API_CONFIG.PROXY_BASE_URL + '/tt/quote/' + encodeURIComponent(symbol));
    if (!response.ok) throw new Error('TastyTrade quote error: ' + response.status);
    const data = await response.json();
    return this.transformQuote(data, symbol);
  },

  async fetchOptionsChain(symbol, expirations = []) {
    const expParam = expirations.length ? '?expiration=' + expirations[0] : '';
    const response = await fetch(API_CONFIG.PROXY_BASE_URL + '/tt/chains/' + encodeURIComponent(symbol) + expParam);
    if (!response.ok) throw new Error('TastyTrade chain error: ' + response.status);
    const data = await response.json();
    return this.transformOptionsChain(data, symbol);
  },

  transformQuote(data, symbol) {
    const items = (data && data.data && data.data.items) || [];
    const q = items.find(i => i.symbol === symbol) || items[0] || {};
    return {
      symbol,
      price:         parseFloat(q.last || q['last-trade-price'] || 0),
      close:         parseFloat(q.close || q['close-price'] || q['previous-close'] || 0),
      change:        parseFloat(q.change || q['day-change'] || 0),
      changePercent: parseFloat(q['change-percent'] || q['day-change-percent'] || 0),
      bid:           parseFloat(q.bid || q['bid-price'] || 0),
      ask:           parseFloat(q.ask || q['ask-price'] || 0),
      volume:        parseInt(q.volume || q['day-volume'] || 0),
      timestamp:     Date.now()
    };
  },

  transformOptionsChain(data, symbol) {
    const items = (data && data.data && data.data.items) || [];
    const options = [];
    for (const expGroup of items) {
      const expDate = expGroup['expiration-date'] || expGroup.expirationDate || '';
      const strikes = expGroup.strikes || expGroup['option-strikes'] || [];
      for (const strikeGroup of strikes) {
        const strikePrice = parseFloat(strikeGroup['strike-price'] || strikeGroup.strike || 0);
        for (const side of ['call', 'put']) {
          const opt = strikeGroup[side];
          if (!opt) continue;
          options.push({
            symbol:       opt.symbol || opt['option-symbol'] || '',
            underlying:   symbol,
            expiration:   expDate,
            strike:       strikePrice,
            optionType:   side.toUpperCase(),
            bid:          parseFloat(opt.bid || opt['bid-price'] || 0),
            ask:          parseFloat(opt.ask || opt['ask-price'] || 0),
            last:         parseFloat(opt.last || opt['close-price'] || 0),
            volume:       parseInt(opt.volume || opt['day-volume'] || 0),
            openInterest: parseInt(opt['open-interest'] || opt.openInterest || 0),
            iv:           parseFloat(opt.iv || opt['implied-volatility'] || 0),
            delta:        parseFloat(opt.delta || 0),
            gamma:        parseFloat(opt.gamma || 0),
            theta:        parseFloat(opt.theta || 0),
            vega:         parseFloat(opt.vega || 0),
            rho:          parseFloat(opt.rho || 0),
          });
        }
      }
    }
    return {
      symbol,
      underlyingPrice: 0,
      options,
      expirations: [...new Set(options.map(o => o.expiration))].sort()
    };
  }
};
// ============================================================================
// POLYGON ADAPTER
// ============================================================================
const PolygonAdapter = {
  name: 'Polygon',
  
  async init() {
    if (!API_CONFIG.POLYGON_API_KEY) {
      console.error('✗ Polygon API key not configured');
      return false;
    }
    console.log('✓ Polygon adapter initialized');
    return true;
  },
  
  async fetchQuote(symbol) {
    console.log(`Polygon: fetching quote for ${symbol}`);
    
    const url = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?apiKey=${API_CONFIG.POLYGON_API_KEY}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Polygon API Error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return this.transformQuote(data, symbol);
  },
  
  async fetchOptionsChain(symbol, expirations = []) {
    console.log(`Polygon: fetching chain for ${symbol}`);
    
    // Polygon options chain requires multiple API calls
    // This is a simplified version - you'll need to implement full logic
    const url = `https://api.polygon.io/v3/reference/options/contracts?underlying_ticker=${symbol}&apiKey=${API_CONFIG.POLYGON_API_KEY}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Polygon API Error: ${response.statusText}`);
    }
    
    const data = await response.json();
    return this.transformOptionsChain(data);
  },
  
  transformQuote(data, symbol) {
    const ticker = data.ticker || {};
    return {
      symbol: symbol,
      price: ticker.lastTrade?.p || ticker.day?.c || 0,
      change: ticker.todaysChange || 0,
      changePercent: ticker.todaysChangePerc || 0,
      bid: ticker.lastQuote?.P || 0,
      ask: ticker.lastQuote?.p || 0,
      volume: ticker.day?.v || 0,
      timestamp: ticker.updated || Date.now()
    };
  },
  
  transformOptionsChain(data) {
    console.log('Transforming Polygon chain data...');
    // Implement based on Polygon response structure
    return {
      options: [],
      expiryMap: {},
      timestamp: Date.now()
    };
  }
};

// ============================================================================
// MOCK ADAPTER
// ============================================================================
const MockAdapter = {
  name: 'Mock',
  
  async init() {
    console.log('✓ Mock data adapter initialized');
    console.log('  Using realistic fake data for testing');
    return true;
  },
  
  async fetchQuote(symbol) {
    console.log(`Mock: fetching quote for ${symbol}`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
    
    const basePrice = {
      'SPX': 7425,
      'SPY': 580,
      'QQQ': 512,
      'VIX': 14,
      'ES': 7420,
      'NQ': 21500
    }[symbol] || 100;
    
    const change = (Math.random() - 0.5) * basePrice * 0.01;
    const price = basePrice + change;
    
    return {
      symbol: symbol,
      price: price,
      change: change,
      changePercent: (change / basePrice) * 100,
      bid: price - 0.05,
      ask: price + 0.05,
      volume: Math.floor(Math.random() * 10000000) + 1000000,
      timestamp: Date.now()
    };
  },
  
  async fetchOptionsChain(symbol, expirations = []) {
    console.log(`Mock: fetching chain for ${symbol}`);
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
    
    const spotPrice = (await this.fetchQuote(symbol)).price;
    const atmStrike = Math.round(spotPrice / 5) * 5;
    
    const options = [];
    const expiryMap = {};
    
    // Generate mock expirations if none provided
    if (!expirations || expirations.length === 0) {
      const today = new Date();
      expirations = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        expirations.push(d.toISOString().split('T')[0]);
      }
    }
    
    // Generate options for each expiration
    expirations.forEach(exp => {
      expiryMap[exp] = [];
      
      // Generate 40 strikes around ATM (±20 strikes)
      for (let offset = -20; offset <= 20; offset++) {
        const strike = atmStrike + (offset * 5);
        const distance = (strike - spotPrice) / spotPrice;
        
        // Calculate realistic greeks
        const callDelta = Math.max(0, Math.min(1, 0.5 + distance * 2));
        const putDelta = callDelta - 1;
        const gamma = Math.exp(-Math.abs(distance) * 20) * 0.001;
        const callIV = 0.15 + Math.abs(distance) * 0.3;
        const putIV = 0.15 + Math.abs(distance) * 0.3;
        
        const option = {
          strike: strike,
          expiration: exp,
          
          // Call data
          callOI: Math.floor(Math.random() * 10000) + 1000,
          callVolume: Math.floor(Math.random() * 5000),
          callBid: Math.max(0.05, 5 - Math.abs(distance) * 50),
          callAsk: Math.max(0.10, 5.10 - Math.abs(distance) * 50),
          callLast: Math.max(0.08, 5.05 - Math.abs(distance) * 50),
          callDelta: callDelta,
          callGamma: gamma,
          callVega: 0.05,
          callTheta: -0.02,
          callIV: callIV,
          
          // Put data
          putOI: Math.floor(Math.random() * 10000) + 1000,
          putVolume: Math.floor(Math.random() * 5000),
          putBid: Math.max(0.05, 5 + Math.abs(distance) * 50),
          putAsk: Math.max(0.10, 5.10 + Math.abs(distance) * 50),
          putLast: Math.max(0.08, 5.05 + Math.abs(distance) * 50),
          putDelta: putDelta,
          putGamma: gamma,
          putVega: 0.05,
          putTheta: -0.02,
          putIV: putIV
        };
        
        options.push(option);
        expiryMap[exp].push(option);
      }
    });
    
    return {
      symbol: symbol,
      underlying: {
        price: spotPrice,
        change: (Math.random() - 0.5) * 10,
        changePercent: (Math.random() - 0.5) * 0.5
      },
      options: options,
      expiryMap: expiryMap,
      timestamp: Date.now()
    };
  }
};

// ============================================================================
// PROVIDER REGISTRY
// ============================================================================
const providers = {
  tastytrade: TastyTradeAdapter,
  schwab: SchwabAdapter,
  polygon: PolygonAdapter,
  mock: MockAdapter
};

// ============================================================================
// API INTERFACE
// ============================================================================
let activeProvider = null;

async function initAPI() {
  const providerName = API_CONFIG.ACTIVE_PROVIDER.toLowerCase();
  
  if (!providers[providerName]) {
    console.error(`❌ Unknown provider: ${providerName}`);
    console.log(`Available providers: ${Object.keys(providers).join(', ')}`);
    return false;
  }
  
  activeProvider = providers[providerName];
  console.log(`🔌 Initializing API provider: ${activeProvider.name}`);
  
  const success = await activeProvider.init();
  
  if (success) {
    console.log(`✅ ${activeProvider.name} adapter ready`);
  } else {
    console.error(`❌ ${activeProvider.name} adapter failed to initialize`);
  }
  
  return success;
}

// Unified API interface
window.API = {
  async fetchQuote(symbol) {
    if (!activeProvider) {
      throw new Error('API not initialized - call initAPI() first');
    }
    return activeProvider.fetchQuote(symbol);
  },
  
  async fetchOptionsChain(symbol, expirations = []) {
    if (!activeProvider) {
      throw new Error('API not initialized - call initAPI() first');
    }
    return activeProvider.fetchOptionsChain(symbol, expirations);
  },
  
  getProviderName() {
    return activeProvider?.name || 'None';
  },
  
  isReady() {
    return activeProvider !== null;
  },
  
  doLogout() {
    if (activeProvider?.name === 'TastyTrade') {
      localStorage.removeItem('tastytrade_token');
    }
    window.location.reload();
  }
};

// Auto-initialize on load
console.log('📦 API module loaded');
window.addEventListener('DOMContentLoaded', () => {
  initAPI().then(success => {
    if (success) {
      console.log('✅ API ready to use');
      window.dispatchEvent(new CustomEvent('api-ready'));
    } else {
      console.error('❌ API initialization failed');
    }
  });
});
