/**
 * shared/spx-flow.js
 * ─────────────────────────────────────────────────────────────────
 * Self-contained SPX 0DTE option flow data pipeline.
 * Runs automatically on page load — no init call needed.
 * Publishes live state to window.bzila every time data updates.
 *
 * Consumed by: overview.html snapshot tab (and any future page)
 * Replaces:    pages/bzila/bzila.js (pipeline portion only)
 * ─────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────
  const ES_STREAM_SYMBOL = '/ES:XCME';
  const NQ_STREAM_SYMBOL = '/NQ:XCME';
  const MAX_SEEN_SPX_TRADES = 20000;
  const MAX_LAST_TRADE_SYMBOLS = 5000;
  const WS_URL = (window.location.protocol === 'https:' ? 'wss' : 'ws') + '://' + window.location.host + '/ws/dxlink';
  const LS_KEY = 'spxFlow_v1';

  // ── localStorage persistence ───────────────────────────────────
  // Returns a session key that identifies which data-accumulation window we're in.
  // Buckets line up with the two daily resets (9:30am and 6:00pm ET):
  //   "YYYY-MM-DD_pre" → midnight–9:30am   (pre-market 0DTE)
  //   "YYYY-MM-DD_rth" → 9:30am–6:00pm     (regular session, carries 4–6pm)
  //   "YYYY-MM-DD_eve" → 6:00pm–midnight   (evening 1DTE)
  // This ensures localStorage data is discarded at each reset boundary, so a
  // hard refresh never restores stale accumulation from a previous window.
  function todayEtKey() {
    const et = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const etFull = getEtParts();
    const hour = etFull.hour % 24; // guard against Intl reporting "24" at midnight
    const mins = hour * 60 + etFull.minute;
    const OPEN = 9 * 60 + 30, EVE = 18 * 60;
    const bucket = mins < OPEN ? 'pre' : (mins < EVE ? 'rth' : 'eve');
    return `${et}_${bucket}`;
  }

  function saveToStorage() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        date:             todayEtKey(),
        callPremiumFlow:  state.callPremiumFlow,
        putPremiumFlow:   state.putPremiumFlow,
        netPremiumFlow:   state.netPremiumFlow,
        cumulativeBuyVol: state.cumulativeBuyVol,
        cumulativeSellVol: state.cumulativeSellVol,
        cumulativeCallVol: state.cumulativeCallVol,
        cumulativePutVol: state.cumulativePutVol,
        cumulativeBullVol: state.cumulativeBullVol,
        cumulativeBearVol: state.cumulativeBearVol,
        spxTradeOrders:   state.spxTradeOrders,
        seenSpxTradeOrder: state.seenSpxTradeOrder,
        cumulativeGEXByStrike: window._cumulativeGEXByStrike || {},
        snapshotSession:  window._cumulativeGEXSession || (typeof window.getSnapshotFlowSessionKey === 'function' ? window.getSnapshotFlowSessionKey() : null),
      }));
    } catch (e) { /* quota exceeded — ignore */ }
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || saved.date !== todayEtKey()) {
        localStorage.removeItem(LS_KEY); // stale day — discard
        return;
      }
      state.callPremiumFlow  = Number(saved.callPremiumFlow  || 0);
      state.putPremiumFlow   = Number(saved.putPremiumFlow   || 0);
      state.netPremiumFlow   = Number(saved.netPremiumFlow   || 0);
      state.cumulativeBuyVol = Number(saved.cumulativeBuyVol || 0);
      state.cumulativeSellVol = Number(saved.cumulativeSellVol || 0);
      state.cumulativeCallVol = Number(saved.cumulativeCallVol || 0);
      state.cumulativePutVol = Number(saved.cumulativePutVol || 0);
      state.cumulativeBullVol = Number(saved.cumulativeBullVol || 0);
      state.cumulativeBearVol = Number(saved.cumulativeBearVol || 0);
      state.spxTradeOrders   = Array.isArray(saved.spxTradeOrders) ? saved.spxTradeOrders : [];
      // Restore dedup set so we don't double-count replayed trades
      const order = Array.isArray(saved.seenSpxTradeOrder) ? saved.seenSpxTradeOrder : [];
      state.seenSpxTradeOrder = order;
      state.seenSpxTradeKeys  = new Set(order);
      // Restore cumulative GEX
      if (saved.cumulativeGEXByStrike && typeof saved.cumulativeGEXByStrike === 'object') {
        window._cumulativeGEXByStrike = saved.cumulativeGEXByStrike;
      }
      console.log(`[spx-flow] Restored ${state.spxTradeOrders.length} orders from localStorage`);
    } catch (e) {
      console.warn('[spx-flow] localStorage restore failed:', e);
    }
  }

  // ── State ──────────────────────────────────────────────────────
  const _prev = window.__bzilaFlowState || {};
  const state = {
    ws: null,
    connected: false,
    spxPrice:       0,
    esPrice:        _prev.esPrice  || 5900,
    nqPrice:        _prev.nqPrice  || 20800,
    callPremiumFlow: 0,
    putPremiumFlow:  0,
    netPremiumFlow:  0,
    cumulativeBuyVol: 0,
    cumulativeSellVol: 0,
    cumulativeCallVol: 0,
    cumulativePutVol: 0,
    cumulativeBullVol: 0,
    cumulativeBearVol: 0,
    flowHistory:     [],
    lastFlowCross:   null,
    spxQuotes:       {},
    futureQuotes:    {},
    lastTradeBySymbol: {},
    seenSpxTradeKeys:  new Set(),
    seenSpxTradeOrder: [],
    spxTradeOrders:    [],
    esTrades:          [],
    nqTrades:          [],
  };
  window.__bzilaFlowState = state;

  // ── ET time helpers ────────────────────────────────────────────
  function getEtParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, weekday: 'short'
    }).formatToParts(date);
    const out = {};
    for (const p of parts) { if (p.type !== 'literal') out[p.type] = p.value; }
    const wmap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      year:    parseInt(out.year   || '0', 10),
      month:   parseInt(out.month  || '0', 10),
      day:     parseInt(out.day    || '0', 10),
      hour:    parseInt(out.hour   || '0', 10),
      minute:  parseInt(out.minute || '0', 10),
      second:  parseInt(out.second || '0', 10),
      weekday: wmap[out.weekday] ?? -1
    };
  }

  function isMarketHoursAt(date = new Date()) {
    const et = getEtParts(date);
    if (et.weekday < 1 || et.weekday > 5) return false;
    const mins = et.hour * 60 + et.minute;
    return mins >= 570 && mins < 960; // 9:30–16:00 ET
  }

  function isBeforeMarketOpen() {
    const et = getEtParts();
    return et.hour * 60 + et.minute < 570;
  }

  // ── Option symbol helpers ──────────────────────────────────────
  function getOptionType(symbol) {
    const m = symbol.match(/\d{6}([CP])\d/);
    return m ? m[1] : null; // 'C' or 'P'
  }

  function getOptionStrike(symbol) {
    const m = symbol.match(/[CP](\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const raw = m[1];
    const strike = parseFloat(raw);
    if (!Number.isFinite(strike)) return null;
    return raw.length === 8 ? strike / 1000 : strike;
  }

  // Returns the target expiration date string (YYYYMMDD) based on current ET time:
  //   9:30am–4:00pm  → 0DTE (today)
  //   4:00pm–midnight → 1DTE (next trading day)
  //   midnight–9:30am → 0DTE (today, same calendar day)
  function getTargetExpiryYYMMDD() {
    const et = getEtParts();
    const mins = et.hour * 60 + et.minute;
    const MARKET_OPEN  = 9  * 60 + 30; // 570
    const MARKET_CLOSE = 16 * 60;      // 960

    if (mins >= MARKET_CLOSE) {
      // After-hours: next trading day (1DTE)
      const d = new Date();
      const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d); // YYYY-MM-DD
      const next = new Date(etDate + 'T12:00:00');
      do { next.setDate(next.getDate() + 1); }
      while (next.getDay() === 0 || next.getDay() === 6); // skip weekends
      const yy = String(next.getFullYear()).slice(2);
      const mm = String(next.getMonth() + 1).padStart(2, '0');
      const dd = String(next.getDate()).padStart(2, '0');
      return `${yy}${mm}${dd}`;
    } else {
      // Market hours OR pre-market (midnight–9:30): today's date (0DTE)
      const yy = String(et.year).slice(2);
      const mm = String(et.month).padStart(2, '0');
      const dd = String(et.day).padStart(2, '0');
      return `${yy}${mm}${dd}`;
    }
  }

  function isSpx0DTE(symbol) {
    if (!symbol.startsWith('.SPXW') && !symbol.startsWith('SPXW')) return false;
    const m = symbol.match(/(\d{6})[CP]/);
    if (!m) return false;
    return m[1] === getTargetExpiryYYMMDD();
  }

  function isOtmOption(symbol, optType) {
    const strike = getOptionStrike(symbol);
    const ref = state.spxPrice || state.esPrice || 0;
    if (!strike || !ref) return false;
    if (optType === 'C') return strike > ref;
    if (optType === 'P') return strike < ref;
    return false;
  }

  // ── Dedup ──────────────────────────────────────────────────────
  function getSpxTradeDedupKey(item) {
    return [
      item.eventSymbol || '',
      item.sequence ?? item.index ?? '',
      item.exchangeCode ?? '',
      Number(item.time || 0),
      parseFloat(item.price || 0),
      parseInt(item.size || 0)
    ].join('|');
  }

  function markSpxTradeSeen(item) {
    const key = getSpxTradeDedupKey(item);
    if (!key || key === '|||||') return false;
    if (state.seenSpxTradeKeys.has(key)) return true;
    state.seenSpxTradeKeys.add(key);
    state.seenSpxTradeOrder.push(key);
    if (state.seenSpxTradeOrder.length > MAX_SEEN_SPX_TRADES) {
      const stale = state.seenSpxTradeOrder.shift();
      if (stale) state.seenSpxTradeKeys.delete(stale);
    }
    return false;
  }

  // ── Aggressor direction ────────────────────────────────────────
  function getAggressorDirection(item, quote) {
    const price = parseFloat(item.price || 0);
    if (quote && quote.bid > 0 && quote.ask > 0) {
      if (price >= quote.ask) return 1;
      if (price <= quote.bid) return -1;
      return 0;
    }
    const ag = item.aggressorSide || '';
    if (ag === 'BUY') return 1;
    if (ag === 'SELL') return -1;
    return 0;
  }

  function getAggressorSide(symbol, price, item) {
    const bid = parseFloat(item.bidPrice || 0);
    const ask = parseFloat(item.askPrice || 0);
    const quote = (bid > 0 && ask > 0) ? { bid, ask } : state.futureQuotes[symbol];
    if (quote && quote.bid > 0 && quote.ask > 0) {
      if (price >= quote.ask) return 'buy';
      if (price <= quote.bid) return 'sell';
    }
    const ag = item.aggressorSide || '';
    if (ag === 'BUY') return 'buy';
    if (ag === 'SELL') return 'sell';
    const prev = state.lastTradeBySymbol[symbol];
    if (prev == null || price === prev) return null;
    return price > prev ? 'buy' : 'sell';
  }

  // ── Flow classification ────────────────────────────────────────
  function getSpxFlowAction(type, side) {
    if (type === 'C' && side === 'buy')  return 'BUY CALL';
    if (type === 'C' && side === 'sell') return 'SELL CALL';
    if (type === 'P' && side === 'buy')  return 'BUY PUT';
    if (type === 'P' && side === 'sell') return 'SELL PUT';
    return 'FLOW';
  }

  function getSpxFlowBucket(type, side) {
    if (type === 'C' && side === 'buy')  return 'bull';
    if (type === 'P' && side === 'sell') return 'bull';
    if (type === 'C' && side === 'sell') return 'bear';
    if (type === 'P' && side === 'buy')  return 'bear';
    return 'neutral';
  }

  function addSpxFlowOrder(item, type, side, premium, size) {
    const entry = {
      ts:           Number(item.time || Date.now()),
      symbol:       item.eventSymbol || '',
      strike:       Number(getOptionStrike(item.eventSymbol || '') || 0),
      type,
      side,
      action:       getSpxFlowAction(type, side),
      bucket:       getSpxFlowBucket(type, side),
      price:        Number(item.price || 0),
      size:         Number(size || 0),
      premium:      Number(premium || 0),
      aggressorSide: side
    };
    // Accumulate all metrics all day
    const sizeNum = Number(size || 0);
    if (side === 'buy') {
      state.cumulativeBuyVol += sizeNum;
    } else {
      state.cumulativeSellVol += sizeNum;
    }
    if (type === 'C') {
      state.cumulativeCallVol += sizeNum;
    } else if (type === 'P') {
      state.cumulativePutVol += sizeNum;
    }
    // Bull: BUY CALL + SELL PUT, Bear: SELL CALL + BUY PUT
    const isBull = (type === 'C' && side === 'buy') || (type === 'P' && side === 'sell');
    if (isBull) {
      state.cumulativeBullVol += sizeNum;
    } else {
      state.cumulativeBearVol += sizeNum;
    }
    state.spxTradeOrders.push(entry);
    if (state.spxTradeOrders.length > 500) state.spxTradeOrders.splice(0, state.spxTradeOrders.length - 500);
    return entry;
  }

  function getSpxFlowStats() {
    const orders  = state.spxTradeOrders;
    const callVol = orders.filter(o => o.type === 'C').reduce((s, o) => s + (o.size || 0), 0);
    const putVol  = orders.filter(o => o.type === 'P').reduce((s, o) => s + (o.size || 0), 0);
    const buyVol  = orders.filter(o => o.side === 'buy').reduce((s, o) => s + (o.size || 0), 0);
    const sellVol = orders.filter(o => o.side === 'sell').reduce((s, o) => s + (o.size || 0), 0);
    const bullVol = orders.filter(o => o.bucket === 'bull').reduce((s, o) => s + (o.size || 0), 0);
    const bearVol = orders.filter(o => o.bucket === 'bear').reduce((s, o) => s + (o.size || 0), 0);
    const totalVol = bullVol + bearVol;
    const bullPct  = totalVol > 0 ? bullVol / totalVol : 0.5;
    const pcr      = callVol > 0 ? putVol / callVol : 0;
    const bbr      = sellVol > 0 ? buyVol / sellVol : 0;
    const buckets  = {
      buyCall:  orders.filter(o => o.action === 'BUY CALL').sort((a, b) => b.premium - a.premium).slice(0, 3),
      sellCall: orders.filter(o => o.action === 'SELL CALL').sort((a, b) => b.premium - a.premium).slice(0, 3),
      buyPut:   orders.filter(o => o.action === 'BUY PUT').sort((a, b) => b.premium - a.premium).slice(0, 3),
      sellPut:  orders.filter(o => o.action === 'SELL PUT').sort((a, b) => b.premium - a.premium).slice(0, 3),
    };
    return { orders, callVol, putVol, buyVol, sellVol, bullVol, bearVol, totalVol, bullPct, bearPct: 1 - bullPct, pcr, bbr, buckets };
  }

  // ── window.bzila publisher ─────────────────────────────────────
  function publishBzila() {
    const stats = getSpxFlowStats();
    const recentTrades = stats.orders.slice(-15).reverse().map(o => ({
      side:  o.side  || '',
      type:  o.type  || '',
      size:  o.size  || 0,
      price: o.price || 0,
      strike: o.strike || 0,
      time:  o.ts ? new Date(o.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
    }));

    // Calculate top 3 flows by side + type
    const topBuyCallsFlow = stats.orders
      .filter(o => o.side === 'BUY' && o.type === 'CALL')
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 3)
      .reduce((sum, o) => sum + (o.size || 0), 0);

    const topSellCallsFlow = stats.orders
      .filter(o => o.side === 'SELL' && o.type === 'CALL')
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 3)
      .reduce((sum, o) => sum + (o.size || 0), 0);

    const topBuyPutsFlow = stats.orders
      .filter(o => o.side === 'BUY' && o.type === 'PUT')
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 3)
      .reduce((sum, o) => sum + (o.size || 0), 0);

    const topSellPutsFlow = stats.orders
      .filter(o => o.side === 'SELL' && o.type === 'PUT')
      .sort((a, b) => (b.size || 0) - (a.size || 0))
      .slice(0, 3)
      .reduce((sum, o) => sum + (o.size || 0), 0);

    window.bzila = {
      bullVol:           state.cumulativeBullVol,
      bearVol:           state.cumulativeBearVol,
      bullPct:           state.cumulativeBullVol + state.cumulativeBearVol > 0 ? state.cumulativeBullVol / (state.cumulativeBullVol + state.cumulativeBearVol) : 0.5,
      pcr:               state.cumulativeCallVol > 0 ? state.cumulativePutVol / state.cumulativeCallVol : 0,
      bbr:               state.cumulativeSellVol > 0 ? state.cumulativeBuyVol / state.cumulativeSellVol : 0,
      callVol:           state.cumulativeCallVol,
      putVol:            state.cumulativePutVol,
      buyVol:            state.cumulativeBuyVol,
      sellVol:           state.cumulativeSellVol,
      netPremium:        state.netPremiumFlow || 0,
      orderCount:        stats.orders.length,
      status:            state.connected ? 'LIVE' : 'WAITING',
      buckets:           stats.buckets,
      topBuyCallsFlow:   topBuyCallsFlow,
      topSellCallsFlow:  topSellCallsFlow,
      topBuyPutsFlow:    topBuyPutsFlow,
      topSellPutsFlow:   topSellPutsFlow,
      recentTrades
    };
    saveToStorage();
  }

  // ── Feed data normalizer ───────────────────────────────────────
  function normalizeFeedData(data) {
    if (!Array.isArray(data)) return [];
    if (data.length && typeof data[0] === 'object' && !Array.isArray(data[0])) return data;
    const eventType = data[0];
    const rows = data[1];
    if (typeof eventType !== 'string' || !Array.isArray(rows)) return [];
    const fieldsByType = {
      Quote:       ['bidPrice', 'askPrice', 'bidSize', 'askSize'],
      Trade:       ['price', 'dayVolume', 'size'],
      TradeETH:    ['price', 'dayVolume', 'size'],
      TimeAndSale: ['time', 'sequence', 'exchangeCode', 'price', 'size', 'bidPrice', 'askPrice', 'saleConditions', 'flags', 'aggressorSide']
    };
    const fields = fieldsByType[eventType];
    if (!fields) return [];
    const rowsIncludeType = rows[0] === eventType;
    const step = fields.length + (rowsIncludeType ? 2 : 1);
    const out = [];
    for (let i = 0; i <= rows.length - step; i += step) {
      const base = i + (rowsIncludeType ? 2 : 1);
      const item = {
        eventType:   rowsIncludeType ? rows[i]     : eventType,
        eventSymbol: rowsIncludeType ? rows[i + 1] : rows[i],
        time: Date.now()
      };
      fields.forEach((field, j) => { item[field] = rows[base + j]; });
      out.push(item);
    }
    return out;
  }

  // ── Processors ────────────────────────────────────────────────
  // Returns true if flow data should be accepted at current time:
  // market hours (9:30–16:00), after-hours 1DTE window (16:00–midnight), or pre-market 0DTE (midnight–9:30)
  function isFlowActiveWindow() {
    const et = getEtParts();
    if (et.weekday < 1 || et.weekday > 5) return false; // weekdays only
    const mins = et.hour * 60 + et.minute;
    return mins < 24 * 60; // always true on weekdays — gate is the symbol filter
  }

  function processSpxTrade(item) {
    if (!isFlowActiveWindow()) return;
    const symbol = item.eventSymbol || '';
    if (!isSpx0DTE(symbol)) return;
    const optType = getOptionType(symbol);
    if (!optType) return;
    if (!isOtmOption(symbol, optType)) return;
    const tradePrice = parseFloat(item.price || 0);
    const size = parseInt(item.size || 0);
    if (!tradePrice || !size) return;
    if (markSpxTradeSeen(item)) return;

    const quote = state.spxQuotes[symbol];
    const direction = getAggressorDirection(item, quote);
    if (direction === 0) return;

    const premium = tradePrice * size * 100;
    const side = direction > 0 ? 'buy' : 'sell';
    addSpxFlowOrder(item, optType, side, premium, size);

    if (optType === 'C') {
      state.callPremiumFlow += direction > 0 ? premium : -premium;
      state.netPremiumFlow  += direction > 0 ? premium : -premium;
    } else {
      state.putPremiumFlow  += direction > 0 ? premium : -premium;
      state.netPremiumFlow  -= direction > 0 ? premium : -premium;
    }
    publishBzila();
  }

  function processSpxQuote(item) {
    const symbol = item.eventSymbol || '';
    if (!symbol.startsWith('.SPXW') && !symbol.startsWith('SPXW')) return;
    const bid = parseFloat(item.bidPrice || 0);
    const ask = parseFloat(item.askPrice || 0);
    if (bid > 0 && ask > 0) {
      state.spxQuotes[symbol] = { bid, ask, ts: Date.now() };
    }
  }

  function processFutureQuote(item) {
    const symbol = item.eventSymbol || '';
    if (!symbol.startsWith('/ES') && !symbol.startsWith('/NQ')) return;
    const bid = parseFloat(item.bidPrice || 0);
    const ask = parseFloat(item.askPrice || 0);
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
    if (bid > 0 && ask > 0) {
      state.futureQuotes[symbol] = { bid, ask, ts: Date.now() };
    }
    if (mid > 0 && symbol.startsWith('/ES')) {
      state.esPrice = mid;
      if (!state.spxPrice) state.spxPrice = mid;
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────
  let _reconnectTimer = null;

  function startSpxFlow() {
    if (state.ws && state.ws.readyState < 2) return; // already open or connecting
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }

    const ws = new WebSocket(WS_URL);
    state.ws = ws;

    ws.onopen = () => {
      console.log('[spx-flow] WebSocket connected');
      state.connected = true;
      // Use REST POST instead of WebSocket (WS subscriptions disabled on server)
      fetch('/proxy/dxlink/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: [ES_STREAM_SYMBOL, NQ_STREAM_SYMBOL],
          feedTypesBySymbol: {
            [ES_STREAM_SYMBOL]: ['Quote', 'TimeAndSale'],
            [NQ_STREAM_SYMBOL]: ['Quote', 'TimeAndSale']
          }
        })
      }).catch(e => console.warn('[spx-flow] REST subscribe failed:', e.message));
      publishBzila();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // ── GREEKS_INTRADAY: proxy broadcasts every 30s ──────────────────────
        // Push snapshot to window.__liveExposureSnapshot so the Insights
        // exposure stack live-tick watcher picks it up within 2 seconds.
        // Proxy sends display-scale: gex/dex in billions, chex/vex in millions.
        // normalizeExposureToRaw: abs < 1e6 → ×1e9 (billions display → raw $)
        // normalizeExposureToRawM: abs < 1e4 → ×1e6 (millions display → raw $)
        if (msg.type === 'GREEKS_INTRADAY' && msg.data) {
          const d = msg.data;
          const toRaw  = v => { const n = Number(v); return Number.isFinite(n) ? (Math.abs(n) < 1e6 ? n * 1e9 : n) : null; };
          const toRawM = v => { const n = Number(v); return Number.isFinite(n) ? (Math.abs(n) < 1e4 ? n * 1e6 : n) : null; };
          const gex  = toRaw(d.gex);
          const dex  = toRaw(d.dex);
          const chex = toRawM(d.chex);
          const vex  = toRawM(d.vex);
          if (gex !== null && dex !== null && chex !== null && vex !== null) {
            window.__liveExposureSnapshot = {
              ...(window.__liveExposureSnapshot || {}),
              gex, dex, chex, vex,
              buyScore:  Number(d.buyPct  || d.buyScore  || 0),
              sellScore: Number(d.sellScore || 0),
              price:     Number(d.spot || d.price || 0),
              ts: Number(d.ts || Date.now())
            };
          }
        }

        // ── GREEKS_INTRADAY_HISTORY: full history on fresh WS connect ────────
        if (msg.type === 'GREEKS_INTRADAY_HISTORY' && Array.isArray(msg.data) && msg.data.length) {
          const last = msg.data[msg.data.length - 1];
          if (last) {
            const d = last;
            const toRaw  = v => { const n = Number(v); return Number.isFinite(n) ? (Math.abs(n) < 1e6 ? n * 1e9 : n) : null; };
            const toRawM = v => { const n = Number(v); return Number.isFinite(n) ? (Math.abs(n) < 1e4 ? n * 1e6 : n) : null; };
            const gex  = toRaw(d.gex);
            const dex  = toRaw(d.dex);
            const chex = toRawM(d.chex);
            const vex  = toRawM(d.vex);
            if (gex !== null && dex !== null && chex !== null && vex !== null) {
              window.__liveExposureSnapshot = window.__liveExposureSnapshot || {
                gex, dex, chex, vex,
                buyScore:  Number(d.buyPct  || d.buyScore  || 0),
                sellScore: Number(d.sellScore || 0),
                price:     Number(d.spot || d.price || 0),
                ts: Number(d.ts || Date.now())
              };
            }
          }
        }

        if (msg.type === 'FEED_DATA' && Array.isArray(msg.data)) {
          normalizeFeedData(msg.data).forEach(item => {
            const symbol    = item.eventSymbol || '';
            const eventType = item.eventType   || '';

            // ES/NQ quotes — track NBBO for aggressor detection
            if (eventType === 'Quote' && (symbol.startsWith('/ES') || symbol.startsWith('/NQ'))) {
              processFutureQuote(item);
              return;
            }

            // SPX option quotes — cache bid/ask per symbol
            if (eventType === 'Quote' && (symbol.startsWith('.SPXW') || symbol.startsWith('SPXW'))) {
              processSpxQuote(item);
              return;
            }

            if (eventType !== 'Trade' && eventType !== 'TradeETH' && eventType !== 'TimeAndSale') return;

            const price = parseFloat(item.price || 0);
            const size  = parseInt(item.size    || 0);
            if (!price || !size) return;

            // SPX 0DTE option trades
            if (symbol.startsWith('.SPXW') || symbol.startsWith('SPXW')) {
              processSpxTrade(item);
              return;
            }

            // ES/NQ future trades — update price reference
            const side = getAggressorSide(symbol, price, item);
            if (symbol.startsWith('/ES')) {
              state.esPrice = price;
              if (!state.spxPrice) state.spxPrice = price;
              state.lastTradeBySymbol[symbol] = price;
            } else if (symbol.startsWith('/NQ')) {
              state.nqPrice = price;
              state.lastTradeBySymbol[symbol] = price;
            }
            // Cap lastTradeBySymbol to prevent unbounded memory growth
            if (Object.keys(state.lastTradeBySymbol).length > MAX_LAST_TRADE_SYMBOLS) {
              const keys = Object.keys(state.lastTradeBySymbol);
              const toRemove = keys.slice(0, Math.floor(keys.length * 0.1));
              toRemove.forEach(k => delete state.lastTradeBySymbol[k]);
            }
          });
        }
      } catch (e) {
        console.error('[spx-flow] WS message error:', e);
      }
    };

    ws.onerror = (err) => {
      console.error('[spx-flow] WS error:', err);
      state.connected = false;
      publishBzila();
    };

    ws.onclose = () => {
      if (ws !== state.ws) return;
      console.log('[spx-flow] WS closed — reconnecting in 5s');
      state.connected = false;
      state.ws = null;
      publishBzila();
      _reconnectTimer = setTimeout(startSpxFlow, 5000);
    };
  }

  // ── Reset state (shared between 9:30am and midnight resets) ──────
  function doFlowReset(label) {
    state.callPremiumFlow   = 0;
    state.putPremiumFlow    = 0;
    state.netPremiumFlow    = 0;
    state.flowHistory       = [];
    state.spxQuotes         = {};
    state.futureQuotes      = {};
    state.lastTradeBySymbol = {};
    state.seenSpxTradeKeys  = new Set();
    state.seenSpxTradeOrder = [];
    state.spxTradeOrders    = [];
    state.cumulativeBuyVol  = 0;
    state.cumulativeSellVol = 0;
    state.cumulativeCallVol = 0;
    state.cumulativePutVol  = 0;
    state.cumulativeBullVol = 0;
    state.cumulativeBearVol = 0;
    // Also clear the snapshot top-3 in-memory accumulator so bars/flow reset
    // in lock-step with buy/sell vol (otherwise it self-clears on its next tick).
    try {
      window._cumulativeGEXByStrike = {};
      if (typeof window.getSnapshotFlowSessionKey === 'function') {
        window._cumulativeGEXSession = window.getSnapshotFlowSessionKey();
      }
    } catch (e) {}
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    publishBzila();
    console.log(`[spx-flow] Reset at ${label}`);
  }

  // ── Resets at 9:30 AM ET and 6:00 PM ET ────────────────────────
  // 9:30am  → start of the regular-session (0DTE) accumulation window
  // 6:00pm  → evening (1DTE) rollover; matches the snapshot sparkline /
  //           top-3 reset schedule so buy/sell vol clears with everything else.
  function scheduleResets() {
    const now = new Date();
    const isDST = now.getUTCMonth() >= 2 && now.getUTCMonth() <= 10;
    const utcOffset = isDST ? -4 : -5; // ET offset in hours
    const utcNow = now.getUTCHours() * 60 + now.getUTCMinutes();

    // Convert ET times to UTC minutes
    const openET  = 9 * 60 + 30;            // 9:30 AM ET
    const openUTC = openET + (-utcOffset) * 60; // e.g. DST: 13:30 UTC, Standard: 14:30 UTC
    const eveningET  = 18 * 60;             // 6:00 PM ET
    const eveningUTC = eveningET + (-utcOffset) * 60;

    function minsUntil(targetUTC) {
      let diff = targetUTC - utcNow;
      if (diff <= 0) diff += 24 * 60;
      return diff;
    }

    // Schedule 9:30am ET reset
    const until930 = minsUntil(openUTC % (24 * 60));
    setTimeout(() => {
      doFlowReset('9:30 AM ET');
      scheduleResets(); // re-arm both resets
    }, until930 * 60 * 1000);

    // Schedule 6:00pm ET reset
    const untilEvening = minsUntil(eveningUTC % (24 * 60));
    setTimeout(() => {
      doFlowReset('6:00 PM ET');
      // Don't re-arm here — scheduleResets called from 9:30 handles next cycle
    }, untilEvening * 60 * 1000);

    console.log(`[spx-flow] Next resets: 9:30am in ${until930}min, 6:00pm in ${untilEvening}min`);
  }

  // ── Boot ───────────────────────────────────────────────────────
  // Restore today's accumulated data from localStorage (survives hard refresh)
  loadFromStorage();

  // Recalculate bull/bear vol from restored trades
  function recalculateBullBearFromTrades() {
    state.cumulativeBullVol = 0;
    state.cumulativeBearVol = 0;
    state.spxTradeOrders.forEach(trade => {
      const sizeNum = Number(trade.size || 0);
      const type = String(trade.type || '');
      const side = String(trade.side || '');
      const isBull = (type === 'C' && side === 'buy') || (type === 'P' && side === 'sell');
      if (isBull) {
        state.cumulativeBullVol += sizeNum;
      } else {
        state.cumulativeBearVol += sizeNum;
      }
    });
  }
  recalculateBullBearFromTrades();

  // Note: we do NOT clear state pre-market (midnight–9:30).
  // Data accumulates from midnight onward (0DTE session).
  // Resets happen only at 9:30am and midnight via scheduleResets().

  // Publish initial state immediately
  publishBzila();

  // Start WebSocket
  startSpxFlow();
  scheduleResets();

  // Expose for debugging / external access
  window.__spxFlow = { state, getSpxFlowStats, publishBzila, startSpxFlow };

  console.log('[spx-flow] SPX flow pipeline loaded');
})();
