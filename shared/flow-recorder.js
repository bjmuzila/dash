(function() {
  'use strict';

  if (window.__flowRecorderStarted) return;
  window.__flowRecorderStarted = true;

  const state = {
    ws: null,
    reconnectTimer: null,
    flushTimer: null,
    sessionKey: null,
    esPrice: 0,
    spxPrice: 0,
    cvd: 0,
    bucket: { callPremium: 0, putPremium: 0 },
    spxQuotes: {},
    futureQuotes: {},
    lastTradeBySymbol: {}
  };

  function getSessionKey() {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
  }

  function ensureSession() {
    const key = getSessionKey();
    if (state.sessionKey !== key) {
      state.sessionKey = key;
      state.cvd = 0;
      state.bucket = { callPremium: 0, putPremium: 0 };
      state.spxQuotes = {};
      state.futureQuotes = {};
      state.lastTradeBySymbol = {};
    }
  }

  function normalizeFeedData(data) {
    if (!Array.isArray(data)) return [];
    if (data.length && typeof data[0] === 'object' && !Array.isArray(data[0])) return data;
    const eventType = data[0];
    const rows = data[1];
    if (typeof eventType !== 'string' || !Array.isArray(rows)) return [];
    const fieldsByType = {
      Quote: ['bidPrice', 'askPrice', 'bidSize', 'askSize'],
      Trade: ['price', 'dayVolume', 'size'],
      TradeETH: ['price', 'dayVolume', 'size']
    };
    const fields = fieldsByType[eventType];
    if (!fields) return [];
    const rowsIncludeType = rows[0] === eventType;
    const step = fields.length + (rowsIncludeType ? 2 : 1);
    const out = [];
    for (let i = 0; i <= rows.length - step; i += step) {
      const base = i + (rowsIncludeType ? 2 : 1);
      const item = {
        eventType: rowsIncludeType ? rows[i] : eventType,
        eventSymbol: rowsIncludeType ? rows[i + 1] : rows[i],
        time: Date.now()
      };
      fields.forEach((field, j) => item[field] = rows[base + j]);
      out.push(item);
    }
    return out;
  }

  function getOptionType(symbol) {
    const m = String(symbol || '').match(/[CP](\d{8})$/);
    if (!m) return null;
    const idx = String(symbol).lastIndexOf(m[0]);
    return idx >= 0 ? String(symbol)[idx] : null;
  }

  function getOptionStrike(symbol) {
    const m = String(symbol || '').match(/[CP](\d{8})$/);
    if (!m) return null;
    return parseInt(m[1], 10) / 1000;
  }

  function isOtmOption(symbol, optType) {
    const strike = getOptionStrike(symbol);
    const refPrice = state.spxPrice || state.esPrice || 0;
    if (!strike || !refPrice) return false;
    if (optType === 'C') return strike > refPrice;
    if (optType === 'P') return strike < refPrice;
    return false;
  }

  function isSpx0DTE(symbol) {
    const m = String(symbol || '').match(/(\d{6})[CP]\d{8}$/);
    if (!m) return false;
    const y = 2000 + parseInt(m[1].slice(0, 2), 10);
    const mo = m[1].slice(2, 4);
    const d = m[1].slice(4, 6);
    return `${y}-${mo}-${d}` === getSessionKey();
  }

  function getAggressorDirection(item, quote) {
    const tradePrice = parseFloat(item.price || 0);
    if (quote && quote.bid > 0 && quote.ask > 0) {
      if (tradePrice >= quote.ask) return 1;
      if (tradePrice <= quote.bid) return -1;
    }
    const ag = item.aggressorSide || '';
    if (ag === 'BUY') return 1;
    if (ag === 'SELL') return -1;
    return 0;
  }

  function getFutureSide(symbol, price, item) {
    const bid = parseFloat(item.bidPrice || 0);
    const ask = parseFloat(item.askPrice || 0);
    const quote = (bid > 0 && ask > 0) ? { bid, ask } : state.futureQuotes[symbol];
    if (quote && quote.bid > 0 && quote.ask > 0) {
      if (price >= quote.ask) return 1;
      if (price <= quote.bid) return -1;
    }
    const ag = item.aggressorSide || '';
    if (ag === 'BUY') return 1;
    if (ag === 'SELL') return -1;
    const prev = state.lastTradeBySymbol[symbol];
    if (prev == null || price === prev) return 0;
    return price > prev ? 1 : -1;
  }

  function processQuote(item) {
    const symbol = typeof item.eventSymbol === 'string' ? item.eventSymbol : '';
    const bid = parseFloat(item.bidPrice || 0);
    const ask = parseFloat(item.askPrice || 0);
    if (!symbol || !(bid > 0) || !(ask > 0)) return;
    if (symbol.startsWith('.SPXW') || symbol.startsWith('SPXW')) state.spxQuotes[symbol] = { bid, ask, ts: Date.now() };
    if (symbol.startsWith('/ES') || symbol.startsWith('/NQ')) state.futureQuotes[symbol] = { bid, ask, ts: Date.now() };
  }

  function processSpxTrade(item) {
    const symbol = item.eventSymbol || '';
    if (!isSpx0DTE(symbol)) return;
    const optType = getOptionType(symbol);
    if (!optType) return;
    if (!isOtmOption(symbol, optType)) return;

    const tradePrice = parseFloat(item.price || 0);
    const size = parseInt(item.size || 0, 10);
    if (!(tradePrice > 0) || !size) return;

    const quote = state.spxQuotes[symbol];
    const direction = getAggressorDirection(item, quote);
    if (!direction) return;
    const signedPremium = tradePrice * size * 100 * direction;
    if (optType === 'C') state.bucket.callPremium += signedPremium;
    else state.bucket.putPremium += signedPremium;
  }

  function processFutureTrade(item) {
    const symbol = item.eventSymbol || '';
    if (!symbol.startsWith('/ES')) return;
    const price = parseFloat(item.price || 0);
    const size = parseInt(item.size || 0, 10);
    if (!(price > 0) || !size) return;
    state.esPrice = price;
    if (!state.spxPrice) state.spxPrice = price;
    const side = getFutureSide(symbol, price, item);
    if (side) state.cvd += side * size;
    state.lastTradeBySymbol[symbol] = price;
  }

  async function fetchInitialPrices() {
    try {
      const resp = await fetch(window.location.origin + '/proxy/api/tt/quotes-batch?future[]=%2FESM6&index[]=SPX');
      const data = await resp.json();
      const items = data?.data?.items || [];
      items.forEach(q => {
        const sym = q.symbol || '';
        const price = parseFloat(q.last || q.mark || q.mid || 0);
        if (sym.startsWith('/ES') && price > 0) state.esPrice = price;
        if (sym === 'SPX' && price > 0) state.spxPrice = price;
      });
    } catch (err) {
      console.warn('Flow recorder initial price fetch failed:', err);
    }
  }

  async function flushMinute() {
    ensureSession();
    if (typeof DB === 'undefined' || !DB?.db || typeof DB.saveMinutePremiumFlow !== 'function') return;
    const price = state.spxPrice || state.esPrice || 0;
    const bucket = state.bucket;
    state.bucket = { callPremium: 0, putPremium: 0 };
    try {
      const writes = [
        DB.saveMinutePremiumFlow(bucket.callPremium, bucket.putPremium, price)
      ];
      if (typeof DB.saveMinuteCumulativeDelta === 'function') {
        writes.push(DB.saveMinuteCumulativeDelta(state.cvd || 0, state.esPrice || price));
      }
      await Promise.all(writes);
    } catch (err) {
      state.bucket.callPremium += bucket.callPremium;
      state.bucket.putPremium += bucket.putPremium;
      console.warn('Flow recorder DB save failed:', err);
    }
  }

  function connect() {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
    const ws = new WebSocket((window.location.protocol === 'https:' ? 'wss' : 'ws') + '://' + window.location.host + '/ws/dxlink');
    state.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', symbols: ['/ESM26', 'SPX'], spxSubscribe: true }));
    };
    ws.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'FEED_DATA' || !Array.isArray(msg.data)) return;
        ensureSession();
        normalizeFeedData(msg.data).forEach(item => {
          const type = item.eventType;
          if (type === 'Quote') {
            processQuote(item);
            return;
          }
          if (type !== 'Trade' && type !== 'TradeETH') return;
          const symbol = typeof item.eventSymbol === 'string' ? item.eventSymbol : '';
          if (!symbol) return;
          if (symbol.startsWith('.SPXW') || symbol.startsWith('SPXW')) processSpxTrade(item);
          else processFutureTrade(item);
        });
      } catch (err) {
        console.warn('Flow recorder message failed:', err);
      }
    };
    ws.onclose = () => {
      if (state.ws !== ws) return;
      state.ws = null;
      state.reconnectTimer = setTimeout(connect, 5000);
    };
    ws.onerror = () => {
      try { ws.close(); } catch (_) {}
    };
  }

  function start() {
    ensureSession();
    fetchInitialPrices();
    connect();
    if (!state.flushTimer) state.flushTimer = setInterval(flushMinute, 60 * 1000);
  }

  if (typeof DB !== 'undefined' && DB?.db) start();
  else window.addEventListener('db-ready', start, { once: true });

  window.__flowRecorder = state;
})();
