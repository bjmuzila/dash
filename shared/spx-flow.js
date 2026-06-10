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
  const WS_URL = 'ws://localhost:3001/ws/dxlink';
  const LS_KEY = 'spxFlow_v1';

  // ── localStorage persistence ───────────────────────────────────
  function todayEtKey() {
    const et = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    return et; // "MM/DD/YYYY"
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

  function isSpx0DTE(symbol) {
    if (!symbol.startsWith('.SPXW') && !symbol.startsWith('SPXW')) return false;
    const m = symbol.match(/(\d{6})[CP]/);
    if (!m) return false;
    const today = getEtParts();
    const yy = String(today.year).slice(2);
    const mm = String(today.month).padStart(2, '0');
    const dd = String(today.day).padStart(2, '0');
    return m[1] === `${yy}${mm}${dd}`;
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
  function processSpxTrade(item) {
    if (!isMarketHoursAt()) return;
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
      ws.send(JSON.stringify({
        type: 'subscribe',
        symbols: [ES_STREAM_SYMBOL, NQ_STREAM_SYMBOL],
        feedTypesBySymbol: {
          [ES_STREAM_SYMBOL]: ['Quote', 'TimeAndSale'],
          [NQ_STREAM_SYMBOL]: ['Quote', 'TimeAndSale']
        },
        spxSubscribe: true
      }));
      publishBzila();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

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

  // ── Daily reset at 9:30 AM ET ──────────────────────────────────
  function scheduleDailyReset() {
    const now = new Date();
    const utcNow = now.getUTCHours() * 60 + now.getUTCMinutes();
    const isDST  = now.getUTCMonth() >= 2 && now.getUTCMonth() <= 10;
    const openUTC = isDST ? 13 * 60 + 30 : 14 * 60 + 30;
    let minsUntil = openUTC - utcNow;
    if (minsUntil <= 0) minsUntil += 24 * 60;
    setTimeout(() => {
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
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      publishBzila();
      console.log('[spx-flow] Daily reset at 9:30 AM ET');
      scheduleDailyReset();
    }, minsUntil * 60 * 1000);
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

  // Clear stale state before market open (overrides any restored data)
  if (isBeforeMarketOpen()) {
    state.callPremiumFlow = 0;
    state.putPremiumFlow  = 0;
    state.netPremiumFlow  = 0;
    state.flowHistory     = [];
    state.spxTradeOrders  = [];
    state.seenSpxTradeKeys  = new Set();
    state.seenSpxTradeOrder = [];
    state.cumulativeBullVol = 0;
    state.cumulativeBearVol = 0;
  }

  // Publish initial (empty) state immediately so snapshot tab shows WAITING
  publishBzila();

  // Start WebSocket
  startSpxFlow();
  scheduleDailyReset();

  // Expose for debugging / external access
  window.__spxFlow = { state, getSpxFlowStats, publishBzila, startSpxFlow };

  console.log('[spx-flow] SPX flow pipeline loaded');
})();
